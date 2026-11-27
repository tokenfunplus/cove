import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { observeBrowserSessionExpiry } from "@/api/client";
import { useLocalSession } from "@/api/hooks/useSession";
import { AppSidebar } from "@/components/miniapps/AppSidebar";
import { WorkspaceSearch } from "@/components/miniapps/WorkspaceSearch";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Grid2X2 } from "lucide-react";
import {
  AppDirectory,
  type InstallTarget,
  type DirectorySection,
} from "@/components/miniapps/AppDirectory";
import { AppWorkspace } from "@/components/miniapps/AppWorkspace";
import { appBookmark, ErrorMessage } from "@/components/miniapps/presentation";
import { isConversationId } from "@/lib/launcher-intent";
import { navigateWorkspace as navigate } from "@/lib/workspace-navigation";
import "@/components/miniapps/mini-apps.css";

const slug = /^[a-z][a-z0-9-]{0,47}$/;
const validView = slug;
function route(path: string): {
  id?: string;
  view?: string;
  target?: InstallTarget;
  invalid?: boolean;
} {
  const segments = path.split("/").slice(2);
  if (!segments.length || (segments.length === 1 && !segments[0])) return {};
  if (
    segments.length === 3 &&
    segments[0] === "install" &&
    slug.test(segments[1]) &&
    slug.test(segments[2])
  )
    return {
      target: {
        publisher: segments[1],
        app: segments[2],
        version:
          new URLSearchParams(window.location.search).get("version") ??
          undefined,
      },
    };
  if (
    segments.length <= 2 &&
    isConversationId(segments[0]) &&
    (!segments[1] || validView.test(segments[1]))
  )
    return { id: segments[0], view: segments[1] };
  return { invalid: true };
}
function subscribe(fn: () => void) {
  window.addEventListener("popstate", fn);
  return () => window.removeEventListener("popstate", fn);
}
export default function MiniAppsPage({
  attach,
}: {
  attach: (body: string) => Promise<void>;
}) {
  const address = useSyncExternalStore(
    subscribe,
    () => window.location.pathname + window.location.search,
  );
  const path = address.split("?")[0]!;
  const { id, view, target, invalid } = route(path);
  const session = useLocalSession();
  const querySection = new URLSearchParams(address.split("?")[1]).get(
    "section",
  );
  const section: DirectorySection = [
    "catalog",
    "activity",
    "agent",
    "packages",
    "restore",
    "settings",
  ].includes(querySection ?? "")
    ? (querySection as DirectorySection)
    : "mine";
  const [expired, setExpired] = useState(false);
  useEffect(() => observeBrowserSessionExpiry(() => setExpired(true)), []);
  const open = useCallback(
    (instance: string, nextView?: string, replace?: boolean) => {
      navigate(
        "/apps/" +
          encodeURIComponent(instance) +
          (nextView ? "/" + encodeURIComponent(nextView) : ""),
        replace,
      );
    },
    [],
  );
  const resume =
    id && view
      ? appBookmark(id, view)
      : target
        ? "cove://install/" +
          target.publisher +
          "/" +
          target.app +
          (target.version
            ? "?version=" + encodeURIComponent(target.version)
            : "")
        : "cove://apps";
  return (
    <main
      className={
        "mini-app-shell h-dvh min-h-0 overflow-y-auto overscroll-contain bg-background px-5 pb-12 pt-5 text-foreground sm:px-10 sm:pt-7 " +
        (session.isSuccess && !expired ? "mini-app-with-sidebar" : "")
      }
    >
      {session.isSuccess && !expired && (
        <AppSidebar
          current={target ? "catalog" : section}
          instance={id}
          navigate={navigate}
        />
      )}
      <div className="mx-auto max-w-5xl space-y-7 sm:space-y-9">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Grid2X2 size={17} />
            </span>
            <h1 className="text-base font-semibold tracking-tight">
              Cove{" "}
              <span className="ml-1 font-normal text-muted-foreground">
                / Mini Apps
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-1 sm:gap-3">
            <WorkspaceSearch navigate={(path) => navigate(path)} />
            <Button asChild size="sm" variant="ghost" className="!text-xs">
              <a
                href="/"
                onClick={(e) => {
                  if (
                    e.button ||
                    e.ctrlKey ||
                    e.metaKey ||
                    e.altKey ||
                    e.shiftKey
                  )
                    return;
                  e.preventDefault();
                  navigate("/");
                }}
              >
                <ArrowLeft className="hidden sm:block" />
                Cove Chat
              </a>
            </Button>
          </div>
        </header>
        {invalid ? (
          <p role="alert">Unknown app address.</p>
        ) : expired || !session.isSuccess ? (
          <>
            <ErrorMessage error={session.error} />
            {session.isPending ? (
              <p role="status">Connecting to Cove…</p>
            ) : (
              <p>
                Reopen this page from the Cove Launcher to start a browser
                session.{" "}
                {resume && (
                  <a href={resume} className="underline">
                    Open in Cove
                  </a>
                )}
              </p>
            )}
          </>
        ) : id ? (
          <AppWorkspace
            key={id}
            id={id}
            view={view}
            navigate={open}
            back={() => navigate("/apps")}
            surface="page"
            attach={attach}
          />
        ) : (
          <AppDirectory
            key={target ? JSON.stringify(target) : "directory"}
            open={open}
            target={target}
            section={section}
            navigate={navigate}
          />
        )}
      </div>
    </main>
  );
}
