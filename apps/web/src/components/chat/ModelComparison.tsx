import { ComparisonSummary } from "@/components/chat/ComparisonSummary";
import { comparisonStyles } from "@/styles/comparison";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StopGenerationButton } from "@/components/chat/GenerationProgress";
import { ModelAnswerCard } from "@/components/chat/ModelAnswerCard";
import { inferenceModeForSnapshot } from "@/components/providers/model-selection";
import { type LiveTurn } from "@/lib/chat/live-turn";
import { type ApplicationCopy } from "@/messages";
import {
  type ConversationView,
  type GenerationBatch,
  type VerificationEvidence,
} from "@cove/api-contract";

export function ModelComparisonResultGrid({
  busy = false,
  batch,
  messages,
  liveTargets,
  onCancelTarget,
  onRetry,
  onSelectAnswer,
  onVerifyAgain,
  copy,
}: {
  busy?: boolean;
  batch: GenerationBatch;
  messages: ConversationView["messages"];
  liveTargets?: NonNullable<LiveTurn["targets"]>;
  onCancelTarget?: (batchID: string, generationID: string) => void;
  onRetry?: (batchID: string, targetID: string) => void;
  onSelectAnswer?: (batchID: string, generationID: string) => void;
  onVerifyAgain?: (
    targetID: string,
    kind: "model" | "gateway",
  ) => Promise<VerificationEvidence | undefined> | void;
  copy: ApplicationCopy;
}) {
  const messagesByID = new Map(
    messages.map((message) => [message.id, message]),
  );
  const terminal =
    batch.state === "completed" ||
    batch.state === "completed_with_errors" ||
    batch.state === "stopped" ||
    batch.state === "failed";
  const verifiedCount = batch.targets.filter(
    (target) =>
      target.generation.verification?.status === "verified_model" ||
      target.generation.verification?.status === "verified_gateway",
  ).length;

  return (
    <section
      aria-label={copy.modelComparison}
      className={comparisonStyles.modelComparisonGrid}
      data-generation-batch={batch.id}
    >
      <div className={comparisonStyles.modelComparisonGrid_cards}>
        {[...batch.targets]
          .sort((left, right) => left.position - right.position)
          .map((target) => {
            const message = target.generation.assistant_message_id
              ? messagesByID.get(target.generation.assistant_message_id)
              : undefined;
            const liveTarget = liveTargets?.find(
              (candidate) => candidate.targetId === target.id,
            );
            const phase = message
              ? "completed"
              : (liveTarget?.phase ?? target.generation.state);
            const canSelectAnswer =
              terminal && !batch.context_frozen && phase === "completed";
            const selected =
              batch.selected_generation_id === target.generation.id;
            const actions = (
              <>
                {(phase === "pending" ||
                  phase === "verifying_environment" ||
                  phase === "streaming" ||
                  phase === "verifying_response") &&
                liveTarget?.generationId &&
                onCancelTarget ? (
                  <StopGenerationButton
                    copy={copy}
                    onClick={() =>
                      onCancelTarget(batch.id, liveTarget.generationId!)
                    }
                  />
                ) : null}
                {(phase === "failed" || phase === "stopped") && onRetry ? (
                  <Button
                    variant="outline"
                    disabled={busy || !terminal}
                    onClick={() => onRetry(batch.id, target.id)}
                    type="button"
                  >
                    {copy.retryGeneration}
                  </Button>
                ) : null}
                {canSelectAnswer && onSelectAnswer ? (
                  <Button
                    variant="outline"
                    className={comparisonStyles.pick}
                    aria-pressed={
                      batch.selected_generation_id === target.generation.id
                    }
                    onClick={() =>
                      onSelectAnswer(batch.id, target.generation.id)
                    }
                    type="button"
                  >
                    {selected ? copy.answerOfRecord : copy.useForNextTurn}
                  </Button>
                ) : null}
              </>
            );
            return (
              <div
                className={cn(
                  comparisonStyles.modelComparisonGrid_page,
                  `model-comparison-grid__page${selected ? " is-selected" : ""}`,
                )}
                data-page-position={target.position}
                key={target.id}
              >
                <ModelAnswerCard
                  webSearch={target.generation.web_search} webSearchEnabled={Boolean(target.generation.configuration_snapshot.web_search)} webActivity={liveTarget?.webActivity}
                  answer={message ? { messageId: message.id, conversationId: message.conversation_id, body: message.body, snapshot: message.provider_snapshot } : undefined}
                  metrics={target.generation.metrics}
                  actions={actions}
                  body={message?.body ?? liveTarget?.assistantBody ?? ""}
                  reasoning={message?.reasoning ?? liveTarget?.reasoningBody}
                  copy={copy}
                  createdAt={message?.created_at ?? batch.updated_at}
                  errorCode={
                    liveTarget?.errorCode ?? target.generation.error_code
                  }
                  modelId={target.model_id}
                  mode={inferenceModeForSnapshot(target.generation.snapshot)}
                  phase={phase}
                  providerName={
                    liveTarget?.snapshot?.provider_name ??
                    target.generation.snapshot.provider_name
                  }
                  selected={selected}
                  snapshot={liveTarget?.snapshot ?? target.generation.snapshot}
                  verification={target.generation.verification}
                  onVerifyAgain={
                    onVerifyAgain
                      ? (kind) => onVerifyAgain(target.id, kind)
                      : undefined
                  }
                  onStop={onCancelTarget ? ()=>onCancelTarget(batch.id,target.generation.id) : undefined}
                  targetId={target.id}
                />
              </div>
            );
          })}
      </div>
      <ComparisonSummary
        targetCount={batch.targets.length}
        verifiedCount={verifiedCount}
        skipped={Boolean(batch?.context_skipped)}
        selected={Boolean(batch?.selected_generation_id)}
        copy={copy}
      />
    </section>
  );
}

