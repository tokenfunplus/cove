import { expect, test } from "vitest";
import batchFixture from "../fixtures/generation-batch.json";
import eventFixture from "../fixtures/generation-batch-event.json";
import type { GenerationBatch, GenerationBatchEvent, GenerationConfigurationSnapshot, GenerationVerification, ProviderSnapshot } from "./index";

test("a Model Comparison Batch exposes independently addressable Targets on one event stream", () => {
  const snapshot: ProviderSnapshot = {
    provider_id: "provider-a",
    provider_name: "Fixture A",
    model_id: "model-a",
    runtime_location: "local test",
    destination: "fixture.example",
    transport_security: "tls",
    privacy_notice: "Fixture only."
  };
  const configurationSnapshot: GenerationConfigurationSnapshot = {
    system_prompt: "Compare independently.", temperature: null, top_p: 0.9, max_tokens: 512
  };
  const verification: GenerationVerification = { status: "pending" };
  const batch: GenerationBatch = {
    id: "batch-1",
    conversation_id: "conversation-1",
    client_request_id: "request-1",
    state: "pending",
    events_url: "/api/generation-batches/batch-1/events",
    targets: [
      { id: "target-a", provider_id: "provider-a", model_id: "model-a", position: 0, generation: { id: "generation-a", state: "pending", snapshot, configuration_snapshot: configurationSnapshot, verification } },
      { id: "target-b", provider_id: "provider-b", model_id: "model-b", position: 1, generation: { id: "generation-b", state: "pending", snapshot: { ...snapshot, provider_id: "provider-b", model_id: "model-b" }, configuration_snapshot: configurationSnapshot, verification } }
    ],
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z"
  };
  const event: GenerationBatchEvent = {
    event_id: "1",
    batch_id: batch.id,
    target_id: "target-b",
    generation_id: "generation-b",
    type: "started"
  };

  expect(batch.targets).toHaveLength(2);
  expect(event.target_id).toBe(batch.targets[1]?.id);
  expect(batch.events_url).toContain(batch.id);
});

test("versioned fixtures remain compatible with the Batch contract", () => {
  const batch = {
    ...batchFixture,
    state: batchFixture.state as GenerationBatch["state"],
    targets: batchFixture.targets.map((target) => ({
      ...target,
      generation: {
        ...target.generation,
        state: target.generation.state as GenerationBatch["targets"][number]["generation"]["state"],
        snapshot: {
          ...target.generation.snapshot,
          transport_security: target.generation.snapshot.transport_security as ProviderSnapshot["transport_security"]
        }
      }
    }))
  } satisfies GenerationBatch;
  const event = { ...eventFixture, type: eventFixture.type as GenerationBatchEvent["type"] } satisfies GenerationBatchEvent;

  expect(batch.targets).toHaveLength(2);
  expect(event.batch_id).toBe(batch.id);
});

test("frozen context carries only ordered prior user and selected assistant content", async () => {
  const { default: fixture } = await import("../fixtures/generation-context.json");
  const context = fixture.map(message => ({...message, role: message.role as import("./index").GenerationContextMessage["role"]}));
  expect(context.map(message=>message.role)).toEqual(["user","assistant"]);
  expect(context[1]?.content).toBe("Selected answer");
});
