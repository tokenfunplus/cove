import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { observeBrowserSessionExpiry } from "@/api/client";
import { useLocalSession } from "@/api/hooks/useSession";
import { Button } from "@/components/ui/button";
import {
  AppDirectory,
  type InstallTarget,
} from "@/components/miniapps/AppDirectory";
import { AppWorkspace } from "@/components/miniapps/AppWorkspace";
import { appBookmark, ErrorMessage } from "@/components/miniapps/presentation";
import { isConversationId } from "@/lib/launcher-intent";

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
function navigate(path: string) {
  if (window.location.pathname !== path) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}
export default function MiniAppsPage({
  attach,
}: {
  attach: (body: string) => Promise<void>;
}) {
  const path = useSyncExternalStore(subscribe, () => window.location.pathname);
  const { id, view, target, invalid } = route(path);
  const session = useLocalSession();
  const [expired, setExpired] = useState(false);
  useEffect(() => observeBrowserSessionExpiry(() => setExpired(true)), []);
  const open = useCallback((instance: string, nextView?: string) => {
    navigate(
      "/apps/" +
        encodeURIComponent(instance) +
        (nextView ? "/" + encodeURIComponent(nextView) : ""),
    );
  }, []);
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
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Mini Apps</h1>
          <Button asChild size="sm" variant="outline">
            <a href="/">Cove Chat</a>
          </Button>
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
          <AppDirectory key={path} open={open} target={target} />
        )}
      </div>
    </main>
  );
}
