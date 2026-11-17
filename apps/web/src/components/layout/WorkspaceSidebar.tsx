import { workspaceStyles } from "@/styles/workspace";
import { baseStyles } from "@/styles/base";
import { cn } from "@/lib/utils";
import { CoveMark } from "@/components/ui/CoveMark";
import { ConversationList } from "@/components/conversations/ConversationList";
import { SidebarToggle } from "@/components/layout/SidebarToggle";
import { Dialog, DialogOverlay, DialogContent } from "@/components/ui/dialog";

import { type ChatWorkspace } from "@/hooks/workspace/use-chat-workspace";

type Props = {
  workspace: Pick<
    ChatWorkspace,
    | "copy"
    | "focusMode"
    | "exitFocusMode"
    | "narrowLayout"
    | "mobileSidebarOpen"
    | "sidebarCollapsed"
    | "setMobileSidebarOpen"
    | "setSidebarCollapsed"
    | "conversations"
    | "conversationSearch"
    | "conversationSearchQuery"
    | "setConversationSearchQuery"
    | "selectedId"
    | "showingArchived"
    | "handleSelectConversation"
    | "handleCreateConversation"
    | "setRenameTarget"
    | "handleUpdateConversation"
    | "handleRequestDownload"
    | "handleDeleteConversation"
    | "handleConversationListMode"
    | "setSettingsEntry"
    | "setPrivacyStatusOpen"
    | "isSending"
  >;
};

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
        conversations={conversations}
        searchQuery={conversationSearchQuery}
        onSearchQueryChange={setConversationSearchQuery}
        searchResults={conversationSearch.results}
        searchPending={conversationSearch.pending}
        searchFailed={conversationSearch.failed}
        selectedId={selectedId}
        showingArchived={showingArchived}
        onSelect={(id, messageId) => void handleSelectConversation(id, messageId)}
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
        copy={copy}
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
