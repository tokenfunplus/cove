import { InferenceClient } from "@nearai/inference-sdk";
import { afterEach, expect, test, vi } from "vitest";
import type { ProviderProfile } from "@cove/api-contract";
import { BrowserGatewayResponseClient, BrowserNearAISdkClient, createSecureInferenceTransport, secureInferenceFailureReason, type SecureInferenceInput, type SecureInferenceReceipt, type SecureInferenceSdkClient, type SecureInferenceSdkFactory, type SecureInferenceVerificationEvent } from "./secure-inference";
import { PRIVATE_CONNECTION_PROBE, runPrivateConnectionProbe } from "./private-connection";

const privateModel: ProviderProfile = {
  id: "nearai",
  kind: "nearai",
  name: "NearAI",
  endpoint: "https://cloud-stg-api.near.ai",
  model_id: "private-model",
  auth_method: "bearer",
  runtime_location: "NearAI cloud",
  destination: "cloud-stg-api.near.ai",
  transport_security: "tls",
  privacy_notice: "Fixture only.",
  configured: true,
  created_at: "2026-09-18T00:00:00Z",
  updated_at: "2026-09-18T00:00:00Z"
};

test("Secure Inference Transport emits decrypted deltas and verifies the fully consumed provider TEE response", async () => {
  let captured: Parameters<SecureInferenceSdkFactory["create"]>[0] | undefined;
  const client: SecureInferenceSdkClient = {
    async *stream() {
      yield { completionId: "completion-1", delta: "Private " };
      yield { completionId: "completion-1", delta: "answer" };
    },
    async verifyResponse(completionId) {
      expect(completionId).toBe("completion-1");
      return {
        completionId,
        signatureKind: "provider_tee",
        signingAddress: "ed25519:tee-signer",
        signingAlgorithm: "ed25519",
        signedMessage: "request-and-response-bytes",
        signature: "proof"
      };
    }
  };
  const factory: SecureInferenceSdkFactory = {
    create(input) {
      captured = input;
      return client;
    }
  };
  const transport = createSecureInferenceTransport(factory);

  const events = [];
  for await (const event of transport.generate({
    target: privateModel,
    mode: "private_tee",
    configuration: { systemPrompt: "Use short answers.", temperature: 0, topP: 0.8, maxTokens: 512 },
    context: [{ role: "user", content: "Earlier question" }, { role: "assistant", content: "Earlier answer" }],
    message: "What is protected?"
  })) {
    events.push(event);
  }

  expect(events).toEqual([
    { type: "verifying_environment" },
    { type: "streaming" },
    { type: "delta", delta: "Private " },
    { type: "delta", delta: "answer" },
    { type: "response_ready", completionId: "completion-1" },
    { type: "verifying_response" },
    {
      type: "completed",
      verification: {
        status: "verified_model",
        completionId: "completion-1",
        signingKind: "provider_tee",
        signingAddress: "ed25519:tee-signer",
        signingAlgorithm: "ed25519",
        signedMessage: "request-and-response-bytes",
        signature: "proof"
      }
    }
  ]);
  expect(captured).toEqual({
    baseUrl: "http://127.0.0.1/api/nearai/nearai/v1/",
    model: "private-model",
    messages: [
      { role: "system", content: "Use short answers." },
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "What is protected?" }
    ],
    temperature: 0,
    topP: 0.8,
    maxTokens: 512
  });
});

