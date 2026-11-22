import { Disclosure, DisclosureTrigger, DisclosureContent } from "@/components/ui/disclosure";
import { NearAIVerificationFrame } from "@/components/verification/NearAIVerificationFrame";
import { settingsStyles } from "@/styles/settings";
import { verificationStyles } from "@/styles/verification";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  copyVerificationValue,
  signatureVerificationAvailable,
} from "@/lib/inference/verification-record";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";
import { type GenerationVerification } from "@cove/api-contract";
import { Dialog, DialogOverlay, DialogContent } from "@/components/ui/dialog";
import { BadgeCheck, Check, Copy } from "lucide-react";
import { useState } from "react";

export function SignatureVerificationDialog({
  verification,
  copy = englishConversationCopy,
  onClose,
}: {
  verification: GenerationVerification;
  copy?: ApplicationCopy;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string>();
  const [copyError, setCopyError] = useState(false);
  const copyValue = async (id: string, value: string | undefined) => {
    if (!value) return;
    const copiedValue = await copyVerificationValue(value);
    setCopied(copiedValue ? id : undefined);
    setCopyError(!copiedValue);
  };
  return (
    <Dialog
      label={copy.signatureVerification}
      className={cn(settingsStyles.conversationDialog, "signature-dialog")}
      open
      onClose={onClose}
    >
      <DialogOverlay className={settingsStyles.conversationDialog_backdrop} />
      <div className={settingsStyles.conversationDialog_viewport}>
        <DialogContent
          className={cn(
            settingsStyles.conversationDialog_panel,
            verificationStyles.signatureDialog_panel,
          )}
          data-signature-verification="saved"
        >
          <div className={verificationStyles.viewer_heading}>
            <h2 className={verificationStyles.viewer_title}>
              {copy.signatureVerification}
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
            evidence={verification.evidence}
            verification={verification}
            onClose={onClose}
          />
          <Disclosure className={verificationStyles.viewer_details}>
            <DisclosureTrigger className={verificationStyles.viewer_summary}>
              {copy.verificationLocalDetails}
            </DisclosureTrigger><DisclosureContent>
            <SignatureVerificationContent
              verification={verification}
              copy={copy}
              onCopy={copyValue}
              copied={copied}
              onClose={onClose}
            />
          </DisclosureContent></Disclosure>
          {copyError ? <p role="alert">{copy.copyFailed}</p> : null}
        </DialogContent>
      </div>
    </Dialog>
  );
}

export function SignatureVerificationContent({
  verification,
  copy = englishConversationCopy,
  onCopy,
  copied,
  onClose,
}: {
  verification: GenerationVerification;
  copy?: ApplicationCopy;
  onCopy?: (id: string, value: string | undefined) => void;
  copied?: string;
  onClose?: () => void;
}) {
  const values = [
    {
      id: "signer",
      label: copy.signatureAddress,
      value: verification.signing_address,
    },
    {
      id: "signed-message",
      label: copy.signatureMessage,
      value: verification.signed_message,
    },
    { id: "signature", label: copy.signature, value: verification.signature },
  ] as const;
  const providerTEE = verification.signature_kind === "provider_tee";
  return (
    <div
      data-signature-verification="saved"
      data-signature-status={
        signatureVerificationAvailable(verification)
          ? "verified"
          : "unavailable"
      }
    >
      <div className={verificationStyles.signatureDialog_heading}>
        <h2>{copy.signatureVerification}</h2>
        <Button
          variant="outline"
          className={verificationStyles.signatureDialog_close}
          aria-label={copy.closeVerification}
          onClick={onClose}
          type="button"
        >
          ×
        </Button>
      </div>
      {signatureVerificationAvailable(verification) ? (
        <>
          <p
            className={verificationStyles.signatureDialog_success}
            role="status"
          >
            <BadgeCheck aria-hidden="true" size={18} strokeWidth={2} />
            <span>
              <strong>{copy.messageSignatureVerified}</strong>
              <small>{copy.messageSignatureConfirmed}</small>
            </span>
            <code>{verification.signing_algorithm}</code>
          </p>
          <dl className={verificationStyles.signatureDialog_fields}>
            <div className={verificationStyles.signatureDialog_fact}>
              <dt>{copy.signingKind}</dt>
              <dd>
                <code>{verification.signature_kind}</code>
              </dd>
            </div>
            <div className={verificationStyles.signatureDialog_fact}>
              <dt>{copy.signingAlgorithm}</dt>
              <dd>
                <code>{verification.signing_algorithm}</code>
              </dd>
            </div>
            {values.map(({ id, label, value }) => (
              <div
                className={verificationStyles.signatureDialog_field}
                key={id}
                data-signature-field={id}
              >
                <dt>
                  <span>{label}</span>
                  <Button
                    variant="outline"
                    aria-label={`${copy.copy}: ${label}`}
                    title={`${copy.copy}: ${label}`}
                    type="button"
                    onClick={() => onCopy?.(id, value)}
                  >
                    {copied === id ? (
                      <Check aria-hidden="true" size={15} strokeWidth={2} />
                    ) : (
                      <Copy aria-hidden="true" size={15} strokeWidth={2} />
                    )}
                    <span className="signature-dialog__copy-label">
                      {copied === id ? copy.copied : copy.copy}
                    </span>
                  </Button>
                </dt>
                <dd>
                  <pre>{value}</pre>
                </dd>
              </div>
            ))}
          </dl>
          <footer className={verificationStyles.signatureDialog_notes}>
            <p>{providerTEE ? copy.providerTeeScope : copy.gatewayScope}</p>
            <p>{copy.historicalSignature}</p>
          </footer>
        </>
      ) : (
        <p role="status">{copy.signatureUnavailable}</p>
      )}
    </div>
  );
}
