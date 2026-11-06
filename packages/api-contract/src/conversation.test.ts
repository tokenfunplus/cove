import { expect, test } from "vitest";
import fixture from "../fixtures/conversation-view.json";
import generationFixture from "../fixtures/generation.json";
import type { ConversationView, Generation, GenerationConfigurationSnapshot, GenerationEvent, GenerationTargetAttempt, ProviderSnapshot } from "./index";

test("the conversation view fixture remains compatible with the typed contract", () => {
  const conversation: ConversationView = fixture;

  expect(conversation.title).toBe("Offline chat");
  expect(conversation.messages).toHaveLength(1);
  expect(conversation.messages[0]?.role).toBe("user");
});

test("the generation contract carries an immutable provider snapshot and stream events", () => {
  const snapshot: ProviderSnapshot = {
    provider_id: "provider-1",
    provider_name: "Fixture Provider",
    model_id: "model-a",
    runtime_location: "User configured cloud provider",
    destination: "provider.example",
    transport_security: "tls",
    privacy_notice: "Conversation content is sent over HTTPS/TLS."
  };
  const configurationSnapshot: GenerationConfigurationSnapshot = {
    system_prompt: "Answer in one sentence.",
    temperature: 0,
    top_p: null,
    max_tokens: 256
  };
  const generation: Generation = {
    id: "generation-1",
    conversation_id: "conversation-1",
    client_request_id: "request-1",
    state: "pending",
    snapshot,
    configuration_snapshot: configurationSnapshot,
    events_url: "/api/generations/generation-1/events",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z"
  };
  const targetAttempt: GenerationTargetAttempt = {
    id: generation.id,
    state: generation.state,
    snapshot,
    configuration_snapshot: configurationSnapshot
  };
  const event: GenerationEvent = { event_id: "1", generation_id: generation.id, type: "started", snapshot };

  expect(generation.snapshot).toEqual(snapshot);
  expect(event.type).toBe("started");
  expect(targetAttempt.configuration_snapshot.temperature).toBe(0);
});

test("the generation fixture remains compatible with the typed contract", () => {
  const generation = {
    ...generationFixture,
    state: "completed" as const,
    snapshot: {
      ...generationFixture.snapshot,
      transport_security: "tls" as const
    },
    verification: {
      ...generationFixture.verification,
      status: "verified_model" as const,
      signature_kind: "provider_tee" as const,
      lanes: {
        gateway: "verified" as const,
        model: "verified" as const,
        response: "verified" as const
      }
    }
  } satisfies Generation;

  expect(generation.state).toBe("completed");
  expect(generation.snapshot.transport_security).toBe("tls");
  expect(generation.events_url).toContain("/events");
});