test("Secure Inference Transport returns after response_ready while receipt verification continues through the callback", async () => {
  let releaseVerification!: (receipt: SecureInferenceReceipt) => void;
  let verificationStarted = false;
  let verificationEvent: SecureInferenceVerificationEvent | undefined;
  const transport = createSecureInferenceTransport({
    create() {
      return {
        async *stream() {
          yield { completionId: "completion-background", delta: "ready" };
        },
        async verifyResponse() {
          verificationStarted = true;
          return new Promise<SecureInferenceReceipt>((resolve) => {
            releaseVerification = resolve;
          });
        }
      };
    }
  });

  const events = [];
  for await (const event of transport.generate({
    target: privateModel,
    mode: "private_tee",
    configuration: { systemPrompt: "", temperature: null, topP: null, maxTokens: null },
    context: [],
    message: "Persist before verifying"
  }, undefined, {
    onVerification(event) {
      verificationEvent = event;
    }
  })) {
    events.push(event);
  }

  expect(events.at(-1)).toEqual({ type: "verifying_response" });
  expect(verificationStarted).toBe(true);
  expect(verificationEvent).toBeUndefined();

  releaseVerification({
    completionId: "completion-background",
    signatureKind: "provider_tee",
    signingAddress: "ed25519:tee-signer",
    signingAlgorithm: "ed25519",
    signedMessage: "request-and-response-bytes",
    signature: "proof"
  });
  await vi.waitFor(() => expect(verificationEvent).toEqual({
    type: "completed",
    verification: {
      status: "verified_model",
      completionId: "completion-background",
      signingKind: "provider_tee",
      signingAddress: "ed25519:tee-signer",
      signingAlgorithm: "ed25519",
      signedMessage: "request-and-response-bytes",
      signature: "proof"
    }
  }));
});

test("Secure Inference Transport keeps a valid Gateway receipt distinct from a model-verified response", async () => {
  const transport = createSecureInferenceTransport({
    create() {
      return {
        async *stream() {
          yield { completionId: "completion-2", delta: "Gateway answer" };
        },
        async verifyResponse() {
          return {
            completionId: "completion-2",
            signatureKind: "gateway",
            signingAddress: "ed25519:gateway-signer",
            signingAlgorithm: "ed25519",
            signedMessage: "request-and-response-bytes",
            signature: "gateway-proof"
          };
        }
      };
    }
  });

  const events = [];
  for await (const event of transport.generate({
    target: privateModel,
    mode: "private_tee",
    configuration: { systemPrompt: "", temperature: null, topP: null, maxTokens: null },
    context: [],
    message: "What was signed?"
  })) {
    events.push(event);
  }

  expect(events.at(-1)).toEqual({
    type: "completed",
    verification: {
      status: "verified_gateway",
      completionId: "completion-2",
      signingKind: "gateway",
      signingAddress: "ed25519:gateway-signer",
      signingAlgorithm: "ed25519",
      signedMessage: "request-and-response-bytes",
      signature: "gateway-proof"
    }
  });
});

test("Secure Inference Transport reports a generic unsupported result without opening a browser SDK client", async () => {
  let clientsCreated = 0;
  const transport = createSecureInferenceTransport({
    create() {
      clientsCreated += 1;
      throw new Error("must not create a private transport for this Provider");
    }
  });
  const events = [];
  for await (const event of transport.generate({
    target: { ...privateModel, kind: "openai_compatible" },
    configuration: { systemPrompt: "", temperature: null, topP: null, maxTokens: null },
    context: [],
    message: "Ordinary Provider request"
  })) {
    events.push(event);
  }

  expect(clientsCreated).toBe(0);
  expect(events).toEqual([{ type: "completed", verification: { status: "unsupported", reason: "provider_not_private" } }]);
});

test("Secure Inference Transport preserves a safe provider failure reason for the UI", async () => {
  const transport = createSecureInferenceTransport({
    create() {
      throw new Error("Provider error: No provider found that supports attestation reports for model: openai/gpt-4.1-mini");
    }
  });
  const events = [];
  for await (const event of transport.generate({
    target: privateModel,
    mode: "private_tee",
    configuration: { systemPrompt: "", temperature: null, topP: null, maxTokens: null },
    context: [],
    message: "Probe"
  })) {
    events.push(event);
  }

  expect(events.at(-1)).toEqual({
    type: "failed",
    code: "environment_verification_failed",
    reason: "Provider error: No provider found that supports attestation reports for model: openai/gpt-4.1-mini"
  });
  expect(secureInferenceFailureReason(new Error("generic SDK failure"))).toBeUndefined();
});

