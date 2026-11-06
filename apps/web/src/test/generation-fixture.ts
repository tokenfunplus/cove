import type { GenerationBatch } from "@cove/api-contract";

export const fixtureGenerationConfiguration = {
  system_prompt: "",
  temperature: null,
  top_p: null,
  max_tokens: null,
};

export function privacySnapshot(providerId: string, modelId: string) {
  return {
    provider_id: providerId,
    provider_name: providerId === "nearai" ? "NearAI" : "Cloud Gateway",
    model_id: modelId,
    runtime_location: "TEE",
    destination: providerId,
    transport_security: "tls" as const,
    privacy_notice: "fixture",
  };
}

export function privacyBatch(
  overrides: Partial<GenerationBatch["targets"][number]["generation"]> = {},
  options: {
    providerId?: string;
    modelId?: string;
    messageId?: string;
    verification?: GenerationBatch["targets"][number]["generation"]["verification"];
  } = {},
): GenerationBatch {
  const providerId = options.providerId ?? "nearai";
  const modelId = options.modelId ?? "private-model";
  const snapshot = privacySnapshot(providerId, modelId);
  return {
    id: `batch-${providerId}-${modelId}`,
    conversation_id: "conversation-1",
    client_request_id: "request-1",
    state: "completed",
    events_url: "/events",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:01Z",
    targets: [
      {
        id: `target-${providerId}-${modelId}`,
        provider_id: providerId,
        model_id: modelId,
        position: 0,
        generation: {
          id: `generation-${providerId}-${modelId}`,
          state: "completed",
          snapshot,
          configuration_snapshot: fixtureGenerationConfiguration,
          assistant_message_id:
            options.messageId ?? `message-${providerId}-${modelId}`,
          verification: options.verification,
          ...overrides,
        },
      },
    ],
  };
}
