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
  if (errorCode === "authentication_failed")
    return "The Provider rejected this API key. Update it in Provider settings, then retry.";
  if (errorCode === "rate_limited")
    return "The Provider rate limit was reached. Wait before retrying, or select another model for a new submission.";
  if (errorCode === "provider_unavailable")
    return "The Provider could not be reached. Check your connection and retry, or choose another model.";
  if (errorCode === "protocol_error")
    return "The Provider returned an invalid response stream. Retry or choose another model.";
  if (errorCode === "model_unavailable")
    return "This model is no longer available. Choose another model and use Edit and resend.";
  if (errorCode === "private_tee_unavailable")
    return copy.privateTEEUnavailable;
  if (errorCode === "stream_failed") return copy.generationStreamFailed;
  if (errorCode === "response_verification_failed")
    return copy.generationResponseVerificationFailed;
  if (errorCode === "output_limit") return copy.generationOutputLimit;
  if (errorCode === "empty_response") return copy.generationEmptyResponse;
  return copy.generationFailed;
}
