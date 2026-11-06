import { useCancelGeneration } from "@/api/hooks/useGenerations";
import { useProviderCatalogs } from "@/hooks/providers/use-provider-catalogs";

import { secureTargetForCatalog } from "@/components/providers/model-selection";
import { useBatchEvents } from "@/hooks/chat/use-batch-events";
import { useGenerationCommands } from "@/hooks/chat/use-generation-commands";
import { useGenerationState } from "@/hooks/chat/use-generation-state";
import { usePrivateGeneration } from "@/hooks/chat/use-private-generation";
import { useConversationActions } from "@/hooks/conversations/use-conversation-actions";
import { useConversationLifecycle } from "@/hooks/conversations/use-conversation-lifecycle";
import { useModelSelection } from "@/hooks/providers/use-model-selection";
import { useProviderActions } from "@/hooks/providers/use-provider-actions";
import { useNarrowLayout } from "@/hooks/use-media-query";
import { usePrivateVerification } from "@/hooks/verification/use-private-verification";
import { useWorkspaceState } from "@/hooks/workspace/use-workspace-state";
import { useWorkspaceUi } from "@/hooks/workspace/use-workspace-ui";
import { liveTurnFromBatch } from "@/lib/chat/live-turn";
import { isTerminalGenerationState } from "@/lib/generation";
import { applicationMessages } from "@/messages";
import { useDocumentTheme } from "@/theme/use-document-theme";
import { useEffect } from "react";

export function useChatWorkspace() {
  const cancelGeneration = useCancelGeneration().mutateAsync;

  const workspaceUi = useWorkspaceUi();
  const workspaceState = useWorkspaceState(workspaceUi.showingArchived);
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

  const narrowLayout = useNarrowLayout();

  const copy = applicationMessages(settings.locale);

  const appearance = useDocumentTheme(settings.theme);

  useEffect(() => {
    if (!narrowLayout) setMobileSidebarOpen(false);
  }, [narrowLayout]);

  const { catalogs, activeSelection, catalog, selectionStatus } =
    useProviderCatalogs(providerProfiles, activeModelSet);

  useEffect(() => {
    setResumeGenerationBatch(conversationView?.active_generation_batch);
  }, [conversationView?.id]);

  useEffect(() => {
    if (conversationError) setFeedback(copy.unavailable);
  }, [conversationError, copy.unavailable]);

  useEffect(() => {
    setGenerationBatch(undefined);
    setLiveTurn(undefined);
    setResumeGenerationBatch(undefined);
    setDraft("");
    setIsSending(false);
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
    const catalogStillLoading = resumeGenerationBatch.targets.some((target) => {
      const profile = providerProfiles.find(
        (candidate) => candidate.id === target.provider_id,
      );
      const catalogState = catalogs[target.provider_id];
      return (
        profile?.kind === "nearai" &&
        (!catalogState ||
          catalogState.status === "idle" ||
          catalogState.status === "loading")
      );
    });
    if (catalogStillLoading) return;
    const userBody =
      conversationView.messages.find(
        (message) => message.id === resumeGenerationBatch.user_message_id,
      )?.body ?? "";
    setLiveTurn(
      liveTurnFromBatch(conversationView.id, userBody, resumeGenerationBatch),
    );
    setGenerationBatch(resumeGenerationBatch);
    setIsSending(true);
    setResumeGenerationBatch(undefined);
    const secureTargets = resumeGenerationBatch.targets.filter((target) =>
      secureTargetForCatalog(
        { providerId: target.provider_id, modelId: target.model_id },
        providerProfiles,
        catalogs,
      ),
    );
    if (secureTargets.length > 0) {
      void Promise.all(
        secureTargets
          .filter(
            (target) => !isTerminalGenerationState(target.generation.state),
          )
          .map((target) => cancelGeneration(target.generation.id)),
      )
        .then(() => {
          if (secureTargets.length === resumeGenerationBatch.targets.length)
            setIsSending(false);
          return refreshCurrentConversation();
        })
        .catch(() => {
          setIsSending(false);
        });
      if (secureTargets.length < resumeGenerationBatch.targets.length)
        void streamGenerationBatch(resumeGenerationBatch);
    } else {
      void streamGenerationBatch(resumeGenerationBatch);
    }
  }, [catalogs, conversationView, providerProfiles, resumeGenerationBatch]);

  const conversationActions = useConversationActions({
    ...workspaceState,
    ...workspaceUi,
    ...generationState,
    copy,
  });
  const { refreshCurrentConversation } = conversationActions;
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
    catalogs,
  });

  const generationCommands = useGenerationCommands({
    ...workspaceState,
    ...workspaceUi,
    ...generationState,
    ...conversationActions,
    ...batchEvents,
    ...privateGeneration,
    selectionStatus,
    catalogs,
    copy,
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
    copy,
  });

  const providerActions = useProviderActions({
    ...workspaceState,
    ...workspaceUi,
    ...modelSelection,
    copy,
  });

  return {
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
