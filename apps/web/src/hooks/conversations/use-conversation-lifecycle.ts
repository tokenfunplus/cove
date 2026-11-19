import { useGenerationCache } from "@/api/hooks/useGenerations";
import {
  useClearChatData,
  useConversationCache,
  useDeleteConversation,
} from "@/api/hooks/useConversations";

import { type GenerationCommands } from "@/hooks/chat/use-generation-commands";
import { type GenerationState } from "@/hooks/chat/use-generation-state";
import { type AttachmentDraft } from "@/hooks/chat/use-attachment-draft";
import { type ConversationActions } from "@/hooks/conversations/use-conversation-actions";
import { useEffect } from "react";
import { type WorkspaceState } from "@/hooks/workspace/use-workspace-state";
import { type WorkspaceUi } from "@/hooks/workspace/use-workspace-ui";
import {
  type ConversationExportFormat,
  downloadWorkspaceExport,
  loadWorkspaceExportViews,
} from "@/lib/conversation-export";
import { type ApplicationCopy } from "@/messages";
import { loadDebateForExport } from "@/api/debates";

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
    | "draft"
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
    | "setConversationNavigation"
    | "isNavigating"
    | "setIsNavigating"
  > &
  Pick<GenerationCommands, "handleCancel"> &
  Pick<ConversationActions, "handleCreateConversation" | "handleConversationListMode" | "handleUpdateConversation"> &
  { copy: ApplicationCopy; attachmentDraft: AttachmentDraft; onChatDataCleared?: () => void };

export function useConversationLifecycle({
  onChatDataCleared,
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
  setConversationNavigation,
  isNavigating,
  setIsNavigating,
  draft,
  attachmentDraft,
  handleCreateConversation: createConversation,
  handleConversationListMode: changeListMode,
  handleUpdateConversation: updateConversation,
}: Dependencies) {
  const { loadBatch } = useGenerationCache();
  const clearChatData = useClearChatData().mutateAsync;
  const deleteConversation = useDeleteConversation().mutateAsync;
  const {
    loadConversation: getConversation,
    loadConversations: getConversations,
  } = useConversationCache();
  const hasDraft = Boolean(draft.trim() || attachmentDraft.attachments.length);
  const activeGeneration = Boolean(isSending || generationBatch?.state === "pending" || generationBatch?.state === "streaming");

  useEffect(() => {
    if (!hasDraft) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [hasDraft]);

  async function withNavigationBusy(action: () => Promise<unknown>) {
    setIsNavigating(true);
    try { await action(); }
    finally { setIsNavigating(false); }
  }

  async function handleCreateConversation() {
    if (isNavigating) return;
    if (hasDraft || activeGeneration) {
      setConfirmation({ kind: "new", discardDraft: hasDraft, stopGeneration: activeGeneration });
      return;
    }
    await withNavigationBusy(createConversation);
  }

  async function handleConversationListMode(archived: boolean) {
    if (isNavigating) return;
    if (archived === showingArchived) return;
    if (hasDraft || activeGeneration) {
      setConfirmation({ kind: "navigate", discardDraft: hasDraft, stopGeneration: activeGeneration, navigationAction: () => changeListMode(archived) });
    } else await withNavigationBusy(() => changeListMode(archived));
  }

  async function handleUpdateConversation(id: string, input: { pinned?: boolean; archived?: boolean }) {
    if (isNavigating) return;
    const changesSelection = id === selectedId && input.archived !== undefined && input.archived !== showingArchived;
    if (changesSelection && (hasDraft || activeGeneration)) {
      setConfirmation({ kind: "navigate", discardDraft: hasDraft, stopGeneration: activeGeneration, navigationAction: () => updateConversation(id, input) });
    } else if (!isSending) {
      if (changesSelection) await withNavigationBusy(() => updateConversation(id, input));
      else await updateConversation(id, input);
    }
  }

  function navigateToConversation(id: string, messageId?: string) {
    setSelectedId(id);
    setConversationNavigation(messageId ? { conversationId: id, messageId, requestId: crypto.randomUUID() } : undefined);
    setMobileSidebarOpen(false);
  }

  async function handleSelectConversation(id: string, messageId?: string) {
    if (isNavigating) return;
    if (id === selectedId) {
      if (messageId) navigateToConversation(id, messageId);
      return;
    }
    if (activeGeneration || hasDraft) {
      setConfirmation({ kind: "switch", conversationId: id, messageId, discardDraft: hasDraft, stopGeneration: activeGeneration });
      return;
    }
    navigateToConversation(id, messageId);
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
        if (!(await handleCancel())) throw new Error("Generation cancellation failed");
        if (generationBatch) {
          const stopped = await loadBatch(generationBatch.id);
          if (stopped.state === "pending" || stopped.state === "streaming")
            throw new Error("Generation has not stopped");
        }
      }
      selectedIdRef.current = undefined;
      await clearChatData();
      onChatDataCleared?.();

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
    if (!request || isNavigating) return;
    if (request.kind === "switch" || request.kind === "new" || request.kind === "navigate") {
      setIsNavigating(true);
      try {
        const needsStop = Boolean(
          secureInferenceAbortRef.current ||
          secureGenerationRunsRef.current.size > 0 ||
          generationBatch?.state === "pending" ||
          generationBatch?.state === "streaming" || isSending
        );
        if (needsStop && !(await handleCancel())) return;
        if (request.kind === "navigate") await request.navigationAction?.();
        else if (request.kind === "new") {
          if (!(await createConversation())) return;
        } else if (request.conversationId) {
          navigateToConversation(request.conversationId, request.messageId);
        }
        setConfirmation(undefined);
        setMobileSidebarOpen(false);
      } finally {
        setIsNavigating(false);
      }
      return;
    }
    setConfirmation(undefined);
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
        async (id) => loadDebateForExport(await getConversation(id)),
      );
      downloadWorkspaceExport(views, format);
    } catch {
      setFeedback(copy.downloadFailed);
    }
  }

  return {
    handleCreateConversation,
    handleConversationListMode,
    handleUpdateConversation,
    handleSelectConversation,
    handleDeleteConversation,
    deleteConfirmedConversation,
    handleClearChatData,
    clearConfirmedChatData,
    confirmRequestedAction,
    handleExportChatData,
  };
}
