import { workspaceStyles } from "@/styles/workspace";
import { Button } from "@/components/ui/button";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

export function SidebarToggle({
  collapsed,
  onToggle,
  copy = englishConversationCopy,
}: {
  collapsed: boolean;
  onToggle: () => void;
  copy?: ApplicationCopy;
}) {
  return (
    <Button
      variant="outline"
      aria-controls="conversation-sidebar"
      aria-expanded={!collapsed}
      aria-label={collapsed ? copy.expandSidebar : copy.collapseSidebar}
      className={workspaceStyles.workspaceSidebar_toggle}
      onClick={onToggle}
      type="button"
    >
      {collapsed ? (
        <PanelLeftOpen aria-hidden="true" size={16} strokeWidth={1.8} />
      ) : (
        <PanelLeftClose aria-hidden="true" size={16} strokeWidth={1.8} />
      )}
    </Button>
  );
}
