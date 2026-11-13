import { comparisonStyles } from "@/styles/comparison";
import { messagesStyles } from "@/styles/messages";
import { motionStyles } from "@/styles/motion";
import { cn } from "@/lib/utils";
import { generationFailureMessage } from "@/components/chat/generation-status";
import { PrivateGenerationProgress } from "@/components/chat/GenerationProgress";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { ProviderSnapshotView } from "@/components/chat/ProviderSnapshotView";
import {
  VerificationDetailsButton,
  type VerificationRefresh,
} from "@/components/verification/VerificationDetailsButton";
import { VerificationLanes } from "@/components/verification/VerificationLanes";
import { formatTime } from "@/lib/format-date";
import { type SecureInferenceMode } from "@/lib/inference/secure-inference";
import { type ApplicationCopy } from "@/messages";
import {
  type GenerationVerification,
  type ProviderSnapshot,
} from "@cove/api-contract";
import { type ReactNode } from "react";

export type ModelAnswerPhase =
  | "pending"
  | "verifying_environment"
  | "streaming"
  | "verifying_response"
  | "completed"
  | "stopped"
  | "failed"
  | "unknown";

export function ModelAnswerCard({
  targetId,
  providerName,
  modelId,
  snapshot,
  verification,
  mode,
  body,
  phase,
  errorCode,
  createdAt,
  actions,
  selected = false,
  copy,
  onVerifyAgain,
}: {
  targetId: string;
  providerName?: string;
  modelId: string;
  snapshot?: ProviderSnapshot;
  verification?: GenerationVerification;
  mode?: SecureInferenceMode;
  body: string;
  phase: ModelAnswerPhase;
  errorCode?: string;
  createdAt?: string;
  actions?: ReactNode;
  selected?: boolean;
  copy: ApplicationCopy;
  onVerifyAgain?: VerificationRefresh;
}) {
  const waiting =
    phase === "pending" ||
    phase === "verifying_environment" ||
    phase === "streaming" ||
    phase === "verifying_response";
  const privateProgress =
    waiting &&
    (verification?.status === "pending" ||
      phase === "verifying_environment" ||
      phase === "verifying_response");
  const stateMessage =
    phase === "verifying_environment"
      ? copy.privateInferenceVerifying
      : phase === "verifying_response"
        ? copy.privateInferenceVerifyingResponse
        : waiting
          ? copy.generationPending
          : phase === "stopped"
            ? copy.generationStopped
            : phase === "failed"
              ? generationFailureMessage(errorCode, copy)
              : phase === "unknown"
                ? copy.generationDeliveryUnknown
                : "";
  return (
    <article
      className={cn(
        comparisonStyles.modelAnswerCard,
        `model-answer-card model-answer-card--${phase}${selected ? " model-answer-card--selected" : ""}`,
      )}
      data-generation-target={targetId}
    >
      <header className={comparisonStyles.modelAnswerCard_header}>
        <div>
          <h3 title={modelId}>{modelId}</h3>
          {providerName && <p>{providerName}</p>}
        </div>
        <div className={comparisonStyles.modelAnswerCard_identity}>
          {mode || verification ? (
            <VerificationLanes
              copy={copy}
              mode={mode}
              verification={verification}
              providerName={providerName}
              modelId={modelId}
              onVerifyAgain={onVerifyAgain}
            />
          ) : null}
          {selected ? (
            <span className={comparisonStyles.modelAnswerCard_selected}>
              {copy.selectedAnswer}
            </span>
          ) : null}
        </div>
        {createdAt ? (
          <time
            className={comparisonStyles.modelAnswerCard_time}
            dateTime={createdAt}
          >
            {formatTime(createdAt)}
          </time>
        ) : null}
      </header>
      <div className={comparisonStyles.modelAnswerCard_body}>
        {privateProgress ? (
          <PrivateGenerationProgress
            phase={
              phase as Extract<
                ModelAnswerPhase,
                | "pending"
                | "verifying_environment"
                | "streaming"
                | "verifying_response"
              >
            }
            copy={copy}
          />
        ) : null}
        {body ? (
          <MarkdownMessage content={body} />
        ) : !privateProgress && stateMessage ? (
          <p
            className={cn(
              messagesStyles.message_body,
              `message__body${waiting ? " message__body--pending" : " message__state"}`,
            )}
          >
            {waiting ? (
              <span aria-hidden="true" className={motionStyles.pendingDots}>
                ...
              </span>
            ) : null}
            {stateMessage}
          </p>
        ) : null}
      </div>
      {snapshot ? (
        <ProviderSnapshotView copy={copy} snapshot={snapshot} />
      ) : null}
      <VerificationDetailsButton
        verification={verification}
        providerName={providerName}
        modelId={modelId}
        copy={copy}
        onVerifyAgain={onVerifyAgain}
      />
      {actions ? (
        <footer className={comparisonStyles.modelAnswerCard_actions}>
          {actions}
        </footer>
      ) : null}
    </article>
  );
}