test("environment verification refreshes attestation without creating a Completion client", async () => {
  let clientsCreated = 0;
  let capturedInput: Parameters<NonNullable<SecureInferenceSdkFactory["verifyEnvironment"]>>[0] | undefined;
  const environment = {
    model: {
      kind: "model" as const,
      signerAddress: "model-signer",
      signingAlgorithm: "ed25519" as const,
      tcbStatus: "UpToDate",
      advisoryIds: [],
      gpuEvidence: "not_provided" as const,
      deployment: { appCompose: "fixture-compose" },
      raw: { intel_quote: "fresh-model-quote" }
    },
    gateway: {
      kind: "gateway" as const,
      signerAddress: "gateway-signer",
      signingAlgorithm: "ed25519" as const,
      tcbStatus: "UpToDate",
      advisoryIds: [],
      tlsBinding: "none" as const,
      deployment: { appCompose: "fixture-compose" },
      raw: { intel_quote: "fresh-gateway-quote" }
    }
  };
  const transport = createSecureInferenceTransport({
    create() {
      clientsCreated += 1;
      throw new Error("Verify Again must not create a Completion client");
    },
    async verifyEnvironment(input) {
      capturedInput = input;
      return environment;
    }
  });

  const refreshed = await transport.verifyEnvironment!({
    target: privateModel,
    mode: "private_tee"
  });

  expect(clientsCreated).toBe(0);
  expect(capturedInput).toMatchObject({
    model: "private-model",
    messages: []
  });
  expect(refreshed).toEqual(environment);
});

test("Secure Inference Transport fails before a Completion when environment setup is rejected", async () => {
  const transport = createSecureInferenceTransport({
    create() {
      throw new Error("model attestation rejected");
    }
  });
  const events = [];
  for await (const event of transport.generate({
    target: privateModel,
    mode: "private_tee",
    configuration: { systemPrompt: "", temperature: null, topP: null, maxTokens: null },
    context: [],
    message: "Do not send this plaintext"
  })) {
    events.push(event);
  }

  expect(events).toEqual([
    { type: "verifying_environment" },
    { type: "failed", code: "environment_verification_failed" }
  ]);
});

