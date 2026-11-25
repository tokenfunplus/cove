import { modelMetadataForTarget } from "@/components/providers/model-selection";
import { useCreateConversation } from "@/api/hooks/useConversations";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useAnswerTools } from "@/hooks/chat/use-answer-tools";
import { useConversationSearch } from "@/api/hooks/useConversationSearch";
import { useProviderCatalogs } from "@/hooks/providers/use-provider-catalogs";

import { useBatchEvents } from "@/hooks/chat/use-batch-events";
import { useGenerationCommands } from "@/hooks/chat/use-generation-commands";
import { useGenerationState } from "@/hooks/chat/use-generation-state";
import { useAttachmentDraft } from "@/hooks/chat/use-attachment-draft";
import { usePrivateGeneration } from "@/hooks/chat/use-private-generation";
import { useConversationActions } from "@/hooks/conversations/use-conversation-actions";
import { useConversationLifecycle } from "@/hooks/conversations/use-conversation-lifecycle";
import { useModelSelection } from "@/hooks/providers/use-model-selection";
import { useProviderActions } from "@/hooks/providers/use-provider-actions";
import { useNarrowLayout } from "@/hooks/use-media-query";
import { usePrivateVerification } from "@/hooks/verification/use-private-verification";
import { useWorkspaceState } from "@/hooks/workspace/use-workspace-state";
import { useWorkspaceUi } from "@/hooks/workspace/use-workspace-ui";
import { useLauncherNavigation } from "@/hooks/workspace/use-launcher-navigation";
import { liveTurnFromBatch } from "@/lib/chat/live-turn";
import { applicationMessages } from "@/messages";
import { useDocumentTheme } from "@/theme/use-document-theme";
import { useWebSearch } from "@/hooks/chat/use-web-search";

