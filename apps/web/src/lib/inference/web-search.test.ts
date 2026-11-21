import { expect, test, vi } from "vitest";
import { generateWithWebSearch, ToolCalls } from "./web-search";
import { createSecureInferenceTransport, type SecureInferenceInput, type SecureInferenceSdkFactory } from "./secure-inference";
import type { WebSearchPolicy } from "@cove/api-contract";

const policy: WebSearchPolicy = { provider: "tavily", max_searches: 1, max_pages: 1, max_rounds: 1, max_results: 5, timeout_seconds: 90, depth: "standard" };
const input: SecureInferenceInput = { target: { id: "nearai", kind: "nearai", model_id: "fixture", configured: true }, mode: "private_tee", configuration: { systemPrompt: "", temperature: null, topP: null, maxTokens: null }, context: [], message: "Research" };

test("private tool requests are verified before execution and the final receipt belongs to the final response", async () => {
  const order: string[] = [];
  const requests: Parameters<SecureInferenceSdkFactory["create"]>[0][] = [];
  const factory: SecureInferenceSdkFactory = { create(request) {
    const index = requests.length; requests.push(request);
    return {
      async *stream() {
        if (!index) yield { completionId: "tool-response", delta: "Research prelude", toolCalls: [{ index: 0, id: "call-1", type: "function" as const, function: { name: "web_search", arguments: '{"query":"evidence"}' } }] };
        else yield { completionId: "answer-response", delta: "Final answer", usage: { inputTokens: 4, outputTokens: 5 } };
      },
      async verifyResponse(completionId) { order.push(`verify:${completionId}`); return { completionId, signatureKind: "provider_tee", signingAddress: "signer", signingAlgorithm: "ed25519", signedMessage: "bytes", signature: "proof" }; },
    };
  } };
  const execute = vi.fn(async () => { order.push("execute"); return { status: "completed", content: '{"sources":[]}', info: { provider: "tavily", searches: 1, pages: 0, steps: [], sources: [] } }; });
  const events = [];
  for await (const event of generateWithWebSearch(createSecureInferenceTransport(factory), input, policy, "generation-1", undefined, execute)) events.push(event);
  expect(order).toEqual(["verify:tool-response", "execute", "verify:answer-response"]);
  expect(requests[0].tools).toHaveLength(2);
  expect(requests[1].tools).toBeUndefined();
  expect(requests[1].messages.some(message => message.role === "tool" && message.tool_call_id === "call-1")).toBe(true);
  expect(events.filter(event => event.type === "response_ready")).toEqual([{ type: "response_ready", completionId: "answer-response" }]);
  expect(events.some(event => event.type === "web_activity" && event.reset)).toBe(true);
  expect(events.find(event => event.type === "usage")).toEqual({ type: "usage", inputTokens: undefined, outputTokens: undefined });
});

test("failed model verification cannot invoke a search", async () => {
  const execute = vi.fn();
  const transport = createSecureInferenceTransport({ create() { return { async *stream() { yield { completionId: "unverified", delta: "", toolCalls: [{ index: 0, id: "call-1", type: "function", function: { name: "web_search", arguments: '{"query":"evidence"}' } }] }; }, async verifyResponse() { throw new Error("Invalid signature"); } }; } });
  const events = [];
  for await (const event of generateWithWebSearch(transport, input, policy, "generation-1", undefined, execute)) events.push(event);
  expect(execute).not.toHaveBeenCalled();
  expect(events.some(event => event.type === "web_activity" && event.reset)).toBe(true);
  expect(events.at(-1)?.type).toBe("failed");
});

test("fragmented native tool arguments have a bounded accumulator", () => {
  const calls = new ToolCalls();
  calls.add([{ index: 0, id: "call", type: "function", function: { name: "web_search", arguments: '{"query":"fresh' } }]);
  calls.add([{ index: 0, function: { arguments: ' facts"}' } }]);
  expect(calls.values()[0].function.arguments).toBe('{"query":"fresh facts"}');
  expect(() => calls.add([{ index: 8 }])).toThrow();
});
