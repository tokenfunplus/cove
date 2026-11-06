import { verificationStyles } from "@/styles/verification";
import { CircleCheck, Clock3, CircleAlert } from "lucide-react";
import { type SecureInferenceMode } from "@/lib/inference/secure-inference";
import { verificationLaneStatus } from "@/lib/inference/verification-record";
import { type ApplicationCopy } from "@/messages";
import { type GenerationVerification } from "@cove/api-contract";

export function VerificationLanes({
  verification,
  copy,
  mode,
}: {
  verification?: GenerationVerification;
  copy: ApplicationCopy;
  mode?: SecureInferenceMode;
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
  return (
    <div className={verificationStyles.message_verificationLanes} role="status">
      {sharedStatus && SharedIcon && (
        <span
          className={verificationStyles.message_verificationState}
          data-status={sharedStatus}
        >
          <SharedIcon size={13} aria-hidden="true" />
          {statusLabels[sharedStatus]}
        </span>
      )}
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
              <span className="sr-only">{description}</span>
              {sharedStatus && index > 0 && (
                <span aria-hidden="true" className="mr-1">
                  ·
                </span>
              )}
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