test("SDK Gateway and model evidence fixture failures never dispatch a Completion", async () => {
  for (const failure of ["gateway_nonce_mismatch", "model_policy_rejected"] as const) {
    const quoteFixtures = new Map<string, Awaited<ReturnType<typeof verifiedQuoteFixture>>>();
    const requests: Array<{ method: string; path: string; model: string | null }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      requests.push({ method: request.method, path: url.pathname, model: url.searchParams.get("model") });
      if (url.pathname.includes("/model/")) {
        return new Response(JSON.stringify({ metadata: { providerType: "vllm", attestationSupported: true } }), { status: 200 });
      }
      const nonce = url.searchParams.get("nonce");
      if (!nonce) throw new Error("SDK evidence request omitted its nonce");

      if (url.searchParams.has("model")) {
        const fixture = await verifiedAttestationFixture(nonce, "model-quote", quoteFixtures);
        return new Response(JSON.stringify({ model_attestations: [fixture] }), { status: 200 });
      }

      if (failure === "gateway_nonce_mismatch") {
        return new Response(JSON.stringify({ gateway_attestation: invalidNonceAttestationFixture() }), { status: 200 });
      }
      const fixture = await verifiedAttestationFixture(nonce, "gateway-quote", quoteFixtures);
      return new Response(JSON.stringify({ gateway_attestation: fixture }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);

    const client = new InferenceClient({
      baseUrl: "http://127.0.0.1/api/nearai/nearai/v1/",
      headers: { "X-Cove-CSRF-Token": "fixture-csrf" },
      signingAlgo: "ed25519",
      gatewayVerification: { verifiers: { tdxQuote: (quote) => quoteFixtures.get(quote)! } },
      modelVerification: { verifiers: { tdxQuote: (quote) => quoteFixtures.get(quote)! } },
      ...(failure === "model_policy_rejected" ? { deploymentPolicy: () => { throw new Error("fixture deployment rejected"); } } : {})
    });

    await expect(client.chat.completions.create({
      model: "private-model",
      messages: [{ role: "user", content: "Fixture request" }],
      stream: true
    })).rejects.toBeDefined();

    // The OpenAI wrapper may retry a rejected SDK fetch. Every observed
    // request must nevertheless stay in the evidence route, never Completion.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.method === "GET" && (request.path === "/api/nearai/nearai/v1/attestation/report" || request.path === "/api/nearai/nearai/v1/model/private-model"))).toBe(true);
    expect(requests.some((request) => request.model === "private-model")).toBe(failure === "model_policy_rejected");
  }
});

test("one browser SDK Generation starts exactly one Gateway and model attestation round", async () => {
  const clearResponseCache = vi.fn();
  const attestationRequests: string[] = [];
  const recordAttestationRound = () => {
    attestationRequests.push(
      "/api/nearai/nearai/v1/attestation/report",
      "/api/nearai/nearai/v1/attestation/report?model=private-model"
    );
  };
  const completion = async function* () {
    yield { id: "completion-single-round", choices: [{ delta: { content: "verified" } }] };
  };
  const client = new BrowserNearAISdkClient({
    baseUrl: "http://127.0.0.1/api/nearai/nearai/v1/",
    model: "private-model",
    messages: [{ role: "user", content: "One Generation" }]
  }, {
    client: {
      clearResponseCache,
      chat: { completions: { async create() { recordAttestationRound(); return completion(); } } },
      async verifyResponse() {
        return {
          id: "completion-single-round",
          completionId: "completion-single-round",
          signatureKind: "provider_tee",
          signature: {
            kind: "provider_tee",
            signature: "proof",
            signedText: "request-and-response-bytes",
            signer: { signingAddress: "model-signer", signingAlgo: "ed25519" }
          },
          attestation: {
            report: { nonce: "aa".repeat(32), signer: { signingAddress: "model-signer", signingAlgo: "ed25519" }, intelQuote: "fixture-quote", eventLog: [], appCompose: fixtureAppCompose },
            signer: { signingAddress: "model-signer", signingAlgo: "ed25519" },
            tcbStatus: "UpToDate",
            advisoryIds: [],
            gpuEvidence: "verified",
            signingPublicKey: new Uint8Array(32),
            deployment: { appCompose: fixtureAppCompose, runtimeMeasurements: {} }
          }
        } as unknown as Awaited<ReturnType<InferenceClient["verifyResponse"]>>;
      }
    } as unknown as InferenceClient
  });

  for await (const _chunk of client.stream()) {
    // Fully consume the stream so the SDK response is ready for verification.
  }
  const receipt = await client.verifyResponse("completion-single-round");
  expect(receipt.evidence?.raw.intel_quote).toBe("fixture-quote");
  expect(clearResponseCache).toHaveBeenCalledOnce();

  expect(attestationRequests).toEqual([
    "/api/nearai/nearai/v1/attestation/report",
    "/api/nearai/nearai/v1/attestation/report?model=private-model"
  ]);
});

test("browser SDK clears captured response bytes after interrupted streams and failed verification", async () => {
  const clearResponseCache = vi.fn();
  const client = new BrowserNearAISdkClient({
    baseUrl: "http://127.0.0.1/api/nearai/nearai/v1/",
    model: "private-model",
    messages: [{ role: "user", content: "fixture" }]
  }, {
    client: {
      chat: { completions: { create: async () => { throw new DOMException("Cancelled", "AbortError"); } } },
      verifyResponse: async () => { throw new Error("invalid signature"); },
      clearResponseCache
    } as unknown as InferenceClient
  });
  const drain = async () => { for await (const _chunk of client.stream()) { /* drain */ } };
  await expect(drain()).rejects.toThrow("Cancelled");
  expect(clearResponseCache).toHaveBeenCalledTimes(1);
  await expect(client.verifyResponse("fixture-id")).rejects.toThrow("invalid signature");
  expect(clearResponseCache).toHaveBeenCalledTimes(2);
});

test("Secure Inference Transport passes cancellation to the browser SDK and never verifies an interrupted response", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  let verified = false;
  const transport = createSecureInferenceTransport({
    create() {
      return {
        async *stream(signal) {
          receivedSignal = signal;
          yield { completionId: "completion-3", delta: "partial" };
          controller.abort();
          throw new DOMException("The user stopped private inference.", "AbortError");
        },
        async verifyResponse() {
          verified = true;
          throw new Error("must not verify an interrupted stream");
        }
      };
    }
  });

  const events = [];
  for await (const event of transport.generate({
    target: privateModel,
    mode: "private_tee",
    configuration: { systemPrompt: "", temperature: null, topP: null, maxTokens: null },
    context: [],
    message: "Stop this private request"
  }, controller.signal)) {
    events.push(event);
  }

  expect(receivedSignal).toBe(controller.signal);
  expect(verified).toBe(false);
  expect(events).toEqual([
    { type: "verifying_environment" },
    { type: "streaming" },
    { type: "delta", delta: "partial" },
    { type: "failed", code: "stream_failed" }
  ]);
});

