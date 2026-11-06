import { verificationStyles } from "@/styles/verification";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type ApplicationCopy } from "@/messages";
import { type VerificationEvidence } from "@cove/api-contract";

export type PrivateConnectionProgressPhase =
  "environment" | "encrypted_path" | "response" | "complete" | "failed";

type ActivePrivateConnectionProgressPhase = Exclude<
  PrivateConnectionProgressPhase,
  "complete" | "failed"
>;

export type PrivateConnectionProgressState = {
  phase: PrivateConnectionProgressPhase;
  failedAt?: ActivePrivateConnectionProgressPhase;
  providerName: string;
  modelIds: string[];
  message?: string;
  verification?: { kind: "model" | "gateway"; evidence: VerificationEvidence };
};

export function PrivateConnectionProgress({
  providerName,
  modelIds,
  phase,
  failedAt,
  message,
  copy,
  onClose,
  onOpenDetails,
}: {
  providerName: string;
  modelIds: string[];
  phase: PrivateConnectionProgressPhase;
  failedAt?: ActivePrivateConnectionProgressPhase;
  message?: string;
  copy: ApplicationCopy;
  onClose: () => void;
  onOpenDetails?: () => void;
}) {
  const steps = [
    { id: "environment", label: copy.privateConnectionStepEnvironment },
    { id: "encrypted_path", label: copy.privateConnectionStepEncryptedPath },
    { id: "response", label: copy.privateConnectionStepResponse },
  ] as const;
  const activePhase =
    phase === "failed"
      ? (failedAt ?? "environment")
      : activePrivateConnectionPhase(phase);
  const activeIndex =
    activePhase === "environment"
      ? 0
      : activePhase === "encrypted_path"
        ? 1
        : 2;
  const headline =
    phase === "environment"
      ? copy.privateConnectionCheckingEnvironment
      : phase === "encrypted_path"
        ? copy.privateConnectionTestingEncryptedPath
        : phase === "response"
          ? copy.privateConnectionCheckingResponse
          : phase === "complete"
            ? copy.privateConnectionVerified
            : (message ?? copy.privateInferenceFailed);
  const identity = [providerName, ...modelIds].filter(Boolean).join(" · ");

  return (
    <section
      className={cn(
        verificationStyles.privateConnectionProgress,
        `private-connection-progress private-connection-progress--${phase}`,
      )}
      aria-live="polite"
      aria-label={copy.privateConnectionProgressTitle}
      data-private-connection-progress={phase}
      role="status"
    >
      <Button
        variant="outline"
        aria-label={
          phase === "complete" || phase === "failed"
            ? copy.closeVerification
            : copy.cancel
        }
        className={verificationStyles.privateConnectionProgress_close}
        onClick={onClose}
        type="button"
      >
        ×
      </Button>
      <div className="private-connection-progress__content">
        <p className={verificationStyles.privateConnectionProgress_identity}>
          {identity}
        </p>
        <h2>{headline}</h2>
        <ol className={verificationStyles.privateConnectionProgress_steps}>
          {steps.map((step, index) => {
            const state =
              phase === "complete"
                ? "complete"
                : phase === "failed" && index === activeIndex
                  ? "failed"
                  : index < activeIndex
                    ? "complete"
                    : index === activeIndex
                      ? "active"
                      : "pending";
            return (
              <li data-progress-step={step.id} data-state={state} key={step.id}>
                <span
                  aria-hidden="true"
                  className={
                    verificationStyles.privateConnectionProgress_marker
                  }
                >
                  {state === "complete" ? "✓" : state === "failed" ? "!" : ""}
                </span>
                <span>{step.label}</span>
              </li>
            );
          })}
        </ol>
        {phase === "complete" && onOpenDetails ? (
          <Button
            variant="outline"
            className={verificationStyles.privateConnectionProgress_details}
            onClick={onOpenDetails}
            type="button"
          >
            {copy.privateConnectionViewDetails}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export function activePrivateConnectionPhase(
  phase: PrivateConnectionProgressPhase,
): ActivePrivateConnectionProgressPhase {
  return phase === "environment" ||
    phase === "encrypted_path" ||
    phase === "response"
    ? phase
    : "environment";
}
