import { expect, test } from "vitest";
import type { GenerationBatchEvent } from "@cove/api-contract";
import { applyLiveTurnEvent, createLiveTurn } from "./live-turn";

test("a comparison Live Turn starts one independent pending answer for each selected model", () => {
  const turn = createLiveTurn("conversation-1", "Hello", "request-1", [
    { providerId: "provider-a", modelId: "model-a" },
    { providerId: "provider-b", modelId: "model-b" }
  ]);

  expect(turn.targets).toEqual([
    expect.objectContaining({ providerId: "provider-a", modelId: "model-a", phase: "pending", assistantBody: "" }),
    expect.objectContaining({ providerId: "provider-b", modelId: "model-b", phase: "pending", assistantBody: "" })
  ]);
});

test("a Batch event updates only the addressed Generation Target", () => {
  const turn = {
    ...createLiveTurn("conversation-1", "Hello", "request-1", [{ providerId: "provider-a", modelId: "model-a" }, { providerId: "provider-b", modelId: "model-b" }]),
    batchId: "batch-1",
    targets: [
      { key: "target-a", targetId: "target-a", generationId: "generation-a", providerId: "provider-a", modelId: "model-a", assistantBody: "", phase: "pending" as const },
      { key: "target-b", targetId: "target-b", generationId: "generation-b", providerId: "provider-b", modelId: "model-b", assistantBody: "", phase: "pending" as const }
    ]
  };
  const event: GenerationBatchEvent = { event_id: "1", batch_id: "batch-1", target_id: "target-b", generation_id: "generation-b", type: "delta", delta: "B only" };

  const next = applyLiveTurnEvent(turn, event);

  expect(next.targets?.[0]).toMatchObject({ assistantBody: "", phase: "pending" });
  expect(next.targets?.[1]).toMatchObject({ assistantBody: "B only", phase: "streaming" });
});

test("a replayed event from an earlier attempt cannot alter a retried target", () => {
  const turn = {
    ...createLiveTurn("conversation-1", "Hello", "request-1", [{ providerId: "provider-a", modelId: "model-a" }]),
    batchId: "batch-1",
    targets: [{ key: "target-a", targetId: "target-a", generationId: "generation-retry", providerId: "provider-a", modelId: "model-a", assistantBody: "", phase: "pending" as const }]
  };

  const next = applyLiveTurnEvent(turn, { event_id: "1", batch_id: "batch-1", target_id: "target-a", generation_id: "generation-original", type: "delta", delta: "stale" });

  expect(next.targets?.[0]).toMatchObject({ generationId: "generation-retry", assistantBody: "", phase: "pending" });
});

test("a failed Batch event keeps its actionable Provider error details", () => {
  const turn = {
    ...createLiveTurn("conversation-1", "Hello", "request-1", [{ providerId: "provider-a", modelId: "model-a" }]),
    batchId: "batch-1",
    targets: [{ key: "target-a", targetId: "target-a", generationId: "generation-a", providerId: "provider-a", modelId: "model-a", assistantBody: "", phase: "streaming" as const }]
  };

  const next = applyLiveTurnEvent(turn, {
    event_id: "2", batch_id: "batch-1", target_id: "target-a", generation_id: "generation-a", type: "failed",
    error_code: "output_limit", error_message: "The Provider reached the output token limit before returning an assistant response."
  });

  expect(next.targets?.[0]).toMatchObject({ phase: "failed", errorCode: "output_limit", errorMessage: expect.any(String) });
});