test("Secure Inference Transport settles immediately when cancellation arrives during response verification", async () => {
  const controller = new AbortController();
  let verificationStarted = false;
  const transport = createSecureInferenceTransport({
    create() {
      return {
        async *stream() {
          yield { completionId: "completion-4", delta: "complete encrypted response" };
        },
        async verifyResponse() {
          verificationStarted = true;
          controller.abort();
          return new Promise(() => {});
        }
      };
    }
  });

  const events = [];
  for await (const event of transport.generate({
    target: privateModel,
    mode: "private_tee",
    configuration: { systemPrompt: "", temperature: null, topP: null, maxTokens: null },
    context: [],
    message: "Stop while checking the receipt"
  }, controller.signal)) {
    events.push(event);
  }

  expect(verificationStarted).toBe(true);
  expect(events).toEqual([
    { type: "verifying_environment" },
    { type: "streaming" },
    { type: "delta", delta: "complete encrypted response" },
    { type: "response_ready", completionId: "completion-4" },
    { type: "verifying_response" },
    { type: "failed", code: "response_verification_failed" }
  ]);
});

test("Secure Inference Transport does not start a signature lookup after cancellation before verification", async () => {
  const controller = new AbortController();
  let responseVerificationStarted = false;
  const transport = createSecureInferenceTransport({
    create() {
      return {
        async *stream() {
          yield { completionId: "completion-5", delta: "complete encrypted response" };
        },
        async verifyResponse() {
          responseVerificationStarted = true;
          throw new Error("signature lookup must not start after cancellation");
        }
      };
    }
  });
  const events = transport.generate({
    target: privateModel,
    mode: "private_tee",
    configuration: { systemPrompt: "", temperature: null, topP: null, maxTokens: null },
    context: [],
    message: "Stop before checking the receipt"
  }, controller.signal);

  expect((await events.next()).value).toEqual({ type: "verifying_environment" });
  expect((await events.next()).value).toEqual({ type: "streaming" });
  expect((await events.next()).value).toEqual({ type: "delta", delta: "complete encrypted response" });
  expect((await events.next()).value).toEqual({ type: "response_ready", completionId: "completion-5" });
  expect((await events.next()).value).toEqual({ type: "verifying_response" });
  controller.abort();

  expect((await events.next()).value).toEqual({ type: "failed", code: "response_verification_failed" });
  expect(responseVerificationStarted).toBe(false);
});

