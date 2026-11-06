import { LocalServiceError } from "@/api";
import { useConversationCache } from "@/api/hooks/useConversations";
import {
  useCancelGeneration,
  useCancelGenerationBatch,
  useCreateGenerationBatch,
  useGenerationCache,
  useRetryGenerationTarget,
  useSelectGenerationAnswer,
  useSkipGenerationBatchContext,
} from "@/api/hooks/useGenerations";
import {
  secureTargetForCatalog,
  type ModelCatalogs,
  type ProviderSelectionStatus,
} from "@/components/providers/model-selection";
import { type BatchEvents } from "@/hooks/chat/use-batch-events";
import { type GenerationState } from "@/hooks/chat/use-generation-state";
import { type PrivateGeneration } from "@/hooks/chat/use-private-generation";
import { type ConversationActions } from "@/hooks/conversations/use-conversation-actions";
import { type WorkspaceState } from "@/hooks/workspace/use-workspace-state";
import { type WorkspaceUi } from "@/hooks/workspace/use-workspace-ui";
import {
  createLiveTurn,
  hydrateLiveTurnBatch,
  liveTurnFromBatch,
  replaceLiveTargetAttempt,
} from "@/lib/chat/live-turn";
import { generationErrorMessage } from "@/lib/error-messages";
import { type ApplicationCopy } from "@/messages";
import { type GenerationBatch } from "@cove/api-contract";

type Dependencies = Pick<
  WorkspaceState,
  | "activeModelSet"
  | "providerProfiles"
  | "selectedId"
  | "selectedIdRef"
  | "setConversationView"
  | "conversationView"
> &
  Pick<
    GenerationState,
    | "isSending"
    | "draft"
    | "setDraft"
    | "setIsSending"
    | "setLiveTurn"
    | "setGenerationBatch"
    | "generationBatch"
    | "secureGenerationRunsRef"
    | "secureInferenceAbortRef"
    | "secureInferenceFinishedRef"
  > &
  Pick<WorkspaceUi, "setFeedback" | "showingArchived"> &
  Pick<PrivateGeneration, "streamSecureGeneration"> &
  Pick<BatchEvents, "streamGenerationBatch"> &
  Pick<ConversationActions, "refreshCurrentConversation"> & {
    selectionStatus: ProviderSelectionStatus;
    catalogs: ModelCatalogs;
    copy: ApplicationCopy;
  };

