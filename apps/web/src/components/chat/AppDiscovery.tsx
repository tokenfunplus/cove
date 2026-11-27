import {
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { QueryClientContext, useQuery, useQueryClient } from "@tanstack/react-query";
import { appKeys, miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import type {
  MiniAppInstance,
  MiniAppRelease,
  MiniAppAction,
} from "@cove/api-contract";

const AppPicker = lazy(() => import("@/components/miniapps/AppPicker"));
const grants: Record<MiniAppAction["op"], string> = {
  query: "records.query",
  create: "records.commit",
  update: "records.commit",
  delete: "records.commit",
  generate: "ai.generate",
};

export function chatApps(
  instances: MiniAppInstance[],
  releases: MiniAppRelease[],
) {
  return instances.flatMap((instance) => {
    const release = releases.find(
      (release) => release.id === instance.release_id,
    );
    if (!instance.enabled || !release) return [];
    const actions = Object.values(release.package.actions).filter(
      (action) =>
        action.surfaces.includes("chat") &&
        instance.grants.includes(grants[action.op]),
    );
    return actions.length
      ? [{ instance, packageName: release.package.name, actions }]
      : [];
  });
}

export function appDiscoveryQuestion(text: string) {
  const question = text.trim();
  return (
    /^(?:find|show|list)(?:\s+my)?\s+due\s+questions[.!?]?$/i.test(question) ||
    /^(?:which|what)\s+(?:mini\s+)?apps?\s+(?:(?:can|may)\s+i\s+(?:use|access)(?:\s+(?:here|in\s+(?:this|my)\s+chat|with\s+cove))?|(?:are|do\s+i\s+have)\s+(?:installed|available)(?:\s+(?:here|locally|in\s+(?:this|my)\s+chat))?)[.!?]?$/i.test(question) ||
    /^(?:list\s+my\s+app\s+actions|show\s+(?:my\s+)?apps)[.!?]?$/i.test(question) ||
    /^(?:\u6211|\u8fd9\u91cc|\u5f53\u524d\u5bf9\u8bdd\u4e2d)?(?:\u6709|\u80fd\u7528|\u53ef\u4ee5\u4f7f\u7528)\u54ea\u4e9b(?:\u672c\u5730|\u5df2\u5b89\u88c5\u7684?|\u5c0f)?\u5e94\u7528[?\uff1f\u3002!\uff01]?$/.test(question) ||
    /^\u5217\u51fa(?:\u6211\u7684)?(?:\u5df2\u5b89\u88c5\u7684?)?(?:\u5c0f)?\u5e94\u7528(?:\u52a8\u4f5c)?[?\uff1f\u3002!\uff01]?$/.test(question)
  );
}

function escapedName(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionedApps(text: string, apps: ReturnType<typeof chatApps>) {
  const question = text.split(/(?:^|\n)Reference from /, 1)[0];
  return apps.filter(({ instance, packageName }) => {
    return [instance.name, packageName].some((value) => {
      const name = escapedName(value.trim());
      if (!name) return false;
      const explicit = new RegExp(
        String.raw`(?:^|[^\p{L}\p{N}_])@${name}(?![\p{L}\p{N}_])`,
        "iu",
      );
      const english = new RegExp(
        String.raw`\b(?:from|in|using|with)\s+(?:my\s+)?${name}(?![\p{L}\p{N}_])`,
        "iu",
      );
      // Chinese action phrases do not require spaces around an app name.
      const chinese = new RegExp(
        String.raw`(?:\u4ece|\u5728|\u4f7f\u7528|\u7528)(?:\u6211\u7684)?\s*${name}(?![A-Za-z0-9_])`,
        "iu",
      );
      return (
        explicit.test(question) || english.test(question) || chinese.test(question)
      );
    });
  });
}

export function useChatApps(enabled = true) {
  const cache = useQueryClient();
  const hasApps = useSyncExternalStore(
    (notify) => cache.getQueryCache().subscribe(notify),
    () =>
      cache.getQueryData<boolean>(appKeys.presence) === true ||
      !!cache.getQueryData<{ instances: MiniAppInstance[] }>(appKeys.instances)
        ?.instances.length,
    () => false,
  );
  const instances = useQuery({
    queryKey: appKeys.instances,
    queryFn: miniApps.instances,
    retry: false,
    enabled: enabled && hasApps,
  });
  const releases = useQuery({
    queryKey: appKeys.releases,
    queryFn: miniApps.releases,
    retry: false,
    enabled: enabled && !!instances.data?.instances.length,
  });
  return useMemo(
    () => chatApps(instances.data?.instances ?? [], releases.data?.packages ?? []),
    [instances.data, releases.data],
  );
}

export function ChatDiscoveryBridge(props: {
  enabled: boolean;
  change: (apps: ReturnType<typeof chatApps>) => void;
}) {
  const cache = useContext(QueryClientContext);
  return cache ? <ChatDiscoveryQueries {...props} /> : null;
}

function ChatDiscoveryQueries({ enabled, change }: {
  enabled: boolean;
  change: (apps: ReturnType<typeof chatApps>) => void;
}) {
  const apps = useChatApps(enabled);
  useEffect(() => change(apps), [apps, change]);
  return null;
}

export function AppStarters({
  apps,
  open,
}: {
  apps: ReturnType<typeof chatApps>;
  open: (instance?: string, question?: string) => void;
}) {
  if (!apps.length) return null;
  const due = apps.filter(({ actions }) =>
    actions.some(
      (action) => action.op === "query" && /\bdue\b/i.test(action.title),
    ),
  );
  return (
    <div className="flex flex-wrap gap-2" aria-label="Installed app shortcuts">
      {due.length > 0 && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            open(
              due.length === 1 ? due[0].instance.id : undefined,
              "Find due questions in my apps.",
            )
          }
        >
          Find due questions
        </Button>
      )}
      <Button type="button" size="sm" variant="outline" onClick={() => open()}>
        List my app actions
      </Button>
    </div>
  );
}

type WelcomeProps = { startDraft: (body?: string) => void };

export default function AppWelcomeDiscovery(props: WelcomeProps) {
  const cache = useContext(QueryClientContext);
  return cache ? <AppWelcomeQueries {...props} /> : null;
}

function AppWelcomeQueries({ startDraft }: WelcomeProps) {
  const apps = useChatApps();
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState<string>();
  return (
    <>
      <AppStarters
        apps={apps}
        open={(id) => {
          setInstance(id);
          setOpen(true);
        }}
      />
      {open && (
        <Suspense fallback={null}>
          <AppPicker
            surface="chat"
            initialInstance={instance}
            close={() => setOpen(false)}
            attach={(body) => {
              setOpen(false);
              startDraft(body);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
