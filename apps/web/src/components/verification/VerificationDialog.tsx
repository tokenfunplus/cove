import { Disclosure, DisclosureTrigger, DisclosureContent } from "@/components/ui/disclosure";
import { NearAIVerificationFrame } from "@/components/verification/NearAIVerificationFrame";
import { settingsStyles } from "@/styles/settings";
import { verificationStyles } from "@/styles/verification";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { copyVerificationValue } from "@/lib/inference/verification-record";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";
import {
  type GenerationVerification,
  type VerificationEvidence,
} from "@cove/api-contract";
import { Dialog, DialogOverlay, DialogContent } from "@/components/ui/dialog";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

export function VerificationDialog({
  kind,
  evidence,
  providerName,
  modelId,
  copy = englishConversationCopy,
  onVerifyAgain,
  onClose,
}: {
  kind: "model" | "gateway";
  evidence: NonNullable<GenerationVerification["evidence"]>;
  providerName?: string;
  modelId?: string;
  copy?: ApplicationCopy;
  onVerifyAgain?: (
    kind: "model" | "gateway",
  ) => Promise<VerificationEvidence | undefined>;
  onClose: () => void;
}) {
  const [activeKind, setActiveKind] = useState(kind);
  const [currentEvidence, setCurrentEvidence] = useState(evidence);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState(false);
  const [copiedQuote, setCopiedQuote] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => setCurrentEvidence(evidence), [evidence]);
  useEffect(() => setActiveKind(kind), [kind]);
  const evidenceForKind = (nextKind: "model" | "gateway") =>
    currentEvidence.kind === nextKind
      ? currentEvidence
      : nextKind === "gateway"
        ? currentEvidence.gateway
        : currentEvidence.model;
  const displayedEvidence = evidenceForKind(activeKind);
  const viewerEvidence = useMemo(() => {
    if (!displayedEvidence) return undefined;
    return activeKind === "gateway"
      ? { ...displayedEvidence, model: undefined }
      : currentEvidence;
  }, [activeKind, displayedEvidence, currentEvidence]);
  const changeKind = (nextKind: "model" | "gateway") => {
    if (nextKind === activeKind) return;
    setActiveKind(nextKind);
    setVerificationError(false);
    setCopiedQuote(false);
    setCopyError(false);
  };
  const copyQuote = async (value: string) => {
    setCopiedQuote(false);
    const copied = await copyVerificationValue(value);
    setCopiedQuote(copied);
    setCopyError(!copied);
  };
  const refresh = async () => {
    if (!onVerifyAgain) return;
    setIsVerifying(true);
    setVerificationError(false);
    try {
      const refreshed = await onVerifyAgain(activeKind);
      if (refreshed) {
        setCurrentEvidence((previous) => {
          if (refreshed.kind !== previous.kind) {
            return { ...previous, [refreshed.kind]: refreshed };
          }
          const relatedKind = refreshed.kind === "model" ? "gateway" : "model";
          return {
            ...refreshed,
            [relatedKind]: refreshed[relatedKind] ?? previous[relatedKind],
          };
        });
      } else setVerificationError(true);
    } catch {
      setVerificationError(true);
    } finally {
      setIsVerifying(false);
    }
  };
  return (
    <Dialog
      label={copy.attestationEvidence}
      className={cn(settingsStyles.conversationDialog, "verification-dialog")}
      open
      onClose={onClose}
    >
      <DialogOverlay className={settingsStyles.conversationDialog_backdrop} />
      <div className={settingsStyles.conversationDialog_viewport}>
        <DialogContent
          className={cn(
            settingsStyles.conversationDialog_panel,
            verificationStyles.verificationDialog_panel,
          )}
          data-verification-dialog={kind}
        >
          <div className="verification-dialog__body">
            <div className={verificationStyles.viewer_heading}>
              <h2 className={verificationStyles.viewer_title}>
                {copy.verificationViewerTitle}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label={copy.closeVerification}
                onClick={onClose}
              >
                ×
              </Button>
            </div>
            <p className={verificationStyles.viewer_notice}>
              {copy.verificationViewerNotice}
            </p>
            <NearAIVerificationFrame
              evidence={viewerEvidence}
              modelId={modelId}
              onClose={onClose}
            />
            <Disclosure className={verificationStyles.viewer_details}>
              <DisclosureTrigger className={verificationStyles.viewer_summary}>
                {copy.verificationLocalDetails}
              </DisclosureTrigger><DisclosureContent>
              <VerificationDialogContent
                kind={activeKind}
                evidence={displayedEvidence}
                providerName={providerName}
                modelId={modelId}
                copy={copy}
                onClose={onClose}
                onKindChange={changeKind}
                onCopyQuote={copyQuote}
                copiedQuote={copiedQuote}
                hasModelEvidence
                hasGatewayEvidence
              />
            </DisclosureContent></Disclosure>
            {copyError ? <p role="alert">{copy.copyFailed}</p> : null}
            {isVerifying ? (
              <p role="status">{copy.privateInferenceVerifying}</p>
            ) : null}
            {verificationError ? (
              <p role="alert">{copy.privateInferenceFailed}</p>
            ) : null}
          </div>
          <div className={settingsStyles.conversationDialog_actions}>
            {onVerifyAgain ? (
              <Button
                variant="outline"
                type="button"
                disabled={isVerifying}
                onClick={() => void refresh()}
              >
                {copy.verifyAgain}
              </Button>
            ) : null}
            <Button variant="outline" type="button" onClick={onClose}>
              {copy.closeVerification}
            </Button>
          </div>
        </DialogContent>
      </div>
    </Dialog>
  );
}

