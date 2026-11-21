import { WebSearchTrace } from "./WebSearchTrace";
import { GenerationActivity, FailureActions } from "./ChatExperience";
import { AnswerActions, type AnswerSource } from "@/components/chat/AnswerActions";
import { ResponseDetails, VerificationStatus } from "./ResponseDetails";
import type { GenerationMetrics as Metrics } from "@cove/api-contract";
import { comparisonStyles } from "@/styles/comparison";
import { messagesStyles } from "@/styles/messages";
import { motionStyles } from "@/styles/motion";
import { cn } from "@/lib/utils";
import { generationFailureMessage } from "@/components/chat/generation-status";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import {
  type VerificationRefresh,
} from "@/components/verification/VerificationDetailsButton";
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
  webSearch, webSearchEnabled, webActivity,
  answer,
  metrics,
  targetId,
  providerName,
  modelId,
  snapshot,
  verification,
  mode,
  body,
  reasoning,
  phase,
  errorCode,
  createdAt,
  actions,
  selected = false,
  copy,
  onVerifyAgain,
  onStop,
}: {
  webSearch?: import("@cove/api-contract").WebSearchInfo;
  webSearchEnabled?: boolean;
  webActivity?: string;
  answer?: AnswerSource;
  metrics?: Metrics;
  targetId: string;
  providerName?: string;
  modelId: string;
  snapshot?: ProviderSnapshot;
  verification?: GenerationVerification;
  mode?: SecureInferenceMode;
  body: string;
  reasoning?: string;
  phase: ModelAnswerPhase;
  errorCode?: string;
  createdAt?: string;
  actions?: ReactNode;
  selected?: boolean;
  copy: ApplicationCopy;
  onVerifyAgain?: VerificationRefresh;
  onStop?:()=>void;
}) {
  const waiting =
    phase === "pending" ||
    phase === "verifying_environment" ||
    phase === "streaming" ||
    phase === "verifying_response";
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
              ? generationFailureMessage(
                  errorCode ?? verification?.failure_code,
                  copy,
                  verification?.evidence_summary,
                )
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
            <VerificationStatus verification={verification} mode={mode}/>
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
        {waiting && webActivity && <p role="status" className="my-2 text-xs text-muted-foreground">{webActivity}</p>}
        {waiting && <GenerationActivity onStop={onStop} stopWhenStalledOnly phase={phase} body={body} reasoning={reasoning}/>}
        {phase==="failed" && <FailureActions targetId={targetId} code={errorCode ?? verification?.failure_code}/>}
        {body || reasoning ? (
          answer ? <AnswerActions source={answer}><AssistantMessage content={body} reasoning={reasoning} streaming={phase === "streaming"} /></AnswerActions> : <AssistantMessage content={body} reasoning={reasoning} streaming={phase === "streaming"} />
        ) : null}
        {!body && !waiting && stateMessage ? (
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
      {!waiting && webSearchEnabled && <WebSearchTrace info={webSearch} />}
      <ResponseDetails metrics={metrics} snapshot={snapshot} verification={verification} mode={mode} copy={copy} onVerifyAgain={onVerifyAgain}/>
      {actions ? (
        <footer className={comparisonStyles.modelAnswerCard_actions}>
          {actions}
        </footer>
      ) : null}
    </article>
  );
}
