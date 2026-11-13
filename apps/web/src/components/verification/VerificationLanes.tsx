import { verificationStyles } from "@/styles/verification";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  VerificationDetailsButton,
  type VerificationDetailKind,
  type VerificationRefresh,
} from "./VerificationDetailsButton";
import { CircleCheck, Clock3, CircleAlert } from "lucide-react";
import { type SecureInferenceMode } from "@/lib/inference/secure-inference";
import {
  signatureVerificationAvailable,
  verificationLaneStatus,
} from "@/lib/inference/verification-record";
import { type ApplicationCopy } from "@/messages";
import { type GenerationVerification } from "@cove/api-contract";

export function VerificationLanes({
  verification,
  copy,
  mode,
  providerName,
  modelId,
  onVerifyAgain,
}: {
  verification?: GenerationVerification;
  copy: ApplicationCopy;
  mode?: SecureInferenceMode;
  providerName?: string;
  modelId?: string;
  onVerifyAgain?: VerificationRefresh;
}) {
  if (
    !mode &&
    (!verification || verification.status === "unsupported") &&
    !verification?.signature_kind
  )
    return null;
  const showModelLane =
    mode === "private_tee" ||
    verification?.lanes?.model !== undefined ||
    verification?.signature_kind === "provider_tee";
  const lanes = [
    {
      kind: "gateway" as const,
      label: copy.gatewayLabel,
      description: copy.gatewayVerification,
    },
    ...(showModelLane
      ? [
          {
            kind: "model" as const,
            label: copy.model,
            description: copy.modelVerification,
          },
        ]
      : []),
    {
      kind: "response" as const,
      label: copy.responseLabel,
      description: copy.responseVerification,
    },
  ].map((lane) => ({
    ...lane,
    status: verificationLaneStatus(lane.kind, verification, mode),
  }));
  const statusLabels = {
    verified: copy.verificationVerified,
    failed: copy.verificationFailed,
    pending: copy.verificationPending,
  };
  const icons = {
    verified: CircleCheck,
    pending: Clock3,
    failed: CircleAlert,
  };
  const sharedStatus = lanes.every((lane) => lane.status === lanes[0].status)
    ? lanes[0].status
    : undefined;
  const SharedIcon = sharedStatus && icons[sharedStatus];
  const evidence = verification?.evidence;
  const hasDetails = (kind: VerificationDetailKind) =>
    kind === "response"
      ? signatureVerificationAvailable(verification)
      : Boolean(evidence && (evidence.kind === kind || evidence[kind]));
  const content = (openDetails?: (kind: VerificationDetailKind) => void) => (
    <div className={verificationStyles.message_verificationLanes} role="status">
      {sharedStatus &&
        SharedIcon &&
        (openDetails && evidence ? (
          <Button
            variant="ghost"
            type="button"
            className={cn(
              verificationStyles.message_verificationState,
              verificationStyles.message_verificationLink,
            )}
            data-status={sharedStatus}
            aria-label={`${copy.verificationEvidenceTitle}: ${statusLabels[sharedStatus]}`}
            aria-haspopup="dialog"
            onClick={() => openDetails(evidence.kind)}
          >
            <SharedIcon size={13} aria-hidden="true" />
            {statusLabels[sharedStatus]}
          </Button>
        ) : (
          <span
            className={verificationStyles.message_verificationState}
            data-status={sharedStatus}
          >
            <SharedIcon size={13} aria-hidden="true" />
            {statusLabels[sharedStatus]}
          </span>
        ))}
      <ul className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {lanes.map((lane, index) => {
          const Icon = icons[lane.status];
          const description = `${lane.description}: ${statusLabels[lane.status]}`;
          return (
            <li
              key={lane.kind}
              data-verification-lane={lane.kind}
              data-status={lane.status}
              className="inline-flex items-center gap-1"
              title={description}
            >
              {sharedStatus && index > 0 && (
                <span aria-hidden="true" className="mr-1">
                  ·
                </span>
              )}
              {openDetails && hasDetails(lane.kind) ? (
                <Button
                  variant="ghost"
                  type="button"
                  className={verificationStyles.message_verificationLink}
                  aria-label={description}
                  aria-haspopup="dialog"
                  onClick={() => openDetails(lane.kind)}
                >
                  {!sharedStatus && (
                    <Icon
                      size={13}
                      aria-hidden="true"
                      className={verificationStyles.message_verificationState}
                      data-status={lane.status}
                    />
                  )}
                  {lane.label}
                  {!sharedStatus && <span>{statusLabels[lane.status]}</span>}
                </Button>
              ) : (
                <>
                  <span className="sr-only">{description}</span>
                  {!sharedStatus && (
                    <Icon
                      size={13}
                      aria-hidden="true"
                      className={verificationStyles.message_verificationState}
                      data-status={lane.status}
                    />
                  )}
                  <span aria-hidden="true">{lane.label}</span>
                  {!sharedStatus && (
                    <span aria-hidden="true" className="font-medium">
                      {statusLabels[lane.status]}
                    </span>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
  return evidence ? (
    <VerificationDetailsButton
      verification={verification}
      providerName={providerName}
      modelId={modelId}
      copy={copy}
      onVerifyAgain={onVerifyAgain}
    >
      {content}
    </VerificationDetailsButton>
  ) : (
    content()
  );
}