test("private connection probe sends only its fixed protected request and reports no Conversation History work", async () => {
  const captured: Array<{ message: string; context: unknown[]; configuration: unknown }> = [];
  const statuses: string[] = [];
  const verifications: unknown[] = [];
  const failures: string[] = [];
  const transport = {
    async *generate(input: SecureInferenceInput) {
      captured.push(input);
      yield { type: "verifying_environment" as const };
      yield { type: "streaming" as const };
      yield { type: "delta" as const, delta: "private connection confirmed" };
      yield { type: "verifying_response" as const };
      yield { type: "completed" as const, verification: { status: "verified_model" as const } };
    }
  };

  const result = await runPrivateConnectionProbe({
    transport,
    target: { providerId: "nearai", modelId: "private-model" },
    profile: privateModel,
    onStatus: (status) => statuses.push(status),
    onVerification: (verification) => verifications.push(verification),
    onFailure: (reason) => { if (reason) failures.push(reason); }
  });

  expect(captured).toEqual([{
    target: { id: "nearai", kind: "nearai", model_id: "private-model", configured: true },
    message: PRIVATE_CONNECTION_PROBE,
    context: [],
    configuration: { systemPrompt: "", temperature: null, topP: null, maxTokens: null }
  }]);
  expect(statuses).toEqual(["verifying_environment", "streaming", "verifying_response"]);
  expect(failures).toEqual([]);
  expect(verifications).toEqual([{ status: "verified_model" }]);
  expect(result).toBe("verified");
});


const gatewayReceipt: SecureInferenceReceipt = {
  completionId: "response-1",
  signatureKind: "gateway",
  signingAddress: "ed25519:gateway-signer",
  signingAlgorithm: "ed25519",
  signedMessage: "request-and-response-bytes",
  signature: "gateway-proof"
};

test("Incognito Secure Inference uses Gateway receipts and never claims model TEE execution", async () => {
  let createdMode: string | undefined;
  const transport = createSecureInferenceTransport({
    create(_input, mode) {
      createdMode = mode;
      return {
        async *stream() {
          yield { completionId: "response-1", delta: "Incognito answer" };
        },
        async verifyResponse() {
          return gatewayReceipt;
        }
      };
    }
  });
  const events = [];
  for await (const event of transport.generate({
    target: { ...privateModel, model_id: "openai/gpt-4.1-mini" },
    mode: "incognito",
    configuration: { systemPrompt: "", temperature: null, topP: null, maxTokens: null },
    context: [],
    message: "What did the Gateway sign?"
  })) {
    events.push(event);
  }
  expect(createdMode).toBe("incognito");
  expect(events.at(-1)).toEqual({
    type: "completed",
    verification: {
      status: "verified_gateway",
      completionId: "response-1",
      signingKind: "gateway",
      signingAddress: "ed25519:gateway-signer",
      signingAlgorithm: "ed25519",
      signedMessage: "request-and-response-bytes",
      signature: "gateway-proof"
    }
  });
});

test("Chutes uses the Gateway Responses path and rejects a provider_tee signature as model proof", async () => {
  let createdMode: string | undefined;
  const transport = createSecureInferenceTransport({
    create(_input, mode) {
      createdMode = mode;
      return {
        async *stream() {
          yield { completionId: "response-chutes", delta: "Chutes answer" };
        },
        async verifyResponse() {
          return {
            completionId: "response-chutes",
            signatureKind: "provider_tee" as const,
            signingAddress: "ed25519:tee-signer",
            signingAlgorithm: "ed25519" as const,
            signedMessage: "request-and-response-bytes",
            signature: "model-proof"
          };
        }
      };
    }
  });
  const events = [];
  for await (const event of transport.generate({
    target: { ...privateModel, model_id: "moonshotai/kimi-k3" },
    mode: "chutes",
    configuration: { systemPrompt: "", temperature: null, topP: null, maxTokens: null },
    context: [],
    message: "Do not treat this as model TEE"
  })) {
    events.push(event);
  }
  expect(createdMode).toBe("chutes");
  expect(events.at(-1)).toEqual({ type: "failed", code: "response_verification_failed" });
  expect(JSON.stringify(events)).not.toContain("verified_model");
});

