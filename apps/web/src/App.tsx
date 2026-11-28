import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Portal } from "@headlessui/react";
import { ChatPage } from "@/pages/ChatPage";
import { QuickPanelPage } from "@/pages/QuickPanelPage";
import { createConversation } from "@/api/conversations";
import { navigateWorkspace } from "@/lib/workspace-navigation";
import { WorkspaceActiveContext } from "@/lib/workspace-active";

const MiniAppsPage = lazy(() => import("@/pages/MiniAppsPage"));
const address = () => window.location.pathname + window.location.search;
const isApps = (path: string) => /^\/apps(?:\/|$)/.test(path.split("?")[0]!);
const isQuickPanel = (path: string) =>
  !isApps(path) && new URLSearchParams(path.split("?")[1]).get("surface") === "quick-panel";

export function App() {
  const [location, setLocation] = useState(address);
  const [chatOpened, setChatOpened] = useState(() => !isApps(address()) && !isQuickPanel(address()));
  const [incoming, setIncoming] = useState<{ conversation: string; body: string }>();
  const chatSurface = useRef<HTMLDivElement>(null);
  const attempt = useRef(0);
  const apps = isApps(location);

  useEffect(() => {
    const navigate = () => {
      attempt.current++;
      const destination = address();
      setLocation(destination);
      if (!isApps(destination) && !isQuickPanel(destination)) setChatOpened(true);
    };
    window.addEventListener("popstate", navigate);
    window.addEventListener("hashchange", navigate);
    return () => {
      attempt.current++;
      window.removeEventListener("popstate", navigate);
      window.removeEventListener("hashchange", navigate);
    };
  }, []);

  if (isQuickPanel(location)) return <QuickPanelPage />;
  return (
    <>
      <WorkspaceActiveContext value={!apps}>
        <div
          ref={chatSurface}
          className={apps ? "invisible fixed inset-0" : "contents"}
          inert={apps}
          aria-hidden={apps || undefined}
        >
          <Portal.Group target={chatSurface}>
            {chatOpened && (
              <ChatPage
                incomingAppDraft={incoming}
                consumedAppDraft={() => setIncoming(undefined)}
              />
            )}
          </Portal.Group>
        </div>
      </WorkspaceActiveContext>
      {apps && (
        <Suspense fallback={<p role="status">Opening apps…</p>}>
          <MiniAppsPage
            attach={async (body) => {
              const token = attempt.current;
              const origin = window.location.href;
              const chat = await createConversation();
              if (attempt.current !== token || window.location.href !== origin) return;
              setIncoming({ conversation: chat.id, body });
              navigateWorkspace("/#conversation=" + encodeURIComponent(chat.id), true);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