export function LiveModelComparisonGrid({
  busy = false,
  batch,
  targets,
  onCancelTarget,
  onRetry,
  onSelectAnswer,
  onVerifyAgain,
  copy,
}: {
  busy?: boolean;
  batch?: GenerationBatch;
  targets: NonNullable<LiveTurn["targets"]>;
  onCancelTarget?: (batchID: string, generationID: string) => void;
  onRetry?: (batchID: string, targetID: string) => void;
  onSelectAnswer?: (batchID: string, generationID: string) => void;
  onVerifyAgain?: (
    targetID: string,
    kind: "model" | "gateway",
  ) => Promise<VerificationEvidence | undefined> | void;
  copy: ApplicationCopy;
}) {
  const terminal = Boolean(
    batch &&
      (batch.state === "completed" ||
        batch.state === "completed_with_errors" ||
        batch.state === "stopped" ||
        batch.state === "failed"),
  );
  const verifiedCount = targets.filter((target) => {
    const verification = batch?.targets.find(
      (candidate) => candidate.id === target.targetId,
    )?.generation.verification;
    return (
      verification?.status === "verified_model" ||
      verification?.status === "verified_gateway"
    );
  }).length;
  return (
    <section
      aria-label={copy.modelComparison}
      className={cn(
        comparisonStyles.modelComparisonGrid,
        "model-comparison-grid--live",
      )}
      data-generation-batch={batch?.id}
    >
      <div className={comparisonStyles.modelComparisonGrid_cards}>
        {targets.map((target, index) => {
          const selected =
            batch?.selected_generation_id === target.generationId;
          const actions = (
            <>
              {(target.phase === "pending" ||
                target.phase === "verifying_environment" ||
                target.phase === "streaming" ||
                target.phase === "verifying_response") &&
              batch &&
              target.generationId &&
              onCancelTarget ? (
                <StopGenerationButton
                  copy={copy}
                  onClick={() => onCancelTarget(batch.id, target.generationId!)}
                />
              ) : null}
              {(target.phase === "failed" || target.phase === "stopped") &&
              (target.targetId || target.generationId) &&
              onRetry ? (
                <Button
                  variant="outline"
                  disabled={busy || !terminal}
                  onClick={() =>
                    onRetry(
                      batch?.id ?? "",
                      target.targetId ?? target.generationId!,
                    )
                  }
                  type="button"
                >
                  {copy.retryGeneration}
                </Button>
              ) : null}
              {terminal &&
              !batch?.context_frozen &&
              target.phase === "completed" &&
              target.generationId &&
              onSelectAnswer ? (
                <Button
                  variant="outline"
                  className={comparisonStyles.pick}
                  aria-pressed={
                    batch?.selected_generation_id === target.generationId
                  }
                  onClick={() =>
                    onSelectAnswer(batch!.id, target.generationId!)
                  }
                  type="button"
                >
                  {selected ? copy.answerOfRecord : copy.useForNextTurn}
                </Button>
              ) : null}
            </>
          );
          return (
            <div
              className={cn(
                comparisonStyles.modelComparisonGrid_page,
                `model-comparison-grid__page${selected ? " is-selected" : ""}`,
              )}
              data-page-position={index}
              key={target.key}
            >
              <ModelAnswerCard
                webSearch={batch?.targets.find(item => item.id === target.targetId)?.generation.web_search} webSearchEnabled={Boolean(batch?.web_search)} webActivity={target.webActivity}
                metrics={batch?.targets.find(item => item.id === target.targetId)?.generation.metrics}
                actions={actions}
                body={target.assistantBody}
                reasoning={target.reasoningBody}
                copy={copy}
                errorCode={target.errorCode}
                modelId={target.modelId}
                mode={inferenceModeForSnapshot(target.snapshot)}
                phase={target.phase}
                providerName={target.snapshot?.provider_name}
                selected={selected}
                snapshot={target.snapshot}
                verification={
                  batch?.targets.find(
                    (candidate) => candidate.id === target.targetId,
                  )?.generation.verification
                }
                onVerifyAgain={
                  onVerifyAgain
                    ? (kind) =>
                        onVerifyAgain(target.targetId ?? target.key, kind)
                    : undefined
                }
                onStop={onCancelTarget && batch && target.generationId ? ()=>onCancelTarget(batch.id,target.generationId!) : undefined}
                targetId={target.targetId ?? target.key}
              />
            </div>
          );
        })}
      </div>
      <ComparisonSummary
        targetCount={targets.length}
        verifiedCount={verifiedCount}
        skipped={Boolean(batch?.context_skipped)}
        selected={Boolean(batch?.selected_generation_id)}
        copy={copy}
      />
    </section>
  );
}
