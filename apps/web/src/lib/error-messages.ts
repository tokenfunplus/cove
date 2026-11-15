import { LocalServiceError } from "@/api";
import { secureInferenceFailureReason } from "@/lib/inference/secure-inference-errors";
import { type ApplicationCopy } from "@/messages";

export function generationErrorMessage(
  error: unknown,
  copy: ApplicationCopy,
): string {
  if (error instanceof LocalServiceError) {
    if (error.envelope.error.code === "invalid_attachment") return error.envelope.error.message;
    if (error.envelope.error.code === "protocol_error")
      return copy.providerProtocolError;
    if (error.envelope.error.code === "provider_unconfigured")
      return copy.providerUnconfigured;
    if (error.envelope.error.code === "provider_unavailable")
      return copy.providerUnavailable;
    if (error.envelope.error.code === "generation_in_progress")
      return copy.generationInProgress;
    if (error.envelope.error.code === "context_disposition_required")
      return copy.selectAnswerBeforeNext;
  }
  return copy.generationFailed;
}

export function privateInferenceFailureMessage(
  error: unknown,
  copy: ApplicationCopy,
): string {
  const reason =
    typeof error === "string" ? error : secureInferenceFailureReason(error);
  return reason
    ? `${copy.privateInferenceFailed}: ${reason}`
    : copy.privateInferenceFailed;
}
