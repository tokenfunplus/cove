import { expect, test, vi } from "vitest";
import { runDebateBrowserTurn } from "./debate-browser-turn";
import type { SecureInferenceEvent, SecureInferenceInput, SecureInferenceMode } from "./secure-inference";
import type { DebateBrowserContext } from "@cove/api-contract";

function fixture(mode: SecureInferenceMode = "private_tee") {
  const request: DebateBrowserContext = {
    turn: { id: "turn-one", debate_id: "debate-one", sequence: 1, round: 1, seat: 0, role: "Advocate", rule_version: 1, state: "streaming", execution: "browser", body: "", snapshot: { provider_id: "nearai-one", provider_kind: "nearai", provider_name: "NearAI", model_id: "fixture-model", privacy_mode: mode, runtime_location: "NearAI cloud", destination: "cloud-stg-api.near.ai", transport_security: "tls", privacy_notice: "Synthetic fixture" }, configuration: { system_prompt: "Immutable rules", temperature: null, top_p: null, max_tokens: 512 }, context_ids: [], created_at: "2026-11-19T00:00:00Z", updated_at: "2026-11-19T00:00:00Z" },
    messages: [{ role: "system", content: "Immutable rules" }, { role: "user", content: "A prior public answer" }, { role: "user", content: "Speak as this seat now" }],
  };
  return { request, claim: vi.fn(async () => request), progress: vi.fn(async () => {}), settle: vi.fn(async (_input: unknown) => ({})) };
}

const verification: SecureInferenceEvent = { type: "completed", verification: { status: "verified_model", completionId: "completion-one", signingKind: "provider_tee", signingAddress: "fixture-signer", signingAlgorithm: "ed25519", signature: "fixture-signature" } };

test("NearAI debate uses authoritative context, configured limits, streaming, and a verified receipt", async () => {
  const commands = fixture();
  const signal = new AbortController().signal;
  let captured: SecureInferenceInput | undefined;
  const load = vi.fn(async () => ({ async *generate(input: SecureInferenceInput) {
    captured = input;
    yield { type: "streaming" } as const;
    yield { type: "reasoning", delta: "Separate reasoning" } as const;
    yield { type: "delta", delta: "Verified public answer" } as const;
    yield { type: "response_ready", completionId: "completion-one" } as const;
    expect(commands.settle).not.toHaveBeenCalled();
    yield verification;
  } }));
  await runDebateBrowserTurn(commands, signal, load);
  expect(captured).toMatchObject({ target: { id: "nearai-one", model_id: "fixture-model", kind: "nearai" }, mode: "private_tee", configuration: { systemPrompt: "Immutable rules", maxTokens: 512 }, context: [{ role: "user", content: "A prior public answer" }], message: "Speak as this seat now" });
  expect(commands.progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "verifying_response", body: "Verified public answer" }));
  expect(commands.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ body: "Verified public answer", reasoning: "Separate reasoning", verification: expect.objectContaining({ status: "verified_model" }), metrics: expect.objectContaining({ source: "browser" }) }));
});

test("a second tab failing to claim never creates a transport or retries", async () => {
  const commands = fixture();
  commands.claim.mockRejectedValueOnce(new Error("Already claimed"));
  const load = vi.fn();
  await expect(runDebateBrowserTurn(commands, new AbortController().signal, load)).rejects.toThrow("Already claimed");
  expect(load).not.toHaveBeenCalled();
  expect(commands.claim).toHaveBeenCalledTimes(1);
  expect(commands.settle).not.toHaveBeenCalled();
});

test("gateway verification failure never submits an unverified answer to later debate context", async () => {
  const commands = fixture("incognito");
  await runDebateBrowserTurn(commands, new AbortController().signal, async () => ({ async *generate() {
    yield { type: "streaming" } as const;
    yield { type: "delta", delta: "An unverified answer" } as const;
    yield { type: "failed", code: "response_verification_failed" } as const;
  } }));
  expect(commands.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ body: "", verification: expect.objectContaining({ status: "failed", failure_code: "response_verification_failed" }) }));
});

test("leaving a debate during transport loading prevents an inference call", async () => {
  const commands = fixture();
  const controller = new AbortController();
  const generate = vi.fn();
  await expect(runDebateBrowserTurn(commands, controller.signal, async () => { controller.abort(); return { generate }; })).rejects.toMatchObject({ name: "AbortError" });
  expect(generate).not.toHaveBeenCalled();
  expect(commands.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ body: "", verification: expect.objectContaining({ failure_code: "browser_interrupted" }) }));
});
