import { LocalServiceError } from "@/api";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";

export function providerConnectionStatus(
  test: "idle" | "verified" | "failed",
  configured?: boolean,
): "configured" | "unconfigured" | "failed" {
  if (test === "verified") {
    return "configured";
  }
  if (test === "failed") {
    return "failed";
  }
  return configured ? "configured" : "unconfigured";
}

export function providerConnectionLabel(
  test: "idle" | "verified" | "failed",
  configured: boolean | undefined,
  copy: ApplicationCopy,
): string {
  if (test === "verified") {
    return copy.providerTested;
  }
  if (test === "failed") {
    return copy.providerFailed;
  }
  return configured ? copy.configured : copy.keyNotConfigured;
}

export function shouldDismissProviderDialog(saved: {
  configured?: boolean;
  model_id?: string;
}): boolean {
  return Boolean(saved.configured && saved.model_id);
}

export function providerErrorMessage(
  error: unknown,
  copy: ApplicationCopy = englishConversationCopy,
  fallback = copy.providerFailed,
): string {
  if (!(error instanceof LocalServiceError)) {
    return fallback;
  }
  switch (error.envelope.error.code) {
    case "invalid_session":
    case "invalid_csrf":
    case "invalid_origin":
    case "invalid_host":
      return copy.providerLocalAuthorizationRequired;
    case "service_unavailable":
      return copy.unavailable;
    case "provider_unconfigured":
      return copy.providerUnconfigured;
    case "authentication_failed":
      return copy.authenticationFailed;
    case "provider_destination_changed":
    case "provider_profile_changed":
      return error.envelope.error.message;
    case "validation":
      return copy.providerValidationFailed;
    case "provider_unavailable":
      return copy.providerUnavailable;
    case "protocol_error":
      return copy.providerProtocolError;
    case "rate_limited":
      return copy.providerRateLimited;
    default:
      return fallback;
  }
}

export function isLocalProviderSetupError(error: unknown): boolean {
  return error instanceof LocalServiceError && [
    "invalid_session", "invalid_csrf", "invalid_origin", "invalid_host", "service_unavailable",
  ].includes(error.envelope.error.code);
}

export type ProviderFeedback = {
  text: string;
  tone: "success" | "error";
};

export function providerErrorFeedback(
  error: unknown,
  copy: ApplicationCopy = englishConversationCopy,
  fallback = copy.providerFailed,
): ProviderFeedback {
  return { text: providerErrorMessage(error, copy, fallback), tone: "error" };
}
