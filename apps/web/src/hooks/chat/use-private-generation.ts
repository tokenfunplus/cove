import { useConversationCache } from "@/api/hooks/useConversations";
import {
  useGenerationCache,
  useCancelGeneration,
  useMarkSecureGenerationEnvironment,
  useMarkSecureGenerationResponseVerification,
  useMarkSecureGenerationStreaming,
  useSettleSecureGeneration,
} from "@/api/hooks/useGenerations";

import {
  inferenceModeForMetadata,
  inferenceModeForSnapshot,
  modelMetadataForTarget,
  type ModelCatalogs,
} from "@/components/providers/model-selection";
import { type GenerationState } from "@/hooks/chat/use-generation-state";
import { type ConversationActions } from "@/hooks/conversations/use-conversation-actions";
import { type WorkspaceState } from "@/hooks/workspace/use-workspace-state";
import { type WorkspaceUi } from "@/hooks/workspace/use-workspace-ui";
import { type LiveTurnPhase } from "@/lib/chat/live-turn";
import { replaceBatchGeneration } from "@/lib/generation";
import { type SecureInferenceVerificationEvent } from "@/lib/inference/secure-inference";
import {
  failedVerificationForContract,
  keepUnverifiedGatewayAnswer,
  secureVerificationForContract,
} from "@/lib/inference/verification-record";
import { type GenerationBatch, type ProviderProfile } from "@cove/api-contract";
const PRIVATE_GENERATION_TIMEOUT_MS = 2 * 60 * 1000;

type Dependencies = Pick<
  GenerationState,
  | "setLiveTurn"
  | "setGenerationBatch"
  | "setIsSending"
  | "secureGenerationRunsRef"
> &
  Pick<
    WorkspaceState,
    "selectedIdRef" | "setConversationView" | "providerProfiles"
  > &
  Pick<ConversationActions, "refreshCurrentConversation"> &
  Pick<WorkspaceUi, "showingArchived"> & { catalogs: ModelCatalogs };

