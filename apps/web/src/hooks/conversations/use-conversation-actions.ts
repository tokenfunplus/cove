import {
  useConversationCache,
  useCreateConversation,
  useRenameConversation,
  useUpdateConversation,
} from "@/api/hooks/useConversations";

import { type GenerationState } from "@/hooks/chat/use-generation-state";
import { type WorkspaceState } from "@/hooks/workspace/use-workspace-state";
import { type WorkspaceUi } from "@/hooks/workspace/use-workspace-ui";
import { type ApplicationCopy } from "@/messages";

type Dependencies = Pick<
  WorkspaceUi,
  | "setFeedback"
  | "setShowingArchived"
  | "setMobileSidebarOpen"
  | "setIsSavingTitle"
  | "showingArchived"
  | "setRenameTarget"
  | "setDownloadTarget"
> &
  Pick<
    WorkspaceState,
    "setSelectedId" | "setConnection" | "selectedIdRef" | "setConversationView"
  > &
  Pick<GenerationState, "isSending"> & { copy: ApplicationCopy };

export function useConversationActions({
  setFeedback,
  setShowingArchived,
  setSelectedId,
  setConnection,
  setMobileSidebarOpen,
  copy,
  setIsSavingTitle,
  showingArchived,
  selectedIdRef,
  setConversationView,
  setRenameTarget,
  setDownloadTarget,
  isSending,
}: Dependencies) {
  const createConversation = useCreateConversation().mutateAsync;
  const renameConversation = useRenameConversation().mutateAsync;
  const updateConversation = useUpdateConversation().mutateAsync;
  const {
    loadConversation: getConversation,
    loadConversations: getConversations,
  } = useConversationCache();

  async function handleCreateConversation() {
    setFeedback(undefined);
    try {
      const conversation = await createConversation(undefined);
      setShowingArchived(false);

      setSelectedId(conversation.id);
      setConnection("ready");
      setMobileSidebarOpen(false);
    } catch {
      setFeedback(copy.createFailed);
    }
  }

  async function saveConversationTitle(conversationID: string, title: string) {
    if (!title.trim()) {
      return;
    }
    setIsSavingTitle(true);
    setFeedback(undefined);
    try {
      await renameConversation({ id: conversationID, title: title });
      const view = await getConversation(conversationID);

      if (selectedIdRef.current === conversationID) {
        setConversationView(view);
      }
      setRenameTarget(undefined);
    } catch {
      setFeedback(copy.renameFailed);
    } finally {
      setIsSavingTitle(false);
    }
  }

  async function handleRequestDownload(conversationID: string) {
    setFeedback(undefined);
    try {
      setDownloadTarget(await getConversation(conversationID));
    } catch {
      setFeedback(copy.downloadFailed);
    }
  }

  async function handleUpdateConversation(
    conversationID: string,
    input: { pinned?: boolean; archived?: boolean },
  ) {
    if (isSending) {
      return;
    }
    setFeedback(undefined);
    try {
      await updateConversation({ id: conversationID, input: input });
      const refreshed = await getConversations({ archived: showingArchived });

      if (
        conversationID === selectedIdRef.current &&
        input.archived !== undefined &&
        input.archived !== showingArchived
      ) {
        setSelectedId(refreshed[0]?.id);
        setConversationView(undefined);
      } else if (conversationID === selectedIdRef.current) {
        const view = await getConversation(conversationID);
        setConversationView(view);
      }
    } catch {
      setFeedback(copy.conversationUpdateFailed);
    }
  }

  async function handleConversationListMode(nextShowingArchived: boolean) {
    if (isSending || nextShowingArchived === showingArchived) {
      return;
    }
    setFeedback(undefined);
    try {
      const refreshed = await getConversations({
        archived: nextShowingArchived,
      });
      setShowingArchived(nextShowingArchived);

      setSelectedId(refreshed[0]?.id);
      setMobileSidebarOpen(false);
    } catch {
      setFeedback(copy.conversationUpdateFailed);
    }
  }

  async function refreshCurrentConversation() {
    if (!selectedIdRef.current) return;
    const refreshed = await getConversation(selectedIdRef.current);
    if (refreshed.id === selectedIdRef.current) setConversationView(refreshed);
  }

  return {
    handleCreateConversation,
    saveConversationTitle,
    handleRequestDownload,
    handleUpdateConversation,
    handleConversationListMode,
    refreshCurrentConversation,
  };
}

export type ConversationActions = ReturnType<typeof useConversationActions>;
