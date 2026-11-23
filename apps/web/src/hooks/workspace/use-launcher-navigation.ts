import { useEffect } from "react";
import { isConversationId } from "@/lib/launcher-intent";
import type { ConnectionState } from "@/lib/workspace-types";

type Dependencies = {
  connection: ConnectionState;
  onNewChat: () => Promise<void>;
  onOpenSettings: (entry: "general" | "provider") => void;
  onOpenConversation?: (id: string) => Promise<void>;
};

export function useLauncherNavigation({
  connection,
  onNewChat,
  onOpenSettings,
  onOpenConversation,
}: Dependencies) {
  useEffect(() => {
    if (connection !== "ready") return;
    const navigate = () => {
      const destination = window.location.hash;
      const conversationId = destination.startsWith("#conversation=")
        ? destination.slice("#conversation=".length) : null;
      if (destination !== "#new-chat" && destination !== "#settings" && destination !== "#provider-setup" && !isConversationId(conversationId)) return;
      // Consume the presentation intent before dispatch so rerenders cannot repeat it.
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
      if (destination === "#settings") onOpenSettings("general");
      else if (destination === "#provider-setup") onOpenSettings("provider");
      else if (destination === "#new-chat") void onNewChat();
      else if (conversationId) void onOpenConversation?.(conversationId);
    };
    navigate();
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, [connection, onNewChat, onOpenSettings, onOpenConversation]);
}