test("Incognito environment refresh verifies only the Gateway attestation", async () => {
  let capturedMode: string | undefined;
  const transport = createSecureInferenceTransport({
    create() {
      throw new Error("Incognito Verify Again must not create a Completion client");
    },
    async verifyEnvironment(_input, mode) {
      capturedMode = mode;
      return {
        gateway: {
          kind: "gateway",
          signerAddress: "gateway-signer",
          signingAlgorithm: "ed25519",
          tcbStatus: "UpToDate",
          advisoryIds: [],
          tlsBinding: "none",
          deployment: { appCompose: "fixture-compose" },
          raw: { intel_quote: "fresh-gateway-quote" }
        }
      };
    }
  });
  const refreshed = await transport.verifyEnvironment!({
    target: { ...privateModel, model_id: "openai/gpt-4.1-mini" },
    mode: "incognito"
  });
  expect(capturedMode).toBe("incognito");
  expect(refreshed.model).toBeUndefined();
  expect(refreshed.gateway.kind).toBe("gateway");
});

test("Browser Gateway Responses client posts /responses and verifies the captured Gateway signature", async () => {
  const requestBodies: Uint8Array[] = [];
  const responseBodies: Uint8Array[] = [];
  const sse = 'data: {"id":"resp-1","type":"response.output_text.delta","delta":"Hello from Gateway"}\n\ndata: [DONE]\n\n';
  const gatewayAttestation = {
    nonce: "aa".repeat(32),
    signer: { signingAlgo: "ed25519" as const, signingAddress: "gateway-signer" },
    intelQuote: "gateway-quote",
    eventLog: [],
    appCompose: "fixture-compose",
    reportedQuoteData: "bb".repeat(64)
  };
  const verifiedGateway = {
    signer: { signingAlgo: "ed25519" as const, signingAddress: "gateway-signer" },
    tcbStatus: "UpToDate" as const,
    advisoryIds: [] as string[],
    deployment: { appCompose: "fixture-compose", runtimeMeasurements: {} },
    deploymentProvenance: "not_checked" as const,
    tlsBinding: { kind: "none" as const },
    report: gatewayAttestation
  };
  const client = new BrowserGatewayResponseClient({
    baseUrl: "http://127.0.0.1/api/nearai/nearai/v1/",
    model: "openai/gpt-4.1-mini",
    messages: [{ role: "user", content: "Ping" }]
  }, {
    attestationClient: {
      async fetchGatewayAttestation() {
        return { attestation: gatewayAttestation, clientBinding: { nonce: gatewayAttestation.nonce } };
      },
      async fetchCompletionSignature() {
        return {
          kind: "gateway" as const,
          signer: { signingAlgo: "ed25519" as const, signingAddress: "gateway-signer" },
          signedText: "signed-bytes",
          signature: "gateway-sig"
        };
      }
    },
    async verifyGatewayAttestationImpl() {
      return verifiedGateway;
    },
    verifyGatewayResponseImpl({ requestBody, responseBody, signature }) {
      requestBodies.push(requestBody);
      responseBodies.push(responseBody);
      expect(signature.kind).toBe("gateway");
    },
    async fetchImpl(input, init) {
      expect(String(input)).toBe("http://127.0.0.1/api/nearai/nearai/v1/responses");
      expect(init?.method).toBe("POST");
      const payload = JSON.parse(new TextDecoder().decode(init?.body as Uint8Array));
      expect(payload).toMatchObject({
        model: "openai/gpt-4.1-mini",
        input: [{ role: "user", content: "Ping" }],
        stream: true
      });
      return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
  });

  const chunks = [];
  for await (const chunk of client.stream()) {
    chunks.push(chunk);
  }
  expect(chunks).toEqual([{ completionId: "resp-1", delta: "Hello from Gateway" }]);
  const receipt = await client.verifyResponse("resp-1");
  expect(receipt.signatureKind).toBe("gateway");
  expect(receipt.completionId).toBe("resp-1");
  expect(new TextDecoder().decode(requestBodies[0] ?? new Uint8Array())).toContain("openai/gpt-4.1-mini");
  expect(new TextDecoder().decode(responseBodies[0] ?? new Uint8Array())).toContain("Hello from Gateway");
});

test("Browser Gateway Responses client refuses a provider_tee completion signature", async () => {
  const client = new BrowserGatewayResponseClient({
    baseUrl: "http://127.0.0.1/api/nearai/nearai/v1/",
    model: "moonshotai/kimi-k3",
    messages: [{ role: "user", content: "Ping" }]
  }, {
    attestationClient: {
      async fetchGatewayAttestation() {
        return {
          attestation: {
            nonce: "aa".repeat(32),
            signer: { signingAlgo: "ed25519" as const, signingAddress: "gateway-signer" },
            intelQuote: "gateway-quote",
            eventLog: [],
            appCompose: "fixture-compose",
            reportedQuoteData: "bb".repeat(64)
          },
          clientBinding: { nonce: "aa".repeat(32) }
        };
      },
      async fetchCompletionSignature() {
        return {
          kind: "provider_tee" as const,
          signer: { signingAlgo: "ed25519" as const, signingAddress: "tee-signer" },
          signedText: "signed-bytes",
          signature: "model-sig"
        };
      }
    },
    async verifyGatewayAttestationImpl() {
      return {
        signer: { signingAlgo: "ed25519" as const, signingAddress: "gateway-signer" },
        tcbStatus: "UpToDate" as const,
        advisoryIds: [] as string[],
        deployment: { appCompose: "fixture-compose", runtimeMeasurements: {} },
        deploymentProvenance: "not_checked" as const,
        tlsBinding: { kind: "none" as const },
        report: { nonce: "aa".repeat(32), signer: { signingAlgo: "ed25519" as const, signingAddress: "gateway-signer" }, intelQuote: "gateway-quote", eventLog: [], appCompose: "fixture-compose", reportedQuoteData: "bb".repeat(64) }
      };
    },
    verifyGatewayResponseImpl() {
      throw new Error("must not verify a provider_tee signature as a Gateway response");
    },
    async fetchImpl() {
      return new Response('data: {"id":"resp-2","delta":"x"}\n\n', { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
  });
  for await (const _chunk of client.stream()) {
    // drain
  }
  await expect(client.verifyResponse("resp-2")).rejects.toThrow("non-gateway signature");
});

afterEach(() => vi.unstubAllGlobals());

const fixtureSigningAddress = "a".repeat(64);
const fixtureAppCompose = "fixture-compose";
const fixtureEventLog = [{ digest: "b".repeat(96), imr: 3 }];

async function verifiedAttestationFixture(
  nonce: string,
  quote: string,
  fixtures: Map<string, Awaited<ReturnType<typeof verifiedQuoteFixture>>>
) {
  const result = await verifiedQuoteFixture(nonce);
  fixtures.set(quote, result);
  return {
    request_nonce: nonce,
    signing_algo: "ed25519",
    signing_address: fixtureSigningAddress,
    intel_quote: quote,
    event_log: fixtureEventLog,
    info: { tcb_info: { app_compose: fixtureAppCompose } },
    report_data: toHex(result.reportData),
    signing_public_key: fixtureSigningAddress
  };
}

function invalidNonceAttestationFixture() {
  return {
    request_nonce: "0".repeat(64),
    signing_algo: "ed25519",
    signing_address: fixtureSigningAddress,
    intel_quote: "unused-fixture-quote",
    event_log: fixtureEventLog,
    info: { tcb_info: { app_compose: fixtureAppCompose } },
    report_data: "c".repeat(128)
  };
}

async function verifiedQuoteFixture(nonce: string) {
  const reportData = new Uint8Array(64);
  reportData.set(fromHex(fixtureSigningAddress));
  reportData.set(fromHex(nonce), 32);
  const mrConfigId = new Uint8Array(33);
  mrConfigId[0] = 1;
  mrConfigId.set(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fixtureAppCompose))), 1);
  const eventDigest = fromHex(fixtureEventLog[0]!.digest);
  const rtmrInput = new Uint8Array(96);
  rtmrInput.set(eventDigest, 48);
  return {
    tcbStatus: "UpToDate" as const,
    advisoryIds: [],
    debugEnabled: false,
    reportData,
    mrConfigId,
    rtMr3: new Uint8Array(await crypto.subtle.digest("SHA-384", rtmrInput))
  };
}

function fromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
