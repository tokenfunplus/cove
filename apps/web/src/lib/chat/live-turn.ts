import type {
  ConversationView,
  GenerationBatch,
  GenerationBatchEvent,
  GenerationTarget,
  ProviderSnapshot,
} from "@cove/api-contract";

export type LiveTurnPhase =
  | "pending"
  | "verifying_environment"
  | "streaming"
  | "verifying_response"
  | "completed"
  | "stopped"
  | "failed"
  | "unknown";

type LiveTarget = {
  key: string;
  targetId?: string;
  generationId?: string;
  assistantMessageId?: string;
  providerId: string;
  modelId: string;
  snapshot?: ProviderSnapshot;
  assistantBody: string;
  phase: LiveTurnPhase;
  errorCode?: string;
  errorMessage?: string;
  lastEventId?: string;
};

export type LiveTurn = {
  conversationId: string;
  clientRequestId: string;
  userBody: string;
  userMessageId?: string;
  batchId?: string;
  targets?: LiveTarget[];
  /** @deprecated Single-target fields retained while old saved tabs reload. */
  generationId?: string;
  assistantBody?: string;
  phase?: LiveTurnPhase;
};

type LiveTargetSeed = Pick<LiveTarget, "providerId" | "modelId">;

export function createLiveTurn(
  conversationId: string,
  userBody: string,
  clientRequestId: string,
  targets: LiveTargetSeed[] = [],
): LiveTurn {
  return {
    conversationId,
    clientRequestId,
    userBody,
    targets: targets.map((target, index) => ({
      key: `${target.providerId}:${target.modelId}:${index}`,
      providerId: target.providerId,
      modelId: target.modelId,
      assistantBody: "",
      phase: "pending",
    })),
  };
}

export function hydrateLiveTurnBatch(
  turn: LiveTurn,
  batch: GenerationBatch,
): LiveTurn {
  return {
    ...turn,
    batchId: batch.id,
    userMessageId: batch.user_message_id,
    targets: batch.targets.map((target) => {
      const existing = turn.targets?.find(
        (candidate) => candidate.targetId === target.id,
      );
      return {
        ...liveTargetForGenerationTarget(target),
        // Status refreshes carry authoritative IDs and state. Keep the only
        // copy of incomplete streamed text that exists in the browser.
        assistantBody:
          existing?.generationId === target.generation.id
            ? existing.assistantBody
            : "",
        lastEventId:
          existing?.generationId === target.generation.id
            ? existing.lastEventId
            : undefined,
      };
    }),
  };
}

export function liveTurnFromBatch(
  conversationId: string,
  userBody: string,
  batch: GenerationBatch,
): LiveTurn {
  return {
    conversationId,
    clientRequestId: batch.client_request_id,
    userBody,
    userMessageId: batch.user_message_id,
    batchId: batch.id,
    targets: batch.targets.map((target) =>
      liveTargetForGenerationTarget(target),
    ),
  };
}

export function applyLiveTurnEvent(
  turn: LiveTurn,
  event: GenerationBatchEvent,
): LiveTurn {
  return {
    ...turn,
    targets: (turn.targets ?? []).map((target) => {
      if (
        target.targetId !== event.target_id ||
        (target.generationId && target.generationId !== event.generation_id)
      )
        return target;
      const next: LiveTarget = {
        ...target,
        generationId: event.generation_id || target.generationId,
        lastEventId: event.event_id || target.lastEventId,
      };
      if (event.error_code) next.errorCode = event.error_code;
      if (event.error_message) next.errorMessage = event.error_message;
      if (event.type === "started") next.phase = "streaming";
      if (event.type === "delta") {
        next.phase = "streaming";
        next.assistantBody += event.delta ?? "";
      }
      if (event.type === "completed") next.phase = "completed";
      if (event.type === "stopped") next.phase = "stopped";
      if (event.type === "failed") next.phase = "failed";
      return next;
    }),
  };
}

export function replaceLiveTargetAttempt(
  turn: LiveTurn,
  targetId: string,
  generation: GenerationTarget["generation"],
): LiveTurn {
  return {
    ...turn,
    targets: (turn.targets ?? []).map((target) =>
      target.targetId === targetId
        ? {
            ...target,
            generationId: generation.id,
            assistantMessageId: generation.assistant_message_id,
            snapshot: generation.snapshot,
            assistantBody: "",
            phase: generation.state,
            errorCode: generation.error_code,
            errorMessage: generation.error_message,
            lastEventId: undefined,
          }
        : target,
    ),
  };
}

export function reconcileLiveTurn(
  turn: LiveTurn,
  view: ConversationView,
): LiveTurn | undefined {
  const targets = turn.targets ?? [];
  if (!targets.every((target) => target.phase === "completed")) return turn;
  return targets.every(
    (target) =>
      target.assistantMessageId &&
      view.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.id === target.assistantMessageId,
      ),
  )
    ? undefined
    : turn;
}

function liveTargetForGenerationTarget(target: GenerationTarget): LiveTarget {
  return {
    key: target.id,
    targetId: target.id,
    generationId: target.generation.id,
    assistantMessageId: target.generation.assistant_message_id,
    providerId: target.provider_id,
    modelId: target.model_id,
    snapshot: target.generation.snapshot,
    assistantBody: "",
    phase: target.generation.state,
    errorCode: target.generation.error_code,
    errorMessage: target.generation.error_message,
  };
}
