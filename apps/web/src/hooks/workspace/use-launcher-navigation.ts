import { useEffect } from "react";
import type { ConnectionState } from "@/lib/workspace-types";

type Dependencies = {
  connection: ConnectionState;
  onNewChat: () => Promise<void>;
  onOpenSettings: (entry: "general") => void;
};

export function useLauncherNavigation({
  connection,
  onNewChat,
  onOpenSettings,
}: Dependencies) {
  useEffect(() => {
    if (connection !== "ready") return;
    const destination = window.location.hash;
    if (destination !== "#new-chat" && destination !== "#settings") return;
    // Consume the presentation intent before dispatch so rerenders cannot repeat it.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
    if (destination === "#settings") onOpenSettings("general");
    else void onNewChat();
  }, [connection, onNewChat, onOpenSettings]);
}
