import { useGenerationCache } from "@/api/hooks/useGenerations";
import {
  useClearChatData,
  useConversationCache,
  useDeleteConversation,
} from "@/api/hooks/useConversations";

import { type GenerationCommands } from "@/hooks/chat/use-generation-commands";
import { type GenerationState } from "@/hooks/chat/use-generation-state";
import { type WorkspaceState } from "@/hooks/workspace/use-workspace-state";
import { type WorkspaceUi } from "@/hooks/workspace/use-workspace-ui";
import {
  type ConversationExportFormat,
  downloadWorkspaceExport,
  loadWorkspaceExportViews,
} from "@/lib/conversation-export";
import { type ApplicationCopy } from "@/messages";

type Dependencies = Pick<
  WorkspaceState,
  "selectedId" | "setSelectedId" | "setConversationView" | "selectedIdRef"
> &
  Pick<
    GenerationState,
    | "generationBatch"
    | "isSending"
    | "secureInferenceAbortRef"
    | "secureGenerationRunsRef"
    | "setIsSending"
    | "setLiveTurn"
    | "setGenerationBatch"
    | "setDraft"
  > &
  Pick<
    WorkspaceUi,
    | "setConfirmation"
    | "setMobileSidebarOpen"
    | "setFeedback"
    | "showingArchived"
    | "isClearingChatData"
    | "setIsClearingChatData"
    | "setShowingArchived"
    | "confirmation"
  > &
  Pick<GenerationCommands, "handleCancel"> & { copy: ApplicationCopy };

export function useConversationLifecycle({
  selectedId,
  generationBatch,
  isSending,
  setConfirmation,
  setSelectedId,
  setMobileSidebarOpen,
  setFeedback,
  showingArchived,
  copy,
  isClearingChatData,
  setIsClearingChatData,
  secureInferenceAbortRef,
  secureGenerationRunsRef,
  handleCancel,
  setShowingArchived,
  setConversationView,
  setGenerationBatch,
  setDraft,
  setIsSending,
  setLiveTurn,
  selectedIdRef,
  confirmation,
}: Dependencies) {
  const { loadBatch } = useGenerationCache();
  const clearChatData = useClearChatData().mutateAsync;
  const deleteConversation = useDeleteConversation().mutateAsync;
  const {
    loadConversation: getConversation,
    loadConversations: getConversations,
  } = useConversationCache();

  async function handleSelectConversation(id: string) {
    if (id === selectedId) return;
    const activeGeneration =
      generationBatch &&
      (generationBatch.state === "pending" ||
        generationBatch.state === "streaming");
    if (isSending || activeGeneration) {
      setConfirmation({ kind: "switch", conversationId: id });
      return;
    }
    setSelectedId(id);
    setMobileSidebarOpen(false);
  }

  function handleDeleteConversation(id: string) {
    if (isSending) return;
    setConfirmation({ kind: "delete", conversationId: id });
  }

  async function deleteConfirmedConversation(id: string) {
    setFeedback(undefined);
    try {
      await deleteConversation(id);
      const refreshed = await getConversations({ archived: showingArchived });

      if (id === selectedId) {
        setSelectedId(refreshed[0]?.id);
      }
    } catch {
      setFeedback(copy.deleteFailed);
    }
  }

  function handleClearChatData() {
    if (!isClearingChatData) setConfirmation({ kind: "clear" });
  }

  async function clearConfirmedChatData() {
    setIsClearingChatData(true);
    setFeedback(undefined);
    try {
      if (
        isSending ||
        generationBatch?.state === "pending" ||
        generationBatch?.state === "streaming" ||
        secureInferenceAbortRef.current ||
        secureGenerationRunsRef.current.size > 0
      ) {
        await handleCancel();
        if (generationBatch) {
          const stopped = await loadBatch(generationBatch.id);
          if (stopped.state === "pending" || stopped.state === "streaming")
            throw new Error("Generation has not stopped");
        }
      }
      selectedIdRef.current = undefined;
      await clearChatData();

      setShowingArchived(false);
      setSelectedId(undefined);
      setConversationView(undefined);

      setGenerationBatch(undefined);
      setLiveTurn(undefined);
      setIsSending(false);
      setDraft("");
      setFeedback(copy.chatDataCleared, "success");
    } catch {
      selectedIdRef.current = selectedId;
      setFeedback(copy.clearChatDataFailed);
    } finally {
      setIsClearingChatData(false);
    }
  }

  async function confirmRequestedAction() {
    const request = confirmation;
    if (!request) return;
    setConfirmation(undefined);
    if (request.kind === "switch" && request.conversationId) {
      const activeGeneration =
        generationBatch &&
        (generationBatch.state === "pending" ||
          generationBatch.state === "streaming");
      if (
        secureInferenceAbortRef.current ||
        secureGenerationRunsRef.current.size > 0 ||
        activeGeneration
      )
        await handleCancel();
      setSelectedId(request.conversationId);
      setMobileSidebarOpen(false);
      return;
    }
    if (request.kind === "delete" && request.conversationId) {
      await deleteConfirmedConversation(request.conversationId);
      return;
    }
    if (request.kind === "clear") await clearConfirmedChatData();
  }

  async function handleExportChatData(format: ConversationExportFormat) {
    try {
      const views = await loadWorkspaceExportViews(
        (archived) => getConversations({ archived }),
        getConversation,
      );
      downloadWorkspaceExport(views, format);
    } catch {
      setFeedback(copy.downloadFailed);
    }
  }

  return {
    handleSelectConversation,
    handleDeleteConversation,
    deleteConfirmedConversation,
    handleClearChatData,
    clearConfirmedChatData,
    confirmRequestedAction,
    handleExportChatData,
  };
}