export function useGenerationCommands({
  activeModelSet,
  providerProfiles,
  isSending,
  selectedId,
  draft,
  selectionStatus,
  setDraft,
  setFeedback,
  setIsSending,
  setLiveTurn,
  selectedIdRef,
  setGenerationBatch,
  showingArchived,
  setConversationView,
  catalogs,
  streamSecureGeneration,
  streamGenerationBatch,
  copy,
  generationBatch,
  secureGenerationRunsRef,
  secureInferenceAbortRef,
  secureInferenceFinishedRef,
  conversationView,
  refreshCurrentConversation,
}: Dependencies) {
  const cancelGeneration = useCancelGeneration().mutateAsync;
  const cancelGenerationBatch = useCancelGenerationBatch().mutateAsync;
  const createGenerationBatch = useCreateGenerationBatch().mutateAsync;
  const retryGenerationTarget = useRetryGenerationTarget().mutateAsync;
  const selectGenerationAnswer = useSelectGenerationAnswer().mutateAsync;
  const skipGenerationBatchContext =
    useSkipGenerationBatchContext().mutateAsync;
  const {
    loadConversation: getConversation,
    loadConversations: getConversations,
  } = useConversationCache();
  const { loadBatch: getGenerationBatch } = useGenerationCache();

  async function handleSend() {
    const selectedTargets = activeModelSet.filter((target) =>
      providerProfiles.some(
        (profile) => profile.id === target.providerId && profile.configured,
      ),
    );
    if (
      isSending ||
      !selectedId ||
      !draft.trim() ||
      selectionStatus !== "ready" ||
      selectedTargets.length !== activeModelSet.length ||
      selectedTargets.length === 0
    ) {
      return;
    }
    const body = draft.trim();
    const clientRequestId = crypto.randomUUID();
    setDraft("");
    setFeedback(undefined);
    setIsSending(true);
    setLiveTurn(
      createLiveTurn(selectedId, body, clientRequestId, selectedTargets),
    );
    try {
      const selection = { clientRequestId, body };
      let next: GenerationBatch;
      try {
        next = await createGenerationBatch({
          conversationId: selectedId,
          selection: selection,
        });
      } catch (error) {
        if (error instanceof LocalServiceError) throw error;
        next = await createGenerationBatch({
          conversationId: selectedId,
          selection: selection,
        });
      }
      if (selectedIdRef.current !== selectedId) {
        await cancelGenerationBatch(next.id).catch(() => undefined);
        return;
      }
      setGenerationBatch(next);
      setLiveTurn((current) =>
        current ? hydrateLiveTurnBatch(current, next) : current,
      );
      void Promise.all([
        getConversation(selectedId),
        getConversations({ archived: showingArchived }),
      ])
        .then(([view]) => {
          if (selectedIdRef.current === selectedId) {
            setConversationView(view);
          }
        })
        .catch(() => undefined);
      const secureTargets = next.targets.filter((target) =>
        secureTargetForCatalog(
          { providerId: target.provider_id, modelId: target.model_id },
          providerProfiles,
          catalogs,
        ),
      );
      const hasNonSecureTargets = secureTargets.length < next.targets.length;
      const secureRuns = secureTargets.flatMap((target) => {
        const profile = providerProfiles.find(
          (candidate) => candidate.id === target.provider_id,
        );
        return profile
          ? [streamSecureGeneration(next, target, profile, body)]
          : [];
      });
      await Promise.all([
        hasNonSecureTargets ? streamGenerationBatch(next) : Promise.resolve(),
        ...secureRuns,
      ]);
    } catch (error) {
      setDraft(body);
      setIsSending(false);
      setLiveTurn((current) =>
        current
          ? {
              ...current,
              targets: (current.targets ?? []).map((target) => ({
                ...target,
                phase:
                  error instanceof LocalServiceError ? "failed" : "unknown",
              })),
            }
          : current,
      );
      setFeedback(generationErrorMessage(error, copy));
    }
  }

  async function handleCancel() {
    const activeBatchID = generationBatch?.id;
    const runs = [...secureGenerationRunsRef.current.values()].filter(
      (run) => run.batchID === activeBatchID,
    );
    if (runs.length > 0) {
      for (const run of runs) run.controller.abort();
      const batchCancellation = generationBatch
        ? cancelGenerationBatch(generationBatch.id).catch(() => undefined)
        : Promise.resolve();
      await Promise.allSettled([
        ...runs.map((run) => run.finished),
        batchCancellation,
      ]);
      return;
    }
    if (secureInferenceAbortRef.current) {
      secureInferenceAbortRef.current.abort();
      await secureInferenceFinishedRef.current;
      return;
    }
    if (!generationBatch) {
      return;
    }
    try {
      const stopped = await cancelGenerationBatch(generationBatch.id);
      setGenerationBatch(stopped);
    } catch (error) {
      setFeedback(generationErrorMessage(error, copy));
    }
  }

  async function handleCancelTarget(batchID: string, generationID: string) {
    try {
      const secureRun = secureGenerationRunsRef.current.get(generationID);
      if (secureRun) {
        secureRun.controller.abort();
        await secureRun.finished;
        return;
      }
      await cancelGeneration(generationID);
      const batch = await getGenerationBatch(batchID);
      if (generationBatch?.id === batchID) setGenerationBatch(batch);
      setLiveTurn((current) =>
        current?.batchId === batchID
          ? hydrateLiveTurnBatch(current, batch)
          : current,
      );
    } catch (error) {
      setFeedback(generationErrorMessage(error, copy));
    }
  }

  async function handleRetry(batchID: string, targetID: string) {
    if (isSending) return;
    setFeedback(undefined);
    const clientRequestId = crypto.randomUUID();
    setIsSending(true);
    try {
      const next = await retryGenerationTarget({
        targetId: targetID,
        clientRequestId: clientRequestId,
      });
      const batch = await getGenerationBatch(batchID);
      setGenerationBatch(batch);
      const userBody =
        conversationView?.messages.find(
          (message) => message.id === batch.user_message_id,
        )?.body ?? "";
      setLiveTurn((current) =>
        current?.batchId === batchID
          ? replaceLiveTargetAttempt(current, targetID, next)
          : replaceLiveTargetAttempt(
              liveTurnFromBatch(batch.conversation_id, userBody, batch),
              targetID,
              next,
            ),
      );
      const retryProfile = providerProfiles.find(
        (profile) =>
          profile.id ===
          batch.targets.find((target) => target.id === targetID)?.provider_id,
      );
      if (
        retryProfile &&
        secureTargetForCatalog(
          {
            providerId: retryProfile.id,
            modelId:
              batch.targets.find((target) => target.id === targetID)
                ?.model_id ?? "",
          },
          providerProfiles,
          catalogs,
        )
      ) {
        await Promise.all([
          streamGenerationBatch(batch),
          streamSecureGeneration(
            batch,
            batch.targets.find((target) => target.id === targetID)!,
            retryProfile,
            userBody,
          ),
        ]);
      } else {
        await streamGenerationBatch(batch);
      }
    } catch (error) {
      setIsSending(false);
      setFeedback(generationErrorMessage(error, copy));
    }
  }

  async function handleSelectAnswer(batchID: string, generationID: string) {
    try {
      await selectGenerationAnswer(generationID);
      if (generationBatch?.id === batchID)
        setGenerationBatch(await getGenerationBatch(batchID));
      await refreshCurrentConversation();
    } catch (error) {
      setFeedback(generationErrorMessage(error, copy));
    }
  }

  async function handleSkipContext(batchID: string) {
    try {
      await skipGenerationBatchContext(batchID);
      if (generationBatch?.id === batchID)
        setGenerationBatch(await getGenerationBatch(batchID));
      await refreshCurrentConversation();
    } catch (error) {
      setFeedback(generationErrorMessage(error, copy));
    }
  }

  return {
    handleSend,
    handleCancel,
    handleCancelTarget,
    handleRetry,
    handleSelectAnswer,
    handleSkipContext,
  };
}

export type GenerationCommands = ReturnType<typeof useGenerationCommands>;
