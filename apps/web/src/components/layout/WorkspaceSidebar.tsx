import { Button } from "@/components/ui/button";
import { FolderClosed } from "lucide-react";
import { workspaceStyles } from "@/styles/workspace";
import { baseStyles } from "@/styles/base";
import { cn } from "@/lib/utils";
import { CoveMark } from "@/components/ui/CoveMark";
import { historyStyles } from "@/styles/history";
import { ConversationList } from "@/components/conversations/ConversationList";
import { SidebarToggle } from "@/components/layout/SidebarToggle";
import { Dialog, DialogOverlay, DialogContent } from "@/components/ui/dialog";

import { type ChatWorkspace } from "@/hooks/workspace/use-chat-workspace";

type Props = {workspace: ChatWorkspace};

export function WorkspaceSidebar({ workspace }: Props) {
  const {
    copy,
    focusMode,
    exitFocusMode,
    narrowLayout,
    mobileSidebarOpen,
    sidebarCollapsed,
    setMobileSidebarOpen,
    setSidebarCollapsed,
    conversations,
    conversationSearch,
    conversationSearchQuery,
    setConversationSearchQuery,
    selectedId,
    showingArchived,
    handleSelectConversation,
    handleCreateConversation,
    setRenameTarget,
    handleUpdateConversation,
    handleRequestDownload,
    handleDeleteConversation,
    handleConversationListMode,
    setSettingsEntry,
    setPrivacyStatusOpen,
    isSending,
  } = workspace;
  const projectsActive = Boolean(workspace.projectPage || workspace.conversationView?.project_id);
  const sidebarContents = (
    <>
      <div className={workspaceStyles.workspaceSidebar_brand}>
        <div className={workspaceStyles.workspaceSidebar_identity}>
          <div className={workspaceStyles.brandMark} aria-hidden="true">
            <CoveMark />
          </div>
          <div>
            <strong>Cove</strong>
            <p className={baseStyles.eyebrow}>{copy.privateLocalFirst}</p>
          </div>
        </div>
        <SidebarToggle
          collapsed={narrowLayout ? !mobileSidebarOpen : sidebarCollapsed}
          onToggle={() =>
            narrowLayout
              ? setMobileSidebarOpen(false)
              : setSidebarCollapsed((current) => !current)
          }
          copy={copy}
        />
      </div>
      <ConversationList
        navigation={<Button variant="ghost" type="button" aria-label="Projects" aria-current={projectsActive ? "page" : undefined} className={workspaceStyles.projectNavigation} onClick={() => { exitFocusMode();workspace.setProjectPage({});setMobileSidebarOpen(false); }}><FolderClosed className={cn(historyStyles.rowIcon, projectsActive && "text-primary")} aria-hidden="true"/><span className="truncate text-[13px]">Projects</span></Button>}
        onMoveToProject={conversation => {workspace.setProjectMoveTarget(conversation);setMobileSidebarOpen(false);}}
        revealSearch={
          focusMode
            ? () => {
                exitFocusMode();
                setSidebarCollapsed(false);
              }
            : !narrowLayout && sidebarCollapsed
            ? () => setSidebarCollapsed(false)
            : undefined
        }
        conversations={conversations.filter(conversation => !conversation.project_id)}
        historyFilters={workspace.historyFilters}
        historyQueryFilters={workspace.historyQueryFilters}
        onHistoryFiltersChange={workspace.setHistoryFilters}
        searchQuery={conversationSearchQuery}
        onSearchQueryChange={setConversationSearchQuery}
        searchResults={conversationSearch.results.filter(conversation => !conversation.project_id)}
        searchPending={conversationSearch.pending}
        searchFailed={conversationSearch.failed}
        selectedId={workspace.projectPage ? undefined : selectedId}
        showingArchived={showingArchived}
        onSelect={(id, messageId) => {void handleSelectConversation(id, messageId);}}
        onCreate={() => void handleCreateConversation()}
        onRename={(conversation) => {
          setRenameTarget(conversation);
          setMobileSidebarOpen(false);
        }}
        onPin={(conversation) =>
          void handleUpdateConversation(conversation.id, {
            pinned: !conversation.pinned,
          })
        }
        onArchive={(conversation) =>
          void handleUpdateConversation(conversation.id, {
            archived: !conversation.archived,
          })
        }
        onDownload={(conversation) => {
          void handleRequestDownload(conversation.id);
          setMobileSidebarOpen(false);
        }}
        onDelete={handleDeleteConversation}
        onShowArchived={(archived) => void handleConversationListMode(archived)}
        onOpenSettings={() => {
          setSettingsEntry("general");
          setMobileSidebarOpen(false);
        }}
        onOpenPrivacyStatus={() => {
          setPrivacyStatusOpen(true);
          setMobileSidebarOpen(false);
        }}
        deleteDisabled={isSending}
        copy={{ ...copy, noConversations: conversations.some(conversation => conversation.project_id) ? "Project chats are in Projects" : copy.noConversations }}
      />
    </>
  );
  return narrowLayout ? (
    <Dialog
      label={copy.chats}
      className={workspaceStyles.mobileSidebarDialog}
      open={mobileSidebarOpen && !focusMode}
      onClose={() => setMobileSidebarOpen(false)}
    >
      <DialogOverlay className={workspaceStyles.mobileSidebarDialog_backdrop} />
      <DialogContent
        as="aside"
        className={cn(
          workspaceStyles.conversationSidebar,
          workspaceStyles.mobileSidebarDialog_panel,
          "conversation-sidebar--nearai",
        )}
        id="conversation-sidebar"
      >
        {sidebarContents}
      </DialogContent>
    </Dialog>
  ) : (
    <aside
      className={cn(
        workspaceStyles.conversationSidebar,
        `conversation-sidebar conversation-sidebar--nearai${sidebarCollapsed ? " conversation-sidebar--collapsed" : ""}`,
        focusMode && "hidden",
      )}
      hidden={focusMode}
      id="conversation-sidebar"
    >
      {sidebarContents}
    </aside>
  );
}
