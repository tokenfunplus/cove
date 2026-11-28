import { afterEach, expect, test, vi } from "vitest";
import type { ProviderSnapshot } from "@cove/api-contract";
import type { SecureInferenceTransport } from "./secure-inference";
import { request } from "@/api/client";
import { runVerifiedBrowserTurn } from "./debate-browser-turn";
import { runVerifiedAppTask } from "./mini-app-task";

vi.mock("@/api/client", () => ({ request: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

function claim() {
  return {
    snapshot: {
      provider_id: "nearai",
      provider_kind: "nearai",
      privacy_mode: "private_tee",
      model_id: "fixture-model",
      provider_name: "NearAI",
      runtime_location: "provider",
      destination: "https://fixture.example",
      transport_security: "tls",
      privacy_notice: "Fixture",
    } satisfies ProviderSnapshot,
    prompt: "Frozen example passage",
  };
}
test("app verification claims the authorized prompt, exposes no interim answer and settles the SDK receipt", async () => {
  vi.mocked(request).mockImplementation(async (path) =>
    path.endsWith("/claim") ? claim() : undefined,
  );
  const generate = vi.fn<SecureInferenceTransport["generate"]>(
    async function* () {
      yield { type: "streaming" };
      yield { type: "delta", delta: "Candidate output" };
      yield { type: "response_ready", completionId: "fixture" };
      yield {
        type: "completed",
        verification: {
          status: "verified_model",
          completionId: "fixture",
          signingKind: "provider_tee",
          signingAddress: "signer",
          signingAlgorithm: "ed25519",
          signature: "example",
        },
      };
    },
  );
  await runVerifiedAppTask(
    "book",
    "task",
    new AbortController().signal,
    async () => ({ generate }),
  );
  expect(generate).toHaveBeenCalledOnce();
  expect(generate.mock.calls[0]?.[0]).toMatchObject({
    context: [],
    message: claim().prompt,
    mode: "private_tee",
    target: { model_id: "fixture-model" },
  });
  const steps = vi.mocked(request).mock.calls.map(([path, init]) => ({
    path,
    data: JSON.parse(init!.body as string),
  }));
  expect(
    steps.every((step) =>
      step.path.startsWith("/api/mini-apps/instances/book/tasks/task/browser/"),
    ),
  ).toBe(true);
  expect(new Set(steps.map((step) => step.data.claim_id)).size).toBe(1);
  expect(steps[0].data.claim_id).toEqual(expect.any(String));
  expect(steps[0].data.claim_id.length).toBeGreaterThan(0);
  for (const step of steps.filter((step) => step.path.endsWith("/progress")))
    expect(step.data).not.toHaveProperty("body");
  expect(steps.at(-1)?.data).toMatchObject({
    body: "Candidate output",
    verification: { status: "verified_model", completion_id: "fixture" },
  });
});
test("a rejected app claim never opens model transport", async () => {
  vi.mocked(request)
    .mockResolvedValue(undefined)
    .mockRejectedValueOnce(new Error("Already claimed"));
  const load = vi.fn();
  await expect(
    runVerifiedAppTask("book", "task", new AbortController().signal, load),
  ).rejects.toThrow("Already claimed");
  expect(load).not.toHaveBeenCalled();
  const calls = vi.mocked(request).mock.calls;
  expect(calls).toHaveLength(2);
  const claim = JSON.parse(calls[0][1]!.body as string);
  expect(calls[1][0]).toBe(
    "/api/mini-apps/instances/book/tasks/task/browser/settle",
  );
  expect(JSON.parse(calls[1][1]!.body as string)).toMatchObject({
    claim_id: claim.claim_id,
    body: "",
    verification: { status: "failed" },
  });
});

function verifiedTransport() {
  return {
    generate: vi.fn<SecureInferenceTransport["generate"]>(async function* () {
      yield { type: "streaming" };
      yield { type: "delta", delta: "Retained answer" };
      yield { type: "response_ready", completionId: "fixture" };
      yield {
        type: "completed",
        verification: {
          status: "verified_model",
          completionId: "fixture",
          signingKind: "provider_tee",
          signingAddress: "signer",
          signingAlgorithm: "ed25519",
          signature: "example",
        },
      };
    }),
  };
}
test("a transient progress and settlement failure retries delivery without another provider call", async () => {
  let progressFailed = false,
    settleFailed = false;
  vi.mocked(request).mockImplementation(async (path) => {
    if (path.endsWith("/claim")) return claim();
    if (path.endsWith("/progress") && !progressFailed) {
      progressFailed = true;
      throw new Error("temporary disconnect");
    }
    if (path.endsWith("/settle") && !settleFailed) {
      settleFailed = true;
      throw new Error("lost response");
    }
    return undefined;
  });
  const transport = verifiedTransport();
  await runVerifiedAppTask(
    "book",
    "task",
    new AbortController().signal,
    async () => transport,
  );
  expect(transport.generate).toHaveBeenCalledOnce();
  const settlements = vi
    .mocked(request)
    .mock.calls.filter(([path]) => path.endsWith("/settle"));
  expect(settlements).toHaveLength(2);
  expect(settlements[0][1]?.body).toBe(settlements[1][1]?.body);
  expect(JSON.parse(settlements[1][1]!.body as string)).toMatchObject({
    body: "Retained answer",
    verification: { status: "verified_model" },
  });
});
test("an already verified result is never replaced with an empty failed receipt", async () => {
  const transport = verifiedTransport();
  const settle = vi.fn().mockRejectedValue(new Error("delivery unavailable"));
  const context = {
    turn: {
      snapshot: claim().snapshot,
      configuration: {
        system_prompt: "",
        max_tokens: null,
        temperature: null,
        top_p: null,
      },
    },
    messages: [
      { role: "system" as const, content: "" },
      { role: "user" as const, content: "Text" },
    ],
  };
  await expect(
    runVerifiedBrowserTurn(
      { claim: async () => context, progress: async () => {}, settle },
      new AbortController().signal,
      async () => transport,
    ),
  ).rejects.toThrow("delivery unavailable");
  expect(settle).toHaveBeenCalledOnce();
  expect(settle.mock.calls[0][0]).toMatchObject({
    body: "Retained answer",
    verification: { status: "verified_model" },
  });
});

test("app settlement retains eight sends and 7.1 seconds of backoff without repeating inference", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const settlementTimes: number[] = [];
  const error = { envelope: { error: { code: "internal_error" } } };
  vi.mocked(request).mockImplementation(async (path) => {
    if (path.endsWith("/claim")) return claim();
    if (path.endsWith("/settle")) {
      settlementTimes.push(Date.now());
      throw error;
    }
    return undefined;
  });
  const transport = verifiedTransport();
  const result = runVerifiedAppTask(
    "book",
    "task",
    new AbortController().signal,
    async () => transport,
  );
  const rejected = expect(result).rejects.toBe(error);
  await vi.waitFor(() => expect(settlementTimes).toHaveLength(1));
  const startedAt = settlementTimes[0];
  for (const offset of [100, 300, 700, 1500, 3100, 5100, 7100]) {
    const before = settlementTimes.length;
    await vi.advanceTimersByTimeAsync(startedAt + offset - Date.now() - 1);
    expect(settlementTimes).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(settlementTimes).toHaveLength(before + 1);
  }
  await rejected;
  const claims = vi
    .mocked(request)
    .mock.calls.filter(([path]) => path.endsWith("/claim"));
  const settlements = vi
    .mocked(request)
    .mock.calls.filter(([path]) => path.endsWith("/settle"));
  expect(claims).toHaveLength(1);
  expect(transport.generate).toHaveBeenCalledOnce();
  expect(settlements).toHaveLength(8);
  expect(settlementTimes.map(time => time - startedAt)).toEqual([0, 100, 300, 700, 1500, 3100, 5100, 7100]);
  expect(vi.getTimerCount()).toBe(0);
  expect(new Set(settlements.map(([, init]) => init?.body)).size).toBe(1);
  expect(JSON.parse(settlements[0]![1]!.body as string)).toMatchObject({
    body: "Retained answer",
    verification: { status: "verified_model" },
  });
});


test("App receipt delivery recovers after an outage beyond the Debate retry window", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const receipts: unknown[] = [];
  let startedAt = 0;
  vi.mocked(request).mockImplementation(async (path, init) => {
    if (path.endsWith("/claim")) return claim();
    if (path.endsWith("/settle")) {
      if (!receipts.length) startedAt = Date.now();
      receipts.push(init?.body);
      if (Date.now() - startedAt < 3000) throw new Error("Local Service temporarily unavailable");
    }
    return undefined;
  });
  const transport = verifiedTransport();
  const result = runVerifiedAppTask("book", "task", new AbortController().signal, async () => transport);
  await vi.waitFor(() => expect(receipts).toHaveLength(1));
  await vi.runAllTimersAsync();
  await result;
  expect(Date.now() - startedAt).toBe(3100);
  expect(receipts).toHaveLength(6);
  expect(new Set(receipts).size).toBe(1);
  expect(vi.mocked(request).mock.calls.filter(([path]) => path.endsWith("/claim"))).toHaveLength(1);
  expect(transport.generate).toHaveBeenCalledOnce();
});

test("aborting App receipt backoff stops retries without replacing the paid result", async () => {
  vi.useFakeTimers();
  const error = new Error("Receipt delivery unavailable");
  const controller = new AbortController();
  vi.mocked(request).mockImplementation(async path => {
    if (path.endsWith("/claim")) return claim();
    if (path.endsWith("/settle")) throw error;
    return undefined;
  });
  const transport = verifiedTransport();
  const result = runVerifiedAppTask("book", "task", controller.signal, async () => transport);
  const rejected = expect(result).rejects.toBe(error);
  await vi.waitFor(() => expect(vi.mocked(request).mock.calls.some(([path]) => path.endsWith("/settle"))).toBe(true));
  controller.abort();
  await rejected;
  await vi.runAllTimersAsync();
  const receipts = vi.mocked(request).mock.calls.filter(([path]) => path.endsWith("/settle"));
  expect(receipts).toHaveLength(1);
  expect(JSON.parse(receipts[0][1]!.body as string)).toMatchObject({ body: "Retained answer", verification: { status: "verified_model" } });
  expect(transport.generate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
