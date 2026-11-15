import { type ApplicationCopy } from "@/messages";
import { type GenerationVerification } from "@cove/api-contract";

export function verificationLabel(
  verification: GenerationVerification | undefined,
  copy: ApplicationCopy,
): string | undefined {
  if (verification?.status === "verified_model")
    return copy.verificationVerified;
  if (verification?.status === "verified_gateway")
    return copy.verificationGateway;
  if (verification?.status === "pending") return copy.verificationPending;
  if (verification?.status === "failed") return copy.verificationFailed;
  if (verification?.status === "unsupported")
    return copy.verificationUnsupported;
  return undefined;
}

export function generationFailureMessage(
  errorCode: string | undefined,
  copy: ApplicationCopy,
  reason?: string,
): string {
  if (
    reason?.startsWith("Provider error:") ||
    reason?.startsWith("Verification error:")
  )
    return reason;
  if (errorCode === "stream_failed") return copy.generationStreamFailed;
  if (errorCode === "response_verification_failed")
    return copy.generationResponseVerificationFailed;
  if (errorCode === "output_limit") return copy.generationOutputLimit;
  if (errorCode === "empty_response") return copy.generationEmptyResponse;
  return copy.generationFailed;
}