export function useChatWorkspace({ quickPanel = false, catalogsEnabled = true } = {}) {
  const createConversation = useCreateConversation().mutateAsync;

  const workspaceUi = useWorkspaceUi();
  const workspaceState = useWorkspaceState(workspaceUi.showingArchived, quickPanel);
  const conversationSearch = useConversationSearch(
    workspaceUi.conversationSearchQuery,
    workspaceUi.showingArchived,
    workspaceState.connection === "ready",
    { ...workspaceUi.historyQueryFilters, projectId: "" },
  );
  const {
    selectedId,
    conversationView,
    conversationError,
    providerProfiles,
    activeModelSet,
    settings,
  } = workspaceState;
  const { setFeedback, setMobileSidebarOpen } = workspaceUi;
  const generationState = useGenerationState();
  const attachmentDraft = useAttachmentDraft(quickPanel ? undefined : selectedId, workspaceUi.localOnly);
  const webSearch = useWebSearch(selectedId, workspaceUi.setSettingsEntry, workspaceUi.setFeedback);
  const {
    setGenerationBatch,
    setDraft,
    setLiveTurn,
    setIsSending,
    resumeGenerationBatch,
    setResumeGenerationBatch,
    secureInferenceAbortRef,
    secureGenerationRunsRef,
  } = generationState;

  const pendingDraftTransfer = useRef<{ id: string; body: string } | undefined>(undefined);
  const quickChatDraftWasReset = useRef(false);
  const continuingProjectDraft = useRef(false);
  const creatingQuickChat = useRef(false);
  const narrowLayout = useNarrowLayout();

  const copy = applicationMessages(settings.locale);

  const appearance = useDocumentTheme(settings.theme);

  useEffect(() => {
    if (!narrowLayout) setMobileSidebarOpen(false);
  }, [narrowLayout]);

  const { catalogs, activeSelection, catalog, selectionStatus } =
    useProviderCatalogs(providerProfiles, activeModelSet, workspaceUi.localOnly, catalogsEnabled);
  const interactiveContext = activeModelSet[0]
    ? modelMetadataForTarget(catalogs, activeModelSet[0])?.context_length
    : undefined;
  const interactiveEnabled = activeModelSet.length === 1
    && activeModelSet[0].providerId !== "cove-local"
    && (interactiveContext == null || interactiveContext >= 8192);


  useEffect(() => {
    const active = conversationView?.active_generation_batch;
    setResumeGenerationBatch(
      active?.id === generationState.ownedBatchRef.current ? undefined : active,
    );
  }, [conversationView?.id]);

  useEffect(() => {
    // Keep the actionable operation error when a recovery read also fails.
    if (conversationError && workspaceUi.feedback?.tone !== "error") setFeedback(copy.unavailable);
  }, [conversationError, copy.unavailable]);

  useEffect(() => {
    // The first Quick Panel send attaches its in-memory draft to a new conversation.
    if (quickPanel && selectedId) return;
    setGenerationBatch(undefined);
    setLiveTurn(undefined);
    setResumeGenerationBatch(undefined);
    if (!quickChatDraftWasReset.current) setDraft("");
    quickChatDraftWasReset.current = false;
    setIsSending(false);
  }, [quickPanel, selectedId]);

  useEffect(() => {
    if (pendingDraftTransfer.current?.id === selectedId && pendingDraftTransfer.current) {
      setDraft(pendingDraftTransfer.current.body);
      pendingDraftTransfer.current = undefined;
    }
  }, [selectedId]);

  useEffect(
    () => () => {
      secureInferenceAbortRef.current?.abort();
      for (const run of secureGenerationRunsRef.current.values())
        run.controller.abort();
      flushPendingBatchEvents();
    },
    [],
  );

  useEffect(() => {
    if (
      !resumeGenerationBatch ||
      !conversationView ||
      resumeGenerationBatch.conversation_id !== conversationView.id
    ) {
      return;
    }
    const userBody =
      conversationView.messages.find(
        (message) => message.id === resumeGenerationBatch.user_message_id,
      )?.body ?? "";
    setLiveTurn({
      ...liveTurnFromBatch(
        conversationView.id,
        userBody,
        resumeGenerationBatch,
      ),
      restored: true,
    });
    setGenerationBatch(resumeGenerationBatch);
    setIsSending(true);
    setResumeGenerationBatch(undefined);
    // Private work may still be running in the Quick Panel or another window.
    void streamGenerationBatch(resumeGenerationBatch);
  }, [conversationView, resumeGenerationBatch]);

  const conversationActions = useConversationActions({
    onConversationCreated: (id, body, projectId) => {
      pendingDraftTransfer.current = { id, body };
      if (projectId) workspaceUi.setProjectDrafts(current => {
        const next = { ...current };
        delete next[projectId];
        return next;
      });
    },
    ...workspaceState,
    ...workspaceUi,
    ...generationState,
    copy,
  });
  const batchEvents = useBatchEvents({
    ...workspaceState,
    ...workspaceUi,
    ...generationState,
    copy,
  });
  const { flushPendingBatchEvents, streamGenerationBatch } = batchEvents;
  const privateVerification = usePrivateVerification({
    ...workspaceState,
    ...workspaceUi,
    ...generationState,
    catalogs,
    activeSelection,
    copy,
  });

  const privateGeneration = usePrivateGeneration({
    ...workspaceState,
    ...workspaceUi,
    ...generationState,
    ...conversationActions,
  });

  const answerTools = useAnswerTools({
    localOnly: workspaceUi.localOnly,
    activeModelSet,
    providerProfiles,
    catalogs,
    selectionStatus,
    copy,
    externalBusy: generationState.isSending || workspaceUi.isNavigating || workspaceUi.isClearingChatData,
  });

  const generationCommands = useGenerationCommands({
    interactiveEnabled,
    webSearchEnabled: webSearch.enabled && !workspaceUi.localOnly,
    attachmentDraft,
    ...workspaceState,
    ...workspaceUi,
    ...generationState,
    ...conversationActions,
    ...batchEvents,
    ...privateGeneration,
    selectionStatus,
    catalogs,
    copy,
    isSending: generationState.isSending || answerTools.busy,
  });

  const modelSelection = useModelSelection({
    ...workspaceState,
    ...workspaceUi,
    ...generationState,
    catalogs,
    copy,
  });

  const conversationLifecycle = useConversationLifecycle({
    ...workspaceState,
    ...workspaceUi,
    ...generationState,
    ...generationCommands,
    ...conversationActions,
    attachmentDraft,
    copy,
    isSending: generationState.isSending || answerTools.busy,
    handleCancel: async () => {
      const sideStopped = await answerTools.cancel();
      return sideStopped && (await generationCommands.handleCancel());
    },
    onChatDataCleared: answerTools.clear,
  });

  useLauncherNavigation({
    connection: quickPanel ? "loading" : workspaceState.connection,
    onNewChat: conversationLifecycle.handleCreateConversation,
    onOpenSettings: workspaceUi.setSettingsEntry,
    onOpenConversation: conversationLifecycle.handleSelectConversation,
  });

  const providerActions = useProviderActions({
    ...workspaceState,
    ...workspaceUi,
    ...modelSelection,
    copy,
  });

  async function handleQuickPanelSend() {
    if (creatingQuickChat.current || workspaceUi.isNavigating || workspaceState.connection !== "ready") return;
    const body = generationState.draft;
    if (selectedId) {
      await generationCommands.handleSend({ body, draftOnFailure: body });
      return;
    }
    if (!body.trim() || selectionStatus !== "ready" || !attachmentDraft.validateAttachments()) return;
    creatingQuickChat.current = true;
    workspaceUi.setIsNavigating(true);
    let conversationId: string;
    try {
      const conversation = await createConversation();
      conversationId = conversation.id;
      workspaceState.setConversationView({ ...conversation, messages: [] });
      flushSync(() => workspaceState.setSelectedId(conversation.id));
    } catch {
      setFeedback(copy.createFailed);
      return;
    } finally {
      creatingQuickChat.current = false;
      workspaceUi.setIsNavigating(false);
    }
    await generationCommands.handleSend({ conversationId, body, draftOnFailure: body });
  }

  function resetQuickChat(body = "") {
    quickChatDraftWasReset.current = Boolean(selectedId);
    setDraft(body);
    attachmentDraft.clearAttachments();
    workspaceState.setSelectedId(undefined);
    setFeedback(undefined);
  }

  function startBlankQuickChat() {
    if (generationState.draft.trim() || attachmentDraft.attachments.length) {
      workspaceUi.setConfirmation({ kind: "navigate", discardDraft: true, navigationAction: async () => resetQuickChat() });
    } else {
      resetQuickChat();
    }
  }

  async function continueProjectDraft() {
    if (
      continuingProjectDraft.current || workspaceUi.isNavigating ||
      generationState.isSending || attachmentDraft.invalid
    ) return;
    continuingProjectDraft.current = true;
    workspaceUi.setIsNavigating(true);
    const body = generationState.draft;
    const items = [...attachmentDraft.attachments];
    try {
      const next = await createConversation({ project_id: conversationView?.project_id });
      workspaceUi.setShowingArchived(false);
      pendingDraftTransfer.current = { id: next.id, body };
      attachmentDraft.transferToConversation(next.id, items);
      workspaceState.setSelectedId(next.id);
      workspaceUi.setProjectPage(undefined);
      return next.id;
    } catch {
      setFeedback("The new conversation could not be created. Your draft is preserved.");
    } finally {
      continuingProjectDraft.current = false;
      workspaceUi.setIsNavigating(false);
    }
  }
  return {
    interactiveEnabled,
    handleQuickPanelSend,
    resetQuickChat,
    startBlankQuickChat,
    continueProjectDraft,
    webSearch: {...webSearch, enabled:webSearch.enabled && !workspaceUi.localOnly},
    answerTools,
    conversationSearch,
    attachmentDraft,
    ...providerActions,
    ...workspaceState,
    ...workspaceUi,
    ...generationState,
    ...conversationActions,
    ...batchEvents,
    ...privateVerification,
    ...privateGeneration,
    ...generationCommands,
    ...modelSelection,
    ...conversationLifecycle,
    isSending: generationState.isSending || answerTools.busy,
    handleCancel: async () => {
      const sideStopped = await answerTools.cancel();
      return sideStopped && (await generationCommands.handleCancel());
    },
    activeSelection,
    appearance,
    narrowLayout,
    copy,
    catalogs,
    catalog,
    selectionStatus,
  };
}

export type ChatWorkspace = ReturnType<typeof useChatWorkspace>;
