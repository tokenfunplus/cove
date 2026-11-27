import { lazy, Suspense, useEffect, useState } from "react";
import { ChatPage } from "@/pages/ChatPage";
import { QuickPanelPage } from "@/pages/QuickPanelPage";
import { createConversation } from "@/api/conversations";

const MiniAppsPage = lazy(() => import("@/pages/MiniAppsPage"));

export function App() {
  const [address, setAddress] = useState(
    () => window.location.pathname + window.location.search,
  );
  useEffect(() => {
    const navigate = () => {
      const next = window.location.pathname + window.location.search;
      if (next === address) return;
      const proceed = async () => {
        window.history.replaceState(window.history.state, "", next);
        setAddress(next);
      };
      if (!address.startsWith("/apps") && next.startsWith("/apps")) {
        // Restore the visible address while the existing Chat confirmation is open.
        window.history.replaceState(window.history.state, "", address);
        const intent = new CustomEvent("cove-workspace-navigation", {
          cancelable: true,
          detail: { proceed },
        });
        if (!window.dispatchEvent(intent)) return;
      }
      void proceed();
    };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, [address]);
  const [incoming, setIncoming] = useState<{
    conversation: string;
    body: string;
  }>();
  if (/^\/apps(?:\/|$)/.test(address.split("?")[0]!)) {
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
            setAddress("/");
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
