import { ChatPage } from "@/pages/ChatPage";
import { QuickPanelPage } from "@/pages/QuickPanelPage";

export function App() {
  if (new URLSearchParams(window.location.search).get("surface") === "quick-panel") {
    return <QuickPanelPage />;
  }
  return <ChatPage />;
}
