import { chatStyles } from "@/styles/chat";
import { verificationStyles } from "@/styles/verification";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type ModelAnswerPhase } from "@/components/chat/ModelAnswerCard";
import { type ApplicationCopy } from "@/messages";
import { Square } from "lucide-react";

export function StopGenerationButton({
  onClick,
  copy,
}: {
  onClick: () => void;
  copy: ApplicationCopy;
}) {
  return (
    <Button
      variant="ghost"
      aria-label={copy.stopGeneration}
      className={chatStyles.generationStop}
      onClick={onClick}
      title={copy.stopGeneration}
      type="button"
    >
      <Square
        aria-hidden="true"
        fill="currentColor"
        size={12}
        strokeWidth={0}
      />
      <span className={chatStyles.generationStop_label}>
        {copy.stopGeneration}
      </span>
    </Button>
  );
}

export function PrivateGenerationProgress({
  phase,
  copy,
  compact = false,
}: {
  phase: Extract<
    ModelAnswerPhase,
    "pending" | "verifying_environment" | "streaming" | "verifying_response"
  >;
  copy: ApplicationCopy;
  compact?: boolean;
}) {
  const activeIndex =
    phase === "pending" || phase === "verifying_environment"
      ? 0
      : phase === "streaming"
        ? 1
        : 2;
  const headline =
    activeIndex === 0
      ? copy.privateConnectionCheckingEnvironment
      : activeIndex === 1
        ? copy.privateConnectionTestingEncryptedPath
        : copy.privateConnectionCheckingResponse;
  const steps = [
    copy.privateConnectionStepEnvironment,
    copy.privateConnectionStepEncryptedPath,
    copy.privateConnectionStepResponse,
  ];

  return (
    <div
      aria-label={copy.privateGenerationProgressTitle}
      className={cn(
        verificationStyles.privateGenerationProgress,
        `private-generation-progress${compact ? " private-generation-progress--compact" : ""}`,
      )}
      data-secure-generation-progress={phase}
      role="status"
    >
      <p>
        <span
          aria-hidden="true"
          className={verificationStyles.privateGenerationProgress_spinner}
        />
        {headline}
      </p>
      <ol aria-hidden={compact || undefined}>
        {steps.map((label, index) => (
          <li
            data-state={
              index < activeIndex
                ? "complete"
                : index === activeIndex
                  ? "active"
                  : "pending"
            }
            key={label}
          >
            <span aria-hidden="true">
              {index < activeIndex ? "✓" : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}