export function usePrivateGeneration({
  catalogs,
  setLiveTurn,
  setGenerationBatch,
  refreshCurrentConversation,
  showingArchived,
  selectedIdRef,
  setConversationView,
  providerProfiles,
  setIsSending,
  secureGenerationRunsRef,
}: Dependencies) {
  const { loadContext } = useGenerationCache();
  const cancelGeneration = useCancelGeneration().mutateAsync;
  const markSecureGenerationEnvironment =
    useMarkSecureGenerationEnvironment().mutateAsync;
  const markSecureGenerationResponseVerification =
    useMarkSecureGenerationResponseVerification().mutateAsync;
  const markSecureGenerationStreaming =
    useMarkSecureGenerationStreaming().mutateAsync;
  const settleSecureGeneration = useSettleSecureGeneration().mutateAsync;
  const {
    loadConversation: getConversation,
    loadConversations: getConversations,
  } = useConversationCache();

  async function streamSecureGeneration(
    next: GenerationBatch,
    target: GenerationBatch["targets"][number],
    profile: ProviderProfile,
    body: string,
  ): Promise<void> {
    if (!target) return;
    const generationID = target.generation.id;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PRIVATE_GENERATION_TIMEOUT_MS);
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    let releaseVerification!: () => void;
    const verificationFinished = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    let interruptContextRead: (() => void) | undefined;
    const stopWaitingForVerification = () => {
      releaseVerification();
      interruptContextRead?.();
    };
    controller.signal.addEventListener("abort", stopWaitingForVerification, {
      once: true,
    });
    let verificationPending = false;
    let run: Promise<void>;
    run = (async () => {
      let assistantBody = "";
      let settled = false;
      const mode =
        inferenceModeForSnapshot(target.generation.snapshot) ??
        inferenceModeForMetadata(
          modelMetadataForTarget(catalogs, {
            providerId: target.provider_id,
            modelId: target.model_id,
          }),
        );
      const updatePhase = (phase: LiveTurnPhase) => {
        setLiveTurn((current) =>
          current
            ? {
                ...current,
                targets: (current.targets ?? []).map((candidate) =>
                  candidate.targetId === target.id
                    ? { ...candidate, phase }
                    : candidate,
                ),
              }
            : current,
        );
      };
      const settleAborted = async () => {
        if (!controller.signal.aborted || settled) return;
        if (timedOut) {
          const keepAnswer = keepUnverifiedGatewayAnswer(mode, assistantBody);
          const failedGeneration = await settleSecureGeneration({
            id: generationID,
            body: keepAnswer ? assistantBody : "",
            verification: failedVerificationForContract(
              mode,
              "timeout",
              "Private response verification timed out.",
              Boolean(assistantBody),
            ),
          }).catch(() => undefined);
          if (failedGeneration)
            setGenerationBatch((current) =>
              current?.id === next.id
                ? replaceBatchGeneration(current, target.id, failedGeneration)
                : current,
            );
          updatePhase(
            failedGeneration?.state === "completed" ? "completed" : "failed",
          );
          settled = Boolean(failedGeneration);
        } else {
          await cancelGeneration(generationID).catch(() => undefined);
          updatePhase("stopped");
        }
      };
      try {
        if (!mode) {
          const failedGeneration = await settleSecureGeneration({
            id: generationID,
            body: "",
            verification: failedVerificationForContract(
              undefined,
              "environment_verification_failed",
              "This model does not have a supported verification mode.",
            ),
          });
          settled = true;
          setGenerationBatch((current) =>
            current?.id === next.id
              ? replaceBatchGeneration(current, target.id, failedGeneration)
              : current,
          );
          updatePhase("failed");
          return;
        }
        await markSecureGenerationEnvironment(generationID);
        updatePhase("verifying_environment");
        if (controller.signal.aborted)
          throw new DOMException("Generation stopped", "AbortError");
        const context = await Promise.race([
          loadContext(next.id),
          new Promise<never>((_, reject) => {
            interruptContextRead = () =>
              reject(new DOMException("Generation stopped", "AbortError"));
          }),
        ]);
        interruptContextRead = undefined;
        if (controller.signal.aborted)
          throw new DOMException("Generation stopped", "AbortError");
        const configuration = target.generation.configuration_snapshot;
        const { createSecureInferenceTransport } =
          await import("@/lib/inference/secure-inference");
        const transport = createSecureInferenceTransport();
        const settleVerification = async (
          event: SecureInferenceVerificationEvent,
        ) => {
          if (settled || controller.signal.aborted) {
            releaseVerification();
            return;
          }
          try {
            if (event.type === "completed") {
              const verification = await secureVerificationForContract(
                event.verification,
                mode,
              );
              if (controller.signal.aborted) return;
              const settledGeneration = await settleSecureGeneration({
                id: generationID,
                body: assistantBody,
                verification: verification,
              });
              settled = true;
              setGenerationBatch((current) =>
                current?.id === next.id
                  ? replaceBatchGeneration(
                      current,
                      target.id,
                      settledGeneration,
                    )
                  : current,
              );
              updatePhase(
                settledGeneration.state === "completed"
                  ? "completed"
                  : "failed",
              );
            } else {
              const failureCode = timedOut
                ? "timeout"
                : controller.signal.aborted
                  ? "verification_stopped"
                  : event.code;
              const keepAnswer = keepUnverifiedGatewayAnswer(
                mode,
                assistantBody,
              );
              const settledGeneration = await settleSecureGeneration({
                id: generationID,
                body: keepAnswer ? assistantBody : "",
                verification: failedVerificationForContract(
                  mode,
                  failureCode,
                  timedOut
                    ? "Private response verification timed out."
                    : controller.signal.aborted
                      ? "Private response verification was stopped."
                      : "Private response verification failed.",
                  Boolean(assistantBody),
                ),
              });
              settled = true;
              setGenerationBatch((current) =>
                current?.id === next.id
                  ? replaceBatchGeneration(
                      current,
                      target.id,
                      settledGeneration,
                    )
                  : current,
              );
              updatePhase(
                settledGeneration.state === "completed"
                  ? "completed"
                  : "failed",
              );
            }
          } catch {
            const failedGeneration = await settleSecureGeneration({
              id: generationID,
              body: "",
              verification: failedVerificationForContract(
                mode,
                timedOut ? "timeout" : "secure_transport_error",
                timedOut
                  ? "Private response verification timed out."
                  : "Private response verification failed.",
                Boolean(assistantBody),
              ),
            }).catch(() => undefined);
            if (failedGeneration) {
              settled = true;
              setGenerationBatch((current) =>
                current?.id === next.id
                  ? replaceBatchGeneration(current, target.id, failedGeneration)
                  : current,
              );
              updatePhase(
                failedGeneration.state === "completed" ? "completed" : "failed",
              );
            }
          } finally {
            releaseVerification();
            void refreshCurrentConversation().catch(() => undefined);
          }
        };
        const stream = transport.generate(
          {
            target: {
              id: profile.id,
              kind: profile.kind,
              model_id: target.model_id,
              configured: profile.configured,
            },
            mode,
            configuration: {
              systemPrompt: configuration.system_prompt,
              temperature: configuration.temperature,
              topP: configuration.top_p,
              maxTokens: configuration.max_tokens,
            },
            context,
            message: body,
          },
          controller.signal,
          {
            onVerification: (event) => {
              void settleVerification(event);
            },
          },
        );
        for await (const event of stream) {
          if (controller.signal.aborted) break;
          if (event.type === "verifying_environment") {
            updatePhase("verifying_environment");
          } else if (event.type === "streaming") {
            await markSecureGenerationStreaming(generationID);
            updatePhase("streaming");
          } else if (event.type === "delta") {
            assistantBody += event.delta;
            setLiveTurn((current) =>
              current
                ? {
                    ...current,
                    targets: (current.targets ?? []).map((candidate) =>
                      candidate.targetId === target.id
                        ? {
                            ...candidate,
                            phase: "streaming",
                            assistantBody:
                              candidate.assistantBody + event.delta,
                          }
                        : candidate,
                    ),
                  }
                : current,
            );
          } else if (event.type === "response_ready") {
            await markSecureGenerationResponseVerification(generationID);
            verificationPending = true;
            updatePhase("verifying_response");
          } else if (event.type === "verifying_response") {
            updatePhase("verifying_response");
          } else if (event.type === "completed") {
            const verification = await secureVerificationForContract(
              event.verification,
              mode,
            );
            const settledGeneration = await settleSecureGeneration({
              id: generationID,
              body: assistantBody,
              verification: verification,
            });
            settled = true;
            releaseVerification();
            setGenerationBatch((current) =>
              current?.id === next.id
                ? replaceBatchGeneration(current, target.id, settledGeneration)
                : current,
            );
            updatePhase(
              settledGeneration.state === "completed" ? "completed" : "failed",
            );
          } else if (event.type === "failed") {
            const keepAnswer = keepUnverifiedGatewayAnswer(mode, assistantBody);
            const failedGeneration = await settleSecureGeneration({
              id: generationID,
              body: keepAnswer ? assistantBody : "",
              verification: failedVerificationForContract(
                mode,
                timedOut ? "timeout" : event.code,
                timedOut
                  ? "Private response verification timed out."
                  : "Private response verification failed.",
                Boolean(assistantBody),
              ),
            });
            settled = true;
            releaseVerification();
            setGenerationBatch((current) =>
              current?.id === next.id
                ? replaceBatchGeneration(current, target.id, failedGeneration)
                : current,
            );
            updatePhase(
              failedGeneration.state === "completed" ? "completed" : "failed",
            );
          }
        }
        releaseReady();
        if (verificationPending) {
          await verificationFinished;
        } else {
          releaseVerification();
        }
        await settleAborted();
      } catch (error) {
        await settleAborted();
        if (!controller.signal.aborted) {
          const failedGeneration = await settleSecureGeneration({
            id: generationID,
            body: keepUnverifiedGatewayAnswer(mode, assistantBody)
              ? assistantBody
              : "",
            verification: failedVerificationForContract(
              mode,
              "secure_transport_error",
              error instanceof Error
                ? error.message
                : "Private response verification failed.",
              Boolean(assistantBody),
            ),
          }).catch(() => undefined);
          updatePhase(
            failedGeneration?.state === "completed" ? "completed" : "failed",
          );
        }
        releaseReady();
        releaseVerification();
      } finally {
        releaseReady();
        releaseVerification();
        controller.signal.removeEventListener(
          "abort",
          stopWaitingForVerification,
        );
        interruptContextRead = undefined;
        clearTimeout(timeout);
        const [view] = await Promise.all([
          getConversation(next.conversation_id).catch(() => undefined),
          getConversations({ archived: showingArchived }).catch(
            () => undefined,
          ),
        ]);
        if (view && selectedIdRef.current === next.conversation_id)
          setConversationView(view);

        const finalBatch = view?.generation_batches?.find(
          (batch) => batch.id === next.id,
        );
        if (
          finalBatch &&
          (finalBatch.state === "completed" ||
            finalBatch.state === "completed_with_errors" ||
            finalBatch.state === "stopped" ||
            finalBatch.state === "failed") &&
          next.targets.every(
            (candidate) =>
              providerProfiles.find(
                (profile) => profile.id === candidate.provider_id,
              )?.kind === "nearai",
          )
        ) {
          setIsSending(false);
        }
        secureGenerationRunsRef.current.delete(generationID);
      }
    })();
    secureGenerationRunsRef.current.set(generationID, {
      batchID: next.id,
      controller,
      finished: run,
    });
    await ready;
  }

  return { streamSecureGeneration };
}

export type PrivateGeneration = ReturnType<typeof usePrivateGeneration>;
