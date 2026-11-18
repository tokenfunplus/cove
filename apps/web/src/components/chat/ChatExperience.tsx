import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ModelAnswerPhase } from "./ModelAnswerCard";

export const ChatExperienceContext = createContext<{
  chooseModel?: () => void;
  openSettings?: () => void;
  busy?: boolean;
  editTarget?: (targetId: string) => void;
}>({});
export function FailureActions({
  code,
  busy = false,
  targetId,
}: {
  code?: string;
  busy?: boolean;
  targetId?: string;
}) {
  const actions = useContext(ChatExperienceContext);
  busy = busy || !!actions.busy;
  const connection = [
    "authentication_failed",
    "provider_unconfigured",
    "credential_unavailable",
    "provider_unavailable",
    "invalid_endpoint",
  ].includes(code ?? "");
  return (
    <span className="inline-flex flex-wrap gap-2">
      {actions.editTarget && targetId && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={() => actions.editTarget?.(targetId)}
        >
          Edit and resend
        </Button>
      )}
      {actions.chooseModel && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={actions.chooseModel}
        >
          Choose another model
        </Button>
      )}
      {connection && actions.openSettings && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={actions.openSettings}
        >
          Open Provider settings
        </Button>
      )}
    </span>
  );
}

export function GenerationActivity({
  phase,
  body,
  reasoning,
  onStop,
  stopWhenStalledOnly = false,
}: {
  phase: ModelAnswerPhase;
  body: string;
  reasoning?: string;
  onStop?: () => void;
  stopWhenStalledOnly?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(performance.now());
  const lastActivity = useRef(started.current);
  useEffect(() => {
    lastActivity.current = performance.now();
  }, [phase, body.length, reasoning?.length]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setElapsed(Math.floor((performance.now() - started.current) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  const stalled = performance.now() - lastActivity.current >= 15000;
  const label =
    phase === "verifying_environment"
      ? "Checking environment"
      : phase === "verifying_response"
        ? "Verifying response"
        : body
          ? "Receiving response"
          : reasoning
            ? "Receiving reasoning"
            : "Waiting for first text";
  return (
    <div
      className="my-2 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
      data-generation-activity
      data-generation-phase={phase}
    >
      <span role="status">{label}</span>
      <span className="tabular-nums" aria-label="Elapsed time">
        {elapsed}s
      </span>
      {stalled && <span role="status">Taking longer than usual.</span>}
      {onStop && (!stopWhenStalledOnly || stalled) && (
        <Button size="xs" variant="ghost" type="button" onClick={onStop}>
          Stop generation
        </Button>
      )}
    </div>
  );
}