export function VerificationDialogContent({
  kind,
  evidence,
  providerName,
  modelId,
  copy = englishConversationCopy,
  onClose,
  onKindChange,
  onCopyQuote,
  copiedQuote = false,
  hasModelEvidence = true,
  hasGatewayEvidence = true,
}: {
  kind: "model" | "gateway";
  evidence?: NonNullable<GenerationVerification["evidence"]>;
  providerName?: string;
  modelId?: string;
  copy?: ApplicationCopy;
  onClose?: () => void;
  onKindChange?: (kind: "model" | "gateway") => void;
  onCopyQuote?: (value: string) => void;
  copiedQuote?: boolean;
  hasModelEvidence?: boolean;
  hasGatewayEvidence?: boolean;
}) {
  const model = kind === "model";
  const relatedModel = evidence?.model ?? (model ? evidence : undefined);
  const relatedGateway = evidence?.gateway ?? (!model ? evidence : undefined);
  const rawValue = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !onKindChange ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    )
      return;
    const available = (["model", "gateway"] as const).filter((tab) =>
      tab === "model" ? hasModelEvidence : hasGatewayEvidence,
    );
    if (!available.length) return;
    event.preventDefault();
    const offset = event.key === "ArrowLeft" ? -1 : 1;
    const next =
      event.key === "Home"
        ? available[0]
        : event.key === "End"
          ? available[available.length - 1]
          : available[
              (available.indexOf(kind) + offset + available.length) %
                available.length
            ];
    onKindChange(next);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-verification-tab="${next}"]`)
      ?.focus();
  };
  return (
    <div data-verification-dialog={kind}>
      <div className={verificationStyles.verificationDialog_topline}>
        <div
          className={verificationStyles.verificationDialog_tabs}
          role="tablist"
          aria-label={copy.attestationEvidence}
          onKeyDown={handleTabKeyDown}
        >
          <Button
            variant="outline"
            role="tab"
            aria-selected={model}
            tabIndex={model ? 0 : -1}
            data-verification-tab="model"
            className={model ? "is-active" : ""}
            disabled={!hasModelEvidence}
            onClick={() => onKindChange?.("model")}
            type="button"
          >
            {copy.modelVerification}
          </Button>
          <Button
            variant="outline"
            role="tab"
            aria-selected={!model}
            tabIndex={!model ? 0 : -1}
            data-verification-tab="gateway"
            className={!model ? "is-active" : ""}
            disabled={!hasGatewayEvidence}
            onClick={() => onKindChange?.("gateway")}
            type="button"
          >
            {copy.gatewayVerification}
          </Button>
        </div>
        <Button
          variant="outline"
          className={verificationStyles.verificationDialog_close}
          type="button"
          aria-label={copy.closeVerification}
          onClick={onClose}
        >
          ×
        </Button>
      </div>
      <div className={verificationStyles.verificationDialog_identity}>
        <p>{model ? copy.privateModel : copy.privateGateway}</p>
        <h2>
          {model
            ? modelId || providerName || copy.privateModel
            : copy.nearAiCloudGateway}
        </h2>
        {model && providerName ? (
          <span className={verificationStyles.verificationDialog_provider}>
            {providerName}
          </span>
        ) : null}
      </div>
      <p className={verificationStyles.verificationDialog_hint}>
        {model ? copy.modelVerificationHint : copy.gatewayVerificationHint}
      </p>
      {evidence ? (
        <div className={verificationStyles.verificationDialog_evidenceList}>
          {model ? (
            <Disclosure
              className={verificationStyles.verificationDialog_evidenceCard}
              data-verification-card="gpu"
            >
              <DisclosureTrigger>
                <span>{copy.gpuAttestation.replace("NVIDIA ", "")}</span>
                <strong>NVIDIA</strong>
              </DisclosureTrigger><DisclosureContent>
              <p>
                {evidence.gpu_evidence === "verified"
                  ? copy.verificationVerified
                  : copy.noGpuEvidence}
              </p>
              <pre>
                {rawValue({
                  gpu_evidence: evidence.gpu_evidence,
                  deployment: evidence.deployment,
                  raw: evidence.raw,
                })}
              </pre>
            </DisclosureContent></Disclosure>
          ) : null}
          <Disclosure
            className={verificationStyles.verificationDialog_evidenceCard}
            data-verification-card="tdx"
          >
            <DisclosureTrigger>
              <span>{copy.tdxAttestation}</span>
              <strong>intel.</strong>
            </DisclosureTrigger><DisclosureContent>
            <p>{copy.verificationVerified}</p>
            <dl className={verificationStyles.verificationDialog_facts}>
              <div>
                <dt>{copy.signer}</dt>
                <dd>{evidence.signer_address ?? "—"}</dd>
              </div>
              <div>
                <dt>{copy.signingAlgorithm}</dt>
                <dd>{evidence.signing_algorithm ?? "—"}</dd>
              </div>
              <div>
                <dt>{copy.tcbStatus}</dt>
                <dd>{evidence.tcb_status ?? "—"}</dd>
              </div>
              <div>
                <dt>{copy.advisories}</dt>
                <dd>{evidence.advisory_ids?.join(", ") || "—"}</dd>
              </div>
            </dl>
            {!model ? (
              <p>
                {copy.tlsPeerBinding}:{" "}
                {evidence.tls_binding === "attested"
                  ? copy.verificationVerified
                  : copy.tlsPeerBindingUnavailable}
              </p>
            ) : null}
            <div className={verificationStyles.verificationDialog_quoteLabel}>
              <span>{copy.quote}</span>
              <Button
                variant="outline"
                type="button"
                onClick={() => onCopyQuote?.(rawValue(evidence.raw))}
              >
                {copiedQuote ? copy.copied : copy.copy}
              </Button>
              <pre>{rawValue(evidence.raw)}</pre>
            </div>
          </DisclosureContent></Disclosure>
        </div>
      ) : (
        <p
          className={verificationStyles.verificationDialog_empty}
          role="status"
        >
          {copy.verificationEvidenceUnavailable}
        </p>
      )}
      {model && relatedGateway ? (
        <span className={verificationStyles.verificationDialog_related} hidden>
          {relatedGateway.kind}
        </span>
      ) : null}
      {model && relatedModel ? (
        <span className={verificationStyles.verificationDialog_related} hidden>
          {relatedModel.kind}
        </span>
      ) : null}
    </div>
  );
}
