import { LocalServiceError } from "@/api";
import { ProviderSettings } from "@/components/providers/ProviderSettings";
import {
  providerConnectionLabel,
  providerConnectionStatus,
  providerErrorFeedback,
  providerErrorMessage,
  isLocalProviderSetupError,
  shouldDismissProviderDialog,
} from "@/components/providers/provider-feedback";
import { applicationMessages } from "@/messages";
import type { ProviderProfile } from "@cove/api-contract";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

test("provider settings show configuration state and keep the NearAI endpoint fixed", () => {
  const provider: ProviderProfile = {
    id: "nearai",
    kind: "nearai",
    name: "NearAI",
    endpoint: "https://cloud-api.near.ai",
    model_id: "nearai/model-a",
    auth_method: "bearer",
    runtime_location: "NearAI cloud",
    destination: "cloud-api.near.ai",
    transport_security: "tls",
    privacy_notice:
      "Conversation content is sent to NearAI cloud over HTTPS/TLS.",
    configured: false,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };

  const markup = renderToStaticMarkup(
    <ProviderSettings
      profiles={[provider]}
      onSave={async () => provider}
      onTest={async () => []}
      onDelete={async () => {}}
      onDeleteKey={async () => {}}
    />,
  );

  expect(markup).toContain("Provider settings");
  expect(markup).toContain("Key not configured");
  expect(markup).toContain("https://cloud-api.near.ai");
  expect(markup).toContain('type="password"');
  expect(markup).toContain("nearai/model-a");
  expect(markup).toContain("NearAI preset");
  expect(markup).toContain("spec-line");
  expect(markup).toMatch(
    /<button(?=[^>]*aria-label="Authentication")(?=[^>]*disabled)[^>]*>/,
  );
  expect(markup).toMatch(/<button(?![^>]*disabled=)[^>]*type="submit"[^>]*>/);
});

test("provider settings preserve distinct connection error states", () => {
  const error = (code: string) =>
    new LocalServiceError({
      error: { code, message: "redacted", details: null, request_id: "local" },
    });

  expect(providerErrorMessage(error("service_unavailable"))).toBe(
    "Local service unavailable",
  );
  for (const code of ["invalid_session", "invalid_csrf", "invalid_origin", "invalid_host"]) {
    expect(providerErrorMessage(error(code))).toBe(
      "Local browser access is no longer valid. Reopen Cove from the Launcher, then try again.",
    );
    expect(isLocalProviderSetupError(error(code))).toBe(true);
  }
  expect(isLocalProviderSetupError(error("service_unavailable"))).toBe(true);
  expect(isLocalProviderSetupError(error("authentication_failed"))).toBe(false);
  expect(isLocalProviderSetupError(error("provider_unavailable"))).toBe(false);
  expect(providerErrorMessage(error("provider_unconfigured"))).toBe(
    "Provider key is not configured",
  );
  expect(providerErrorMessage(error("authentication_failed"))).toBe(
    "The Provider rejected the API key",
  );
  expect(providerErrorMessage(error("validation"))).toBe(
    "The Provider settings are invalid",
  );
  expect(providerErrorMessage(error("provider_unavailable"))).toBe(
    "The Provider could not be reached",
  );
  expect(providerErrorMessage(error("protocol_error"))).toBe(
    "The Provider returned an invalid response",
  );
  expect(providerErrorMessage(error("rate_limited"))).toBe(
    "The Provider rate limited the request",
  );
  expect(providerErrorMessage(error("unexpected"))).toBe(
    "Provider connection failed",
  );
  expect(providerErrorFeedback(error("authentication_failed"))).toEqual({
    text: "The Provider rejected the API key",
    tone: "error",
  });
});

test("saving a configured model dismisses the provider dialog", () => {
  expect(
    shouldDismissProviderDialog({
      configured: true,
      model_id: "Qwen/Qwen3.8-27B",
    }),
  ).toBe(true);
  expect(
    shouldDismissProviderDialog({
      configured: false,
      model_id: "Qwen/Qwen3.8-27B",
    }),
  ).toBe(false);
  expect(shouldDismissProviderDialog({ configured: true, model_id: "" })).toBe(
    false,
  );
});

test("provider connection status shows the test result instead of only the saved key", () => {
  const copy = applicationMessages("en");
  expect(providerConnectionStatus("verified", false)).toBe("configured");
  expect(providerConnectionLabel("verified", false, copy)).toBe(
    "Connection verified",
  );
  expect(providerConnectionStatus("failed", true)).toBe("failed");
  expect(providerConnectionLabel("failed", true, copy)).toBe(
    "Provider connection failed",
  );
  expect(providerConnectionStatus("idle", false)).toBe("unconfigured");
  expect(providerConnectionLabel("idle", false, copy)).toBe(
    "Key not configured",
  );
});
