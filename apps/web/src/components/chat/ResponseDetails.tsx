import { useState } from "react";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogOverlay } from "@/components/ui/dialog";
import { GenerationMetrics } from "./GenerationMetrics";
import { ProviderSnapshotView } from "./ProviderSnapshotView";
import { VerificationLanes } from "@/components/verification/VerificationLanes";
import {
  VerificationDetailsButton,
  type VerificationRefresh,
} from "@/components/verification/VerificationDetailsButton";
import { verificationLaneStatus } from "@/lib/inference/verification-record";
import type { SecureInferenceMode } from "@/lib/inference/secure-inference";
import type { ApplicationCopy } from "@/messages";
import type {
  GenerationMetrics as Metrics,
  ProviderSnapshot,
  GenerationVerification,
} from "@cove/api-contract";

export function VerificationStatus({
  verification,
  mode,
}: {
  verification?: GenerationVerification;
  mode?: SecureInferenceMode;
}) {
  if (
    !mode &&
    (!verification || verification.status === "unsupported") &&
    !verification?.signature_kind
  )
    return null;
  const model =
    mode === "private_tee" ||
    verification?.lanes?.model !== undefined ||
    verification?.signature_kind === "provider_tee";
  const kinds = model
    ? (["gateway", "model", "response"] as const)
    : (["gateway", "response"] as const);
  const statuses = kinds.map((kind) =>
    verificationLaneStatus(kind, verification, mode),
  );
  const status = statuses.includes("failed")
    ? "failed"
    : statuses.every((item) => item === "verified")
      ? "verified"
      : "pending";
  const label =
    verification?.failure_code === "stream_failed"
      ? "Response proof unavailable"
      : status === "verified"
        ? model
          ? "Gateway, model & response verified"
          : "Gateway & response verified"
        : status === "failed"
          ? "Verification needs attention"
          : "Verification pending";
  return (
    <span
      data-verification-summary={status}
      data-verification-kind={model ? "model" : "gateway"}
      role="status"
      className={`rounded-full px-2 py-0.5 text-[10px] ${status === "failed" ? "bg-destructive-muted text-destructive" : status === "verified" ? "bg-accent text-primary" : "bg-muted text-muted-foreground"}`}
    >
      {label}
    </span>
  );
}

export function ResponseDetails({
  snapshot,
  metrics,
  verification,
  mode,
  copy,
  onVerifyAgain,
}: {
  snapshot?: ProviderSnapshot;
  metrics?: Metrics;
  verification?: GenerationVerification;
  mode?: SecureInferenceMode;
  copy: ApplicationCopy;
  onVerifyAgain?: VerificationRefresh;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3" data-response-details>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Info className="size-3" aria-hidden="true" />
        Response details
        {metrics ? ` · ${(metrics.duration_ms / 1000).toFixed(2)} s` : ""}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label="Response details"
        className="fixed inset-0 z-70 grid place-items-center p-4"
      >
        <DialogOverlay />
        <DialogContent className="relative z-10 grid max-h-[85dvh] w-[min(680px,calc(100vw-32px))] gap-5 overflow-y-auto rounded-2xl border border-border bg-popover p-5 text-sm text-popover-foreground shadow-popover">
          <header className="flex items-center justify-between">
            <h2 className="font-semibold">Response details</h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close response details"
              onClick={() => setOpen(false)}
            >
              <X aria-hidden="true" />
            </Button>
          </header>
          <GenerationMetrics embedded metrics={metrics} snapshot={snapshot} />
          {snapshot && (
            <ProviderSnapshotView embedded snapshot={snapshot} copy={copy} />
          )}
          {(verification || mode) && (
            <section
              className="grid gap-3 border-t border-border pt-3"
              aria-label="Verification"
            >
              <h3 className="font-semibold">Verification</h3>
              <VerificationLanes
                verification={verification}
                mode={mode}
                providerName={snapshot?.provider_name}
                modelId={snapshot?.model_id}
                onVerifyAgain={onVerifyAgain}
                copy={copy}
              />
              <VerificationDetailsButton
                verification={verification}
                providerName={snapshot?.provider_name}
                modelId={snapshot?.model_id}
                copy={copy}
                onVerifyAgain={onVerifyAgain}
              />
            </section>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
