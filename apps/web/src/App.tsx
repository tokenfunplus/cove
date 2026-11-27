import { lazy, Suspense, useState } from "react";
import { ChatPage } from "@/pages/ChatPage";
import { QuickPanelPage } from "@/pages/QuickPanelPage";
import { createConversation } from "@/api/conversations";

const MiniAppsPage = lazy(() => import("@/pages/MiniAppsPage"));

export function App() {
  const [incoming, setIncoming] = useState<{
    conversation: string;
    body: string;
  }>();
  if (/^\/apps(?:\/|$)/.test(window.location.pathname)) {
    return (
      <Suspense fallback={<p role="status">Opening apps…</p>}>
        <MiniAppsPage
          attach={async (body) => {
            const chat = await createConversation();
            window.history.replaceState(
              null,
              "",
              "/#conversation=" + encodeURIComponent(chat.id),
            );
            setIncoming({ conversation: chat.id, body });
          }}
        />
      </Suspense>
    );
  }
  if (
    new URLSearchParams(window.location.search).get("surface") === "quick-panel"
  ) {
    return <QuickPanelPage />;
  }
  return (
    <ChatPage
      incomingAppDraft={incoming}
      consumedAppDraft={() => setIncoming(undefined)}
    />
  );
}
