import { settingsStyles } from "@/styles/settings";
import { verificationStyles } from "@/styles/verification";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { verificationLabel } from "@/components/chat/generation-status";
import { SignatureVerificationDialog } from "@/components/verification/SignatureVerificationDialog";
import { invokeVerificationRefresh } from "@/components/verification/VerificationDetailsButton";
import { VerificationDialog } from "@/components/verification/VerificationDialog";
import { signatureVerificationAvailable } from "@/lib/inference/verification-record";
import {
  privacyStatusPresentation,
  type PrivacyStatusSummary,
  type PrivacyVerifiedMessage,
} from "@/lib/verification/privacy-status";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";
import { type VerificationEvidence } from "@cove/api-contract";
import {
  Dialog,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BadgeCheck,
  CircleDashed,
  LockKeyhole,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";

export function PrivacyStatusPanel({
  open,
  summary,
  copy = englishConversationCopy,
  onClose,
  onVerifyAgain,
}: {
  open: boolean;
  summary: PrivacyStatusSummary;
  copy?: ApplicationCopy;
  onClose: () => void;
  onVerifyAgain?: (
    targetID: string,
    kind: "model" | "gateway",
  ) => Promise<VerificationEvidence | undefined> | void;
}) {
  const [detail, setDetail] = useState<{
    message: PrivacyVerifiedMessage;
    kind: "model" | "gateway" | "signature";
  }>();
  const { attested, sealTitle, sealDetail } = privacyStatusPresentation(
    summary.status,
    copy,
  );
  const evidence = detail?.message.verification.evidence;
  const detailEvidence =
    detail && detail.kind !== "signature" ? evidence : undefined;
  const detailDialog =
    detail?.kind === "model" && detailEvidence ? (
      <VerificationDialog
        kind="model"
        evidence={detailEvidence}
        providerName={detail.message.providerName}
        modelId={detail.message.modelId}
        copy={copy}
        onVerifyAgain={
          onVerifyAgain
            ? (kind) =>
                invokeVerificationRefresh(
                  (nextKind) =>
                    onVerifyAgain(detail.message.targetId, nextKind),
                  kind,
                )
            : undefined
        }
        onClose={() => setDetail(undefined)}
      />
    ) : detail?.kind === "gateway" && detailEvidence ? (
      <VerificationDialog
        kind="gateway"
        evidence={detailEvidence}
        providerName={detail.message.providerName}
        modelId={detail.message.modelId}
        copy={copy}
        onVerifyAgain={
          onVerifyAgain
            ? (kind) =>
                invokeVerificationRefresh(
                  (nextKind) =>
                    onVerifyAgain(detail.message.targetId, nextKind),
                  kind,
                )
            : undefined
        }
        onClose={() => setDetail(undefined)}
      />
    ) : detail?.kind === "signature" &&
      signatureVerificationAvailable(detail.message.verification) ? (
      <SignatureVerificationDialog
        verification={detail.message.verification}
        copy={copy}
        onClose={() => setDetail(undefined)}
      />
    ) : null;
  return (
    <>
      <Dialog
        className={cn(
          settingsStyles.conversationDialog,
          settingsStyles.privacyStatusDialog,
        )}
        open={open}
        onClose={onClose}
      >
        <DialogOverlay className={settingsStyles.conversationDialog_backdrop} />
        <div className={settingsStyles.conversationDialog_viewport}>
          <DialogContent
            className={cn(
              settingsStyles.conversationDialog_panel,
              verificationStyles.privacyStatusPanel,
            )}
            data-privacy-status={summary.status}
          >
            <header className={verificationStyles.privacyStatusPanel_head}>
              <div>
                <DialogTitle
                  className={verificationStyles.privacyStatusPanel_title}
                >
                  {copy.privacyStatus}
                </DialogTitle>
              </div>
              <Button
                variant="outline"
                aria-label={copy.closeVerification}
                className={verificationStyles.privacyStatusPanel_close}
                onClick={onClose}
                type="button"
              >
                <X aria-hidden="true" size={16} strokeWidth={1.8} />
              </Button>
            </header>
            <div className={verificationStyles.privacyStatusPanel_body}>
              <div className={verificationStyles.seal} data-attested={attested}>
                <div className={verificationStyles.seal_row}>
                  <span
                    aria-hidden="true"
                    className={verificationStyles.seal_icon}
                  >
                    {attested ? (
                      <ShieldCheck size={17} strokeWidth={1.8} />
                    ) : (
                      <CircleDashed size={17} strokeWidth={1.8} />
                    )}
                  </span>
                  <div>
                    <div className={verificationStyles.seal_t}>{sealTitle}</div>
                    <div className={verificationStyles.seal_d}>
                      {sealDetail}
                    </div>
                  </div>
                </div>
              </div>
              <div className={verificationStyles.dsec}>
                <h3 className={verificationStyles.dsec_title}>
                  {copy.verifiedAssistantMessages}
                </h3>
                <div className={verificationStyles.dsec_stat}>
                  <b>{summary.verifiedAssistantMessageCount}</b>
                  <span>
                    {summary.verifiedAssistantMessageCount > 0
                      ? copy.proofChainsIntact
                      : copy.noVerifiedMessages}
                  </span>
                </div>
                <div className={verificationStyles.drow}>
                  <BadgeCheck aria-hidden="true" size={13} strokeWidth={2} />
                  <b>{copy.privateModels}</b>
                  <code>{summary.privateModelCount}</code>
                </div>
                <div className={verificationStyles.drow}>
                  <BadgeCheck aria-hidden="true" size={13} strokeWidth={2} />
                  <b>{copy.nvidiaEvidence}</b>
                  <code>{summary.nvidia.count}</code>
                </div>
                <div className={verificationStyles.drow}>
                  <BadgeCheck aria-hidden="true" size={13} strokeWidth={2} />
                  <b>{copy.intelEvidence}</b>
                  <code>{summary.intel.count}</code>
                </div>
              </div>
              <div className={verificationStyles.dsec}>
                <h3 className={verificationStyles.dsec_title}>
                  {copy.whereDataGoes}
                </h3>
                <div className={verificationStyles.dsec_stat}>
                  <b>
                    0 <i>bytes</i>
                  </b>
                  <span>{copy.egressThroughOwnServers}</span>
                </div>
                {attested ? (
                  <div className={verificationStyles.drow}>
                    <LockKeyhole
                      aria-hidden="true"
                      size={13}
                      strokeWidth={1.8}
                    />
                    {copy.computedInTee}
                    <code>TEE</code>
                  </div>
                ) : null}
                <div className={verificationStyles.drow}>
                  <LockKeyhole aria-hidden="true" size={13} strokeWidth={1.8} />
                  {copy.keychainOnly}
                </div>
                <div className={verificationStyles.drow}>
                  <LockKeyhole aria-hidden="true" size={13} strokeWidth={1.8} />
                  {copy.noRelay}
                </div>
              </div>
              {summary.verifiedMessages.length > 0 && (
                <div className={verificationStyles.dsec}>
                  <h3 className={verificationStyles.dsec_title}>
                    {copy.verificationEvidenceTitle}
                  </h3>
                  <details
                    className={verificationStyles.privacyStatusPanel_messages}
                  >
                    <summary>
                      {copy.verifiedAssistantMessages} (
                      {summary.verifiedAssistantMessageCount})
                    </summary>
                    <ul>
                      {summary.verifiedMessages.map((message) => {
                        const messageEvidence = message.verification.evidence;
                        return (
                          <li
                            key={message.messageId}
                            className={
                              verificationStyles.privacyStatusPanel_message
                            }
                          >
                            <details>
                              <summary>
                                <span>{message.providerName}</span>
                                <span>{message.modelId}</span>
                                <span role="status">
                                  {verificationLabel(
                                    message.verification,
                                    copy,
                                  ) ?? copy.chatUnverified}
                                </span>
                              </summary>
                              {message.body ? (
                                <p
                                  className={
                                    verificationStyles.privacyStatusPanel_messageBody
                                  }
                                >
                                  {message.body}
                                </p>
                              ) : null}
                              <div
                                className={
                                  verificationStyles.privacyStatusPanel_messageActions
                                }
                              >
                                {messageEvidence ? (
                                  <>
                                    {messageEvidence.kind === "model" ||
                                    messageEvidence.model ? (
                                      <Button
                                        variant="outline"
                                        aria-label={copy.openModelVerification}
                                        type="button"
                                        onClick={() =>
                                          setDetail({ message, kind: "model" })
                                        }
                                      >
                                        {copy.modelVerification}
                                      </Button>
                                    ) : null}
                                    {messageEvidence.kind === "gateway" ||
                                    messageEvidence.gateway ? (
                                      <Button
                                        variant="outline"
                                        aria-label={
                                          copy.openGatewayVerification
                                        }
                                        type="button"
                                        onClick={() =>
                                          setDetail({
                                            message,
                                            kind: "gateway",
                                          })
                                        }
                                      >
                                        {copy.gatewayVerification}
                                      </Button>
                                    ) : null}
                                  </>
                                ) : null}
                                {signatureVerificationAvailable(
                                  message.verification,
                                ) ? (
                                  <Button
                                    variant="outline"
                                    type="button"
                                    onClick={() =>
                                      setDetail({ message, kind: "signature" })
                                    }
                                  >
                                    {copy.signatureVerification}
                                  </Button>
                                ) : null}
                              </div>
                            </details>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                </div>
              )}
              {attested && (
                <p className={verificationStyles.privacyStatusPanel_hint}>
                  {copy.privacyStatusHint}
                </p>
              )}
            </div>
            <footer className={verificationStyles.privacyStatusPanel_foot}>
              {copy.specFooter}
            </footer>
          </DialogContent>
        </div>
      </Dialog>
      {detailDialog}
    </>
  );
}
