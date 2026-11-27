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
  for (const step of steps.filter((step) => step.path.endsWith("/progress")))
    expect(step.data).not.toHaveProperty("body");
  expect(steps.at(-1)?.data).toMatchObject({
    body: "Candidate output",
    verification: { status: "verified_model", completion_id: "fixture" },
  });
});
test("a rejected app claim never opens model transport", async () => {
  vi.mocked(request).mockRejectedValueOnce(new Error("Already claimed"));
  const load = vi.fn();
  await expect(
    runVerifiedAppTask("book", "task", new AbortController().signal, load),
  ).rejects.toThrow("Already claimed");
  expect(load).not.toHaveBeenCalled();
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

test("app settlement uses the shared five-send bound and preserves every verified byte", async () => {
  vi.useFakeTimers();
  const error = { envelope: { error: { code: "internal_error" } } };
  vi.mocked(request).mockImplementation(async (path) => {
    if (path.endsWith("/claim")) return claim();
    if (path.endsWith("/settle")) throw error;
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
  await vi.waitFor(() =>
    expect(
      vi.mocked(request).mock.calls.some(([path]) => path.endsWith("/settle")),
    ).toBe(true),
  );
  await vi.runAllTimersAsync();
  await rejected;
  const claims = vi
    .mocked(request)
    .mock.calls.filter(([path]) => path.endsWith("/claim"));
  const settlements = vi
    .mocked(request)
    .mock.calls.filter(([path]) => path.endsWith("/settle"));
  expect(claims).toHaveLength(1);
  expect(transport.generate).toHaveBeenCalledOnce();
  expect(settlements).toHaveLength(5);
  expect(new Set(settlements.map(([, init]) => init?.body)).size).toBe(1);
  expect(JSON.parse(settlements[0]![1]!.body as string)).toMatchObject({
    body: "Retained answer",
    verification: { status: "verified_model" },
  });
});
