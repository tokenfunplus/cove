import { LocalServiceError } from "@/api";
import { secureInferenceFailureReason } from "@/lib/inference/secure-inference-errors";
import { type ApplicationCopy } from "@/messages";

export function generationErrorMessage(
  error: unknown,
  copy: ApplicationCopy,
): string {
  if (error instanceof LocalServiceError) {
    if (error.envelope.error.code === "task_save_pending")
      return "An app result is waiting to be saved. Open Activity to retry saving or discard its unsaved output before starting another app task.";
    if (
      error.envelope.error.code === "author_preview_only" ||
      error.envelope.error.code === "app_scope_changed" ||
      error.envelope.error.code === "app_proposal_invalid" ||
      error.envelope.error.code === "mini_app_task_in_progress" ||
      error.envelope.error.code === "invalid_attachment" ||
      error.envelope.error.code === "project_context_changed" ||
      error.envelope.error.code === "context_limit" ||
      error.envelope.error.code === "generation_selection_changed"
    )
      return error.envelope.error.message;
    if (error.envelope.error.code === "private_tee_unavailable")
      return copy.privateTEEUnavailable;
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
