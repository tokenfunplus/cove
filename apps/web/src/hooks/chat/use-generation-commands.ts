import { flushSync } from "react-dom";
import type { ActiveModelSet } from "@/components/providers/model-selection";
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
  inferenceModeForSnapshot,
  modelMetadataForTarget,
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
import { type AttachmentDraft } from "@/hooks/chat/use-attachment-draft";

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
    | "ownedBatchRef"
    | "isSending"
    | "pendingSubmissionRef"
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
    attachmentDraft: AttachmentDraft;
    setSelectedId?: WorkspaceState["setSelectedId"];
  };

export function useGenerationCommands({
  attachmentDraft,
  setSelectedId,
  pendingSubmissionRef,
  ownedBatchRef,
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

  async function handleSend(override?: {
    body: string;
    editOfBatchId?: string;
    onAccepted?: () => void;
    onFailure?: (message: string) => void;
    targets?: ActiveModelSet;
    conversationId?: string;
    preserveDraft?: boolean;
    draftOnFailure?: string;
  }) {
    let conversationId = override?.conversationId ?? selectedId;
    const submittedBody = (override?.body ?? draft).trim();
    const requestedTargets = override?.targets ?? activeModelSet;
    const selectedTargets = requestedTargets.filter((target) =>
      providerProfiles.some(
        (profile) =>
          profile.id === target.providerId &&
          profile.configured &&
          activeModelSet.some(
            (current) =>
              current.providerId === target.providerId &&
              current.modelId === target.modelId,
          ),
      ),
    );
    if (
      isSending ||
      attachmentDraft.invalid ||
      !conversationId ||
      !submittedBody ||
      selectionStatus !== "ready" ||
      selectedTargets.length !== requestedTargets.length ||
      selectedTargets.length === 0
    ) {
      override?.onFailure?.(
        isSending ? copy.generationPending : copy.selectModel,
      );
      return;
    }
    const body = submittedBody;
    const originalAttachments = override?.editOfBatchId
      ? []
      : attachmentDraft.attachments;
    const clientRequestId = crypto.randomUUID();
    const submission = { cancelRequested: false };
    pendingSubmissionRef.current = submission;
    if (!override?.preserveDraft) setDraft("");
    setFeedback(undefined);
    setIsSending(true);
    setLiveTurn(
      createLiveTurn(conversationId, body, clientRequestId, selectedTargets),
    );
    let accepted = false;
    try {
      const selection = {
        ...(override?.editOfBatchId
          ? { editOfBatchId: override.editOfBatchId }
          : {}),
        clientRequestId,
        body,
        expectedTargets: selectedTargets.map((target) => ({
          provider_id: target.providerId,
          model_id: target.modelId,
          require_private_tee:
            providerProfiles.some(
              (profile) =>
                profile.id === target.providerId && profile.kind === "nearai",
            ) &&
            modelMetadataForTarget(catalogs, target)?.privacy_mode ===
              "private_tee",
        })),
        ...(originalAttachments.length
          ? {
              attachments: originalAttachments.flatMap((item) =>
                item.input ? [item.input] : [],
              ),
            }
          : {}),
      };
      let next: GenerationBatch;
      try {
        next = await createGenerationBatch({
          conversationId: conversationId,
          selection: selection,
        });
      } catch (error) {
        if (error instanceof LocalServiceError) throw error;
        next = await createGenerationBatch({
          conversationId: conversationId,
          selection: selection,
        });
      }
      const privacyMismatch = selection.expectedTargets.some(
        (target) =>
          target.require_private_tee &&
          !next.targets.some(
            (accepted) =>
              accepted.provider_id === target.provider_id &&
              accepted.model_id === target.model_id &&
              inferenceModeForSnapshot(accepted.generation.snapshot) ===
                "private_tee",
          ),
      );
      if (privacyMismatch) {
        await cancelGenerationBatch(next.id).catch(() => undefined);
        throw new LocalServiceError({
          error: {
            code: "private_tee_unavailable",
            message: copy.privateTEEUnavailable,
            details: null,
            request_id: "local",
          },
        });
      }
      if (pendingSubmissionRef.current === submission)
        pendingSubmissionRef.current = undefined;
      if (selectedIdRef.current !== conversationId) {
        await cancelGenerationBatch(next.id).catch(() => undefined);
        return;
      }
      ownedBatchRef.current = next.id;
      accepted = true;
      override?.onAccepted?.();
      if (override?.editOfBatchId && next.conversation_id !== conversationId) {
        if (!setSelectedId) {
          await cancelGenerationBatch(next.id);
          throw new Error("Branch navigation is unavailable.");
        }
        conversationId = next.conversation_id;
        flushSync(() => setSelectedId(conversationId));
        selectedIdRef.current = conversationId;
        setIsSending(true);
        setLiveTurn(
          createLiveTurn(
            conversationId,
            body,
            clientRequestId,
            selectedTargets,
          ),
        );
        const branchView = await getConversation(conversationId);
        if (selectedIdRef.current !== conversationId) {
          await cancelGenerationBatch(next.id);
          return;
        }
        setConversationView(branchView);
      }
      setGenerationBatch(next);
      attachmentDraft.clearAttachments();
      setLiveTurn((current) =>
        current ? hydrateLiveTurnBatch(current, next) : current,
      );
      if (submission.cancelRequested) {
        const stopped = await cancelGenerationBatch(next.id);
        setGenerationBatch(stopped);
        setLiveTurn((current) =>
          current ? hydrateLiveTurnBatch(current, stopped) : current,
        );
        setIsSending(false);
        await refreshCurrentConversation();
        return;
      }
      void Promise.all([
        getConversation(conversationId),
        getConversations({ archived: showingArchived }),
      ])
        .then(([view]) => {
          if (selectedIdRef.current === conversationId) {
            setConversationView(view);
          }
        })
        .catch(() => undefined);
      const secureTargets = next.targets.filter((target) =>
        inferenceModeForSnapshot(target.generation.snapshot),
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
      if (selectedIdRef.current !== conversationId) return;
      if (!override?.preserveDraft && !override?.editOfBatchId)
        setDraft(override?.draftOnFailure ?? body);
      if (!accepted) override?.onFailure?.(generationErrorMessage(error, copy));
      attachmentDraft.restoreAttachments(originalAttachments);
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
    } finally {
      if (pendingSubmissionRef.current === submission)
        pendingSubmissionRef.current = undefined;
    }
  }

  async function handleCancel(): Promise<boolean> {
    // File parsing may still be settling the creation command. Stop that new
    // Batch as soon as its identity arrives, rather than cancelling an older turn.
    if (pendingSubmissionRef.current) {
      pendingSubmissionRef.current.cancelRequested = true;
      return true;
    }
    const activeBatchID = generationBatch?.id;
    const runs = [...secureGenerationRunsRef.current.values()].filter(
      (run) => run.batchID === activeBatchID,
    );
    if (runs.length > 0) {
      for (const run of runs) run.controller.abort();
      const batchCancellation = generationBatch
        ? cancelGenerationBatch(generationBatch.id)
            .then(() => true)
            .catch((error) => {
              setFeedback(generationErrorMessage(error, copy));
              return false;
            })
        : Promise.resolve(true);
      await Promise.allSettled([
        ...runs.map((run) => run.finished),
        batchCancellation,
      ]);
      return batchCancellation;
    }
    if (secureInferenceAbortRef.current) {
      secureInferenceAbortRef.current.abort();
      try {
        await secureInferenceFinishedRef.current;
        return true;
      } catch (error) {
        setFeedback(generationErrorMessage(error, copy));
        return false;
      }
    }
    if (!generationBatch) {
      return true;
    }
    try {
      const stopped = await cancelGenerationBatch(generationBatch.id);
      setGenerationBatch(stopped);
      return true;
    } catch (error) {
      setFeedback(generationErrorMessage(error, copy));
      return false;
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
      const retryTarget = batch.targets.find(
        (target) => target.id === targetID,
      );
      const retryProfile = providerProfiles.find(
        (profile) => profile.id === retryTarget?.provider_id,
      );
      if (
        retryTarget &&
        retryProfile &&
        next.state === "pending" &&
        inferenceModeForSnapshot(next.snapshot)
      ) {
        await Promise.all([
          streamGenerationBatch(batch),
          streamSecureGeneration(batch, retryTarget, retryProfile, userBody),
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
