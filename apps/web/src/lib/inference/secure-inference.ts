import { browserSessionHeaders, fetchSameOrigin } from "@/api";
import { verifyNvidiaEvidenceViaSameOriginProxy } from "@/lib/inference/nvidia-verifier";
import { secureInferenceFailureReason } from "@/lib/inference/secure-inference-errors";
import type {
  ModelTool, ModelToolMessage, ModelToolDelta,
  ProviderModelPrivacyMode,
  ProviderProfile,
} from "@cove/api-contract";
import {
  AttestationClient,
  InferenceClient,
  createTdxQuoteVerifier,
  verifyGatewayAttestation,
  verifyGatewayResponse,
  verifyModelAttestation,
  type GatewayAttestation,
  type ModelAttestation,
  type SigningAlgo,
  type VerifiedCompletionResult,
  type VerifiedGatewayAttestation,
} from "@nearai/inference-sdk";

const maxCompletionBytes = 4 * 1024 * 1024;
const maxProxyStreamBytes = 16 * 1024 * 1024;
const maxProxyEventCharacters = 1024 * 1024;

// Keep collateral requests within the verifier origin allowed by our CSP.
const verifyTdxQuote = createTdxQuoteVerifier({
  pccsUrl: "https://pccs.phala.network",
});

type SecureInferenceMessage = ModelToolMessage;

type SecureInferenceConfiguration = {
  systemPrompt: string;
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
};

export type SecureInferenceMode = ProviderModelPrivacyMode;

export type SecureInferenceInput = {
  tools?: ModelTool[];
  continuation?: ModelToolMessage[];
  target: Pick<ProviderProfile, "id" | "kind" | "model_id" | "configured">;
  mode?: SecureInferenceMode;
  configuration: SecureInferenceConfiguration;
  context: SecureInferenceMessage[];
  message: string;
};

/** Environment refresh input deliberately excludes context, prompt, and generation settings. */
type SecureInferenceEnvironmentInput = {
  target: SecureInferenceInput["target"];
  mode?: SecureInferenceMode;
};

export type SecureInferenceReceipt = {
  completionId: string;
  signatureKind: "provider_tee" | "gateway";
  signingAddress: string;
  signingAlgorithm: SigningAlgo;
  signedMessage: string;
  signature: string;
  evidence?: SecureInferenceEvidence;
  environment?: SecureInferenceEnvironment;
};

export type SecureInferenceEvidence = {
  kind: "model" | "gateway";
  signerAddress: string;
  signingAlgorithm: SigningAlgo;
  tcbStatus: string;
  advisoryIds: string[];
  gpuEvidence?: "not_provided" | "verified";
  tlsBinding?: "none" | "attested";
  deployment: {
    appCompose: string;
    osImageHash?: string;
    composeHash?: string;
  };
  raw: Record<string, unknown>;
};

type SecureInferenceEnvironment = {
  model?: SecureInferenceEvidence;
  gateway: SecureInferenceEvidence;
};

export type SecureInferenceVerification = {
  status: "verified_model" | "verified_gateway" | "unsupported";
  completionId?: string;
  signingKind?: "provider_tee" | "gateway";
  signingAddress?: string;
  signingAlgorithm?: SigningAlgo;
  signedMessage?: string;
  signature?: string;
  reason?: "provider_not_private" | "provider_unconfigured";
  evidence?: SecureInferenceEvidence;
  environment?: SecureInferenceEnvironment;
};

export type SecureInferenceEvent =
  | { type: "tool_calls"; calls: ModelToolDelta[] }
  | { type: "web_activity"; activity: string; reset?: boolean }
  | { type: "verifying_environment" }
  | { type: "streaming" }
  | { type: "delta"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "response_ready"; completionId: string }
  | { type: "verifying_response" }
  | { type: "completed"; verification: SecureInferenceVerification }
  | {
      type: "failed";
      code:
        | "environment_verification_failed"
        | "stream_failed"
        | "response_verification_failed";
      reason?: string;
    };

export type SecureInferenceVerificationEvent =
  | { type: "completed"; verification: SecureInferenceVerification }
  | { type: "failed"; code: "response_verification_failed"; reason?: string };

type SecureInferenceSdkInput = {
  tools?: ModelTool[];
  /** This is a local, session-authorized proxy URL. It never contains a Provider Key. */
  baseUrl: string;
  model: string;
  messages: SecureInferenceMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
};

type SecureInferenceStreamChunk = {
  toolCalls?: ModelToolDelta[];
  reasoningDelta?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  completionId: string;
  delta: string;
};

/**
 * The narrow browser-SDK boundary. Secure Inference Transport callers only
 * observe normalized deltas and a receipt; SDK-specific byte capture and
 * cryptographic behaviour stay behind this adapter.
 */
export interface SecureInferenceSdkClient {
  stream(signal?: AbortSignal): AsyncIterable<SecureInferenceStreamChunk>;
  verifyResponse(completionId: string): Promise<SecureInferenceReceipt>;
}

export interface SecureInferenceSdkFactory {
  create(
    input: SecureInferenceSdkInput,
    mode?: SecureInferenceMode,
  ): SecureInferenceSdkClient;
  verifyEnvironment?(
    input: SecureInferenceSdkInput,
    mode?: SecureInferenceMode,
  ): Promise<SecureInferenceEnvironment>;
}

export interface SecureInferenceTransport {
  generate(
    input: SecureInferenceInput,
    signal?: AbortSignal,
    callbacks?: {
      onVerification?: (event: SecureInferenceVerificationEvent) => void;
    },
  ): AsyncGenerator<SecureInferenceEvent>;
  verifyEnvironment?(
    input: SecureInferenceEnvironmentInput,
  ): Promise<SecureInferenceEnvironment>;
}

export function createSecureInferenceTransport(
  factory: SecureInferenceSdkFactory = browserNearAISdkFactory,
): SecureInferenceTransport {
  return {
    async verifyEnvironment(input) {
      if (input.target.kind !== "nearai") {
        throw new Error("environment verification requires a NearAI target");
      }
      if (!input.target.configured) {
        throw new Error("private Provider is not configured");
      }
      if (!factory.verifyEnvironment) {
        throw new Error("environment verification is unavailable");
      }
      return factory.verifyEnvironment(
        sdkInputForEnvironment(input),
        inferenceMode(input),
      );
    },
    async *generate(input, signal, callbacks) {
      if (input.target.kind !== "nearai") {
        yield {
          type: "completed",
          verification: {
            status: "unsupported",
            reason: "provider_not_private",
          },
        };
        return;
      }
      if (!input.target.configured) {
        yield {
          type: "completed",
          verification: {
            status: "unsupported",
            reason: "provider_unconfigured",
          },
        };
        return;
      }

      yield { type: "verifying_environment" };

      let completionId = "";
      let startedStreaming = false;
      let responseBytes = 0;
      const encoder = new TextEncoder();
      let client: SecureInferenceSdkClient;
      try {
        client = factory.create(sdkInputFor(input), inferenceMode(input));
        for await (const chunk of client.stream(signal)) {
          if (chunk.toolCalls?.length) yield { type: "tool_calls", calls: chunk.toolCalls };
          if (chunk.usage) yield { type: "usage", ...chunk.usage };
          completionId = chunk.completionId || completionId;
          if (!startedStreaming) {
            startedStreaming = true;
            yield { type: "streaming" };
          }
          if (!chunk.delta && !chunk.reasoningDelta) continue;
          responseBytes +=
            encoder.encode(chunk.delta).byteLength +
            encoder.encode(chunk.reasoningDelta ?? "").byteLength;
          if (responseBytes > maxCompletionBytes) {
            throw new Error("The Provider response exceeded the size limit.");
          }
          if (chunk.reasoningDelta)
            yield { type: "reasoning", delta: chunk.reasoningDelta };
          if (chunk.delta) yield { type: "delta", delta: chunk.delta };
        }
      } catch (error) {
        yield {
          type: "failed",
          code: completionId
            ? "stream_failed"
            : "environment_verification_failed",
          reason: secureInferenceFailureReason(error),
        };
        return;
      }

      if (signal?.aborted) {
        yield { type: "failed", code: "stream_failed" };
        return;
      }

      if (!completionId) {
        yield { type: "failed", code: "stream_failed" };
        return;
      }

      // The fully consumed SDK stream is complete, but the response remains
      // in the Live Turn until its receipt is verified against the SDK's
      // captured request/response bytes.
      yield { type: "response_ready", completionId };
      yield { type: "verifying_response" };

      if (callbacks?.onVerification) {
        // Response verification is deliberately detached from the stream
        // consumer. The callback settles the Generation only after the SDK
        // finishes checking the completed response.
        void cancelable(signal, () => client.verifyResponse(completionId)).then(
          (receipt) =>
            callbacks.onVerification?.({
              type: "completed",
              verification: verificationFor(receipt, inferenceMode(input)),
            }),
          (error) =>
            callbacks.onVerification?.({
              type: "failed",
              code: "response_verification_failed",
              reason: secureInferenceFailureReason(error),
            }),
        );
        return;
      }

      try {
        const receipt = await cancelable(signal, () =>
          client.verifyResponse(completionId),
        );
        yield {
          type: "completed",
          verification: verificationFor(receipt, inferenceMode(input)),
        };
      } catch (error) {
        yield {
          type: "failed",
          code: "response_verification_failed",
          reason: secureInferenceFailureReason(error),
        };
      }
    },
  };
}

export { secureInferenceFailureReason } from "@/lib/inference/secure-inference-errors";

function cancelable<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!signal) return operation();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cancel = () => {
      if (settled) return;
      settled = true;
      reject(
        signal.reason ??
          new DOMException("The request was cancelled.", "AbortError"),
      );
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    let inFlight: Promise<T>;
    try {
      inFlight = operation();
    } catch (error) {
      signal.removeEventListener("abort", cancel);
      settled = true;
      reject(error);
      return;
    }
    void inFlight
      .then(
        (value) => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        },
        (error: unknown) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        },
      )
      .finally(() => signal.removeEventListener("abort", cancel));
  });
}

function sdkInputFor(input: SecureInferenceInput): SecureInferenceSdkInput {
  const messages: SecureInferenceMessage[] = [];
  if (input.configuration.systemPrompt.trim() !== "") {
    messages.push({
      role: "system",
      content: input.configuration.systemPrompt,
    });
  }
  messages.push(...input.context, { role: "user", content: input.message }, ...(input.continuation ?? []));
  return {
    baseUrl: nearAIProxyBaseURL(input.target.id),
    model: input.target.model_id,
    tools: input.tools,
    messages,
    ...(input.configuration.temperature === null
      ? {}
      : { temperature: input.configuration.temperature }),
    ...(input.configuration.topP === null
      ? {}
      : { topP: input.configuration.topP }),
    ...(input.configuration.maxTokens === null
      ? {}
      : { maxTokens: input.configuration.maxTokens }),
  };
}

function sdkInputForEnvironment(
  input: SecureInferenceEnvironmentInput,
): SecureInferenceSdkInput {
  return {
    baseUrl: nearAIProxyBaseURL(input.target.id),
    model: input.target.model_id,
    messages: [],
  };
}

function nearAIProxyBaseURL(providerID: string): string {
  const path = `/api/nearai/${encodeURIComponent(providerID)}/v1/`;
  const origin =
    typeof window === "undefined" ? "http://127.0.0.1" : window.location.origin;
  return new URL(path, origin).toString();
}

function inferenceMode(input: {
  mode?: SecureInferenceMode;
}): SecureInferenceMode {
  if (
    input.mode === "incognito" ||
    input.mode === "chutes" ||
    input.mode === "private_tee"
  ) {
    return input.mode;
  }
  throw new Error("secure inference requires an explicit verification mode");
}

function verificationFor(
  receipt: SecureInferenceReceipt,
  mode: SecureInferenceMode = "private_tee",
): SecureInferenceVerification {
  if (mode !== "private_tee" && receipt.signatureKind !== "gateway") {
    throw new Error(
      "gateway response verification received a non-gateway signature",
    );
  }
  const modelVerified =
    mode === "private_tee" && receipt.signatureKind === "provider_tee";
  return {
    status: modelVerified ? "verified_model" : "verified_gateway",
    completionId: receipt.completionId,
    signingKind: receipt.signatureKind,
    signingAddress: receipt.signingAddress,
    signingAlgorithm: receipt.signingAlgorithm,
    signedMessage: receipt.signedMessage,
    signature: receipt.signature,
    evidence: receipt.evidence,
    ...(receipt.environment ? { environment: receipt.environment } : {}),
  };
}

const browserNearAISdkFactory: SecureInferenceSdkFactory = {
  create(input, mode) {
    if (mode === "incognito" || mode === "chutes")
      return new BrowserGatewayResponseClient(input);
    if (mode === "private_tee") return new BrowserNearAISdkClient(input);
    throw new Error("secure inference requires an explicit verification mode");
  },
  async verifyEnvironment(input, mode) {
    if (!mode)
      throw new Error(
        "secure inference requires an explicit verification mode",
      );
    return verifyEnvironmentWithBrowserSdk(input, mode);
  },
};

async function verifyEnvironmentWithBrowserSdk(
  input: SecureInferenceSdkInput,
  mode: SecureInferenceMode,
): Promise<SecureInferenceEnvironment> {
  const client = new BrowserAttestationClient({
    baseUrl: input.baseUrl,
    headers: browserSessionHeaders(),
  });
  const gateway = await client.fetchGatewayAttestation({
    signingAlgo: "ed25519",
  });
  const verifiedGateway = await verifyGatewayAttestation({
    attestation: gateway.attestation,
    clientBinding: gateway.clientBinding,
    verifiers: { tdxQuote: verifyTdxQuote },
  });
  if (mode !== "private_tee") {
    return {
      gateway: evidenceFor("gateway", verifiedGateway, gateway.attestation),
    };
  }
  const models = await client.fetchModelAttestations({
    model: input.model,
    signingAlgo: "ed25519",
  });
  if (models.attestations.length === 0)
    throw new Error("no model attestation was returned");
  const verifiedModels = await Promise.all(
    models.attestations.map((attestation) =>
      verifyModelAttestation({
        attestation,
        clientBinding: models.clientBinding,
        verifiers: {
          tdxQuote: verifyTdxQuote,
          gpuEvidence: verifyNvidiaEvidenceViaSameOriginProxy,
        },
      }),
    ),
  );
  const verifiedModel = verifiedModels.find(
    (candidate) => candidate.signingPublicKey !== undefined,
  );
  if (!verifiedModel)
    throw new Error("no E2EE-capable model attestation was returned");
  const rawModel = models.attestations[verifiedModels.indexOf(verifiedModel)];
  return {
    model: evidenceFor("model", verifiedModel, rawModel),
    gateway: evidenceFor("gateway", verifiedGateway, gateway.attestation),
  };
}

/** Preserve the provider's actionable error body; the SDK otherwise keeps only HTTP status. */
class BrowserAttestationClient extends AttestationClient {
  protected override async requestGatewayAttestation(request: Request) {
    return { response: await fetchSameOrigin(request) };
  }

  protected override async requestCloudApi(
    request: Request,
  ): Promise<Response> {
    const response = await fetchSameOrigin(request);
    if (!response.ok && request.url.includes("model=")) {
      const body = (await response
        .clone()
        .json()
        .catch(() => undefined)) as
        | { error?: { message?: unknown } }
        | undefined;
      if (
        typeof body?.error?.message === "string" &&
        body.error.message.trim() !== ""
      ) {
        throw new Error(body.error.message);
      }
    }
    return response;
  }
}

class LocalProxyInferenceClient extends InferenceClient {
  private readonly localAttestation: BrowserAttestationClient;

  constructor(options: ConstructorParameters<typeof InferenceClient>[0]) {
    super(options);
    this.localAttestation = new BrowserAttestationClient(options);
  }

  protected override fetchGatewayAttestation() {
    return this.localAttestation.fetchGatewayAttestation({
      signingAlgo: this.signingAlgo,
      includeSpkiFingerprint: false,
    });
  }

  protected override createGatewayFetch(): typeof fetch {
    return fetchSameOrigin;
  }
}

type BrowserInferenceClient = Pick<InferenceClient, "chat" | "verifyResponse"> &
  Partial<Pick<InferenceClient, "clearResponseCache">>;

type BrowserNearAISdkDependencies = {
  client?: BrowserInferenceClient;
};

export class BrowserNearAISdkClient implements SecureInferenceSdkClient {
  private readonly client: BrowserInferenceClient;
  private readonly input: SecureInferenceSdkInput;

  constructor(
    input: SecureInferenceSdkInput,
    dependencies: BrowserNearAISdkDependencies = {},
  ) {
    this.input = input;
    this.client =
      dependencies.client ??
      new LocalProxyInferenceClient({
        baseUrl: input.baseUrl,
        // The Local Service injects its Keychain-held Provider Key upstream.
        // Supplying headers rather than an apiKey prevents the key entering JS.
        headers: browserSessionHeaders(),
        e2ee: true,
        signingAlgo: "ed25519",
        gatewayVerification: { verifiers: { tdxQuote: verifyTdxQuote } },
        modelVerification: {
          verifiers: {
            tdxQuote: verifyTdxQuote,
            gpuEvidence: verifyNvidiaEvidenceViaSameOriginProxy,
          },
        },
      });
  }

  async *stream(
    signal?: AbortSignal,
  ): AsyncGenerator<SecureInferenceStreamChunk> {
    let completed = false;
    try {
      const completion = await this.client.chat.completions.create(
        {
          model: this.input.model,
          messages: this.input.messages.map(message => message.role === "tool" ? {role: "tool" as const, tool_call_id: message.tool_call_id ?? "", content: message.content} : message.role === "assistant" ? {role: "assistant" as const, content: message.content, ...(message.tool_calls?.length ? {tool_calls: message.tool_calls} : {}), ...(message.reasoning_content ? {reasoning_content: message.reasoning_content} : {})} : {role: message.role, content: message.content}),
          ...(this.input.tools?.length ? { tools: this.input.tools } : {}),
          stream: true,
          ...(this.input.temperature === undefined
            ? {}
            : { temperature: this.input.temperature }),
          ...(this.input.topP === undefined ? {} : { top_p: this.input.topP }),
          ...(this.input.maxTokens === undefined
            ? {}
            : { max_tokens: this.input.maxTokens }),
        },
        { signal },
      );
      for await (const chunk of completion) {
        const normalized = streamChunkFor(chunk);
        if (normalized) yield normalized;
      }
      completed = true;
    } finally {
      if (!completed) this.client.clearResponseCache?.();
    }
  }

  async verifyResponse(completionId: string): Promise<SecureInferenceReceipt> {
    try {
      return receiptFor(await this.client.verifyResponse(completionId));
    } finally {
      // Each adapter owns one Generation; retained SDK bytes are no longer
      // needed after its receipt settles, including a verification failure.
      this.client.clearResponseCache?.();
    }
  }
}

type BrowserGatewayResponseDependencies = {
  attestationClient?: Pick<
    AttestationClient,
    "fetchGatewayAttestation" | "fetchCompletionSignature"
  >;
  fetchImpl?: typeof fetch;
  verifyGatewayAttestationImpl?: typeof verifyGatewayAttestation;
  verifyGatewayResponseImpl?: (params: {
    requestBody: Uint8Array;
    responseBody: Uint8Array;
    signature: {
      kind: "provider_tee" | "gateway";
      signer: { signingAddress: string; signingAlgo: SigningAlgo };
      signedText: string;
      signature: string;
    };
    attestation: VerifiedGatewayAttestation;
  }) => void;
};

export class BrowserGatewayResponseClient implements SecureInferenceSdkClient {
  private readonly input: SecureInferenceSdkInput;
  private readonly dependencies: BrowserGatewayResponseDependencies;
  private requestBody = new Uint8Array();
  private responseChunks: Uint8Array[] = [];
  private gateway?: VerifiedGatewayAttestation;
  private gatewayEvidence?: SecureInferenceEvidence;

  constructor(
    input: SecureInferenceSdkInput,
    dependencies: BrowserGatewayResponseDependencies = {},
  ) {
    this.input = input;
    this.dependencies = dependencies;
  }

  private attestationClient(): Pick<
    AttestationClient,
    "fetchGatewayAttestation" | "fetchCompletionSignature"
  > {
    return (
      this.dependencies.attestationClient ??
      new BrowserAttestationClient({
        baseUrl: this.input.baseUrl,
        headers: browserSessionHeaders(),
      })
    );
  }

  async *stream(
    signal?: AbortSignal,
  ): AsyncGenerator<SecureInferenceStreamChunk> {
    const client = this.attestationClient();
    const fetchedGateway = await client.fetchGatewayAttestation({
      signingAlgo: "ed25519",
    });
    const verifyGateway =
      this.dependencies.verifyGatewayAttestationImpl ??
      verifyGatewayAttestation;
    this.gateway = await verifyGateway({
      attestation: fetchedGateway.attestation,
      clientBinding: fetchedGateway.clientBinding,
      verifiers: { tdxQuote: verifyTdxQuote },
    });
    this.gatewayEvidence = evidenceFor(
      "gateway",
      this.gateway,
      fetchedGateway.attestation,
    );
    const payload: Record<string, unknown> = {
      model: this.input.model,
      input: responseInputFor(this.input.messages),
      stream: true,
    };
    if (this.input.tools?.length) payload.tools = this.input.tools.map(tool => ({type: "function", ...tool.function}));
    if (this.input.temperature !== undefined)
      payload.temperature = this.input.temperature;
    if (this.input.topP !== undefined) payload.top_p = this.input.topP;
    if (this.input.maxTokens !== undefined)
      payload.max_output_tokens = this.input.maxTokens;
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    this.requestBody = encoded;
    const headers = new Headers(browserSessionHeaders());
    headers.set("Accept", "text/event-stream");
    headers.set("Content-Type", "application/json");
    const fetchImpl = this.dependencies.fetchImpl ?? fetchSameOrigin;
    const response = await fetchImpl(new URL("responses", this.input.baseUrl), {
      method: "POST",
      headers,
      body: encoded,
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error(
        `Provider error: responses request failed with ${response.status}`,
      );
    }
    if (!response.body) throw new Error("responses stream is empty");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let responseBytes = 0;
    let completionId = "";
    const toolIds = new Set<string>();
    let consumed = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          responseBytes += value.byteLength;
          if (responseBytes > maxProxyStreamBytes) {
            throw new Error("The Provider stream exceeded the size limit.");
          }
          this.responseChunks.push(value);
          buffer += decoder.decode(value, { stream: !done });
        }
        if (done) {
          buffer += decoder.decode();
        }
        const parsed = consumeSse(buffer + (done ? "\n\n" : ""));
        buffer = parsed.rest;
        for (const event of parsed.events) {
          const failure = responseFailureFor(event);
          if (failure) throw new Error(failure);
          const chunk = responseChunkFor(event, toolIds);
          if (!chunk) continue;
          if (chunk.completionId) completionId = chunk.completionId;
          yield {
            completionId: completionId || chunk.completionId,
            delta: chunk.delta,
            reasoningDelta: chunk.reasoningDelta,
            usage: chunk.usage,
            toolCalls: chunk.toolCalls,
          };
        }
        if (done) {
          consumed = true;
          break;
        }
      }
    } finally {
      if (!consumed) {
        this.responseChunks = [];
        await reader.cancel().catch(() => undefined);
      }
      reader.releaseLock();
    }
  }

  async verifyResponse(completionId: string): Promise<SecureInferenceReceipt> {
    if (!this.gateway || !this.gatewayEvidence)
      throw new Error("gateway attestation is missing");
    const client = this.attestationClient();
    const signature = await client.fetchCompletionSignature({
      completionId,
      signingAlgo: "ed25519",
    });
    if (signature.kind !== "gateway") {
      throw new Error(
        "gateway response verification received a non-gateway signature",
      );
    }
    const verifyResponse =
      this.dependencies.verifyGatewayResponseImpl ?? verifyGatewayResponse;
    verifyResponse({
      requestBody: this.requestBody,
      responseBody: concatBytes(this.responseChunks),
      signature,
      attestation: this.gateway,
    });
    return {
      completionId,
      signatureKind: "gateway",
      signingAddress: signature.signer.signingAddress,
      signingAlgorithm: signature.signer.signingAlgo,
      signedMessage: signature.signedText,
      signature: signature.signature,
      evidence: this.gatewayEvidence,
      environment: { gateway: this.gatewayEvidence },
    };
  }
}

function consumeSse(buffer: string): { events: unknown[]; rest: string } {
  const events: unknown[] = [];
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  if (rest.length > maxProxyEventCharacters) {
    throw new Error("The Provider event exceeded the size limit.");
  }
  for (const part of parts) {
    if (part.length > maxProxyEventCharacters) {
      throw new Error("The Provider event exceeded the size limit.");
    }
    const data = part
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      continue;
    }
  }
  return { events, rest };
}

function responseFailureFor(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const event = value as {
    type?: unknown;
    error?: { code?: unknown };
    response?: { status?: unknown; error?: { code?: unknown } };
  };
  if (
    event.type !== "response.failed" &&
    event.type !== "response.incomplete" &&
    event.type !== "error" &&
    !event.error &&
    event.response?.status !== "failed" &&
    event.response?.status !== "incomplete"
  )
    return undefined;
  const code = event.response?.error?.code ?? event.error?.code;
  // Provider error messages can echo submitted content. Persist a bounded
  // classification instead of an arbitrary upstream message or payload.
  if (code === "server_error")
    return "Provider error: The upstream model service failed to generate a response (server_error). Try again later or select another model.";
  if (code === "rate_limit_exceeded")
    return "Provider error: The upstream model service reached its rate limit (rate_limit_exceeded). Try again later.";
  if (code === "model_not_found")
    return "Provider error: The upstream model is unavailable (model_not_found). Select another model.";
  if (
    event.type === "response.incomplete" ||
    event.response?.status === "incomplete"
  )
    return "Provider error: The upstream model returned an incomplete response.";
  return "Provider error: The upstream model failed to generate a response.";
}

function responseChunkFor(
  value: unknown,
  toolIds: Set<string> = new Set(),
): SecureInferenceStreamChunk | undefined {
  if (!value || typeof value !== "object") return undefined;
  const event = value as {
    id?: unknown;
    response?: { id?: unknown; output?: Array<{ type: string; call_id?: string; name?: string; arguments?: string }> };
    item?: { type: string; call_id?: string; name?: string; arguments?: string };
    type?: unknown;
    delta?: unknown;
    choices?: Array<{
      delta?: {
        content?: unknown;
        tool_calls?: ModelToolDelta[];
        reasoning_content?: unknown;
        reasoning?: unknown;
      };
    }>;
  };
  const completionId =
    typeof event.id === "string" && event.id !== ""
      ? event.id
      : typeof event.response?.id === "string"
        ? event.response.id
        : "";
  const items = event.type === "response.output_item.done" && event.item ? [event.item] : event.type === "response.completed" ? event.response?.output ?? [] : [];
  const toolCalls: ModelToolDelta[] = [];
  for (const item of items) {
    if (item.type !== "function_call" || !item.call_id || toolIds.has(item.call_id)) continue;
    const index = toolIds.size;
    toolIds.add(item.call_id);
    toolCalls.push({ index, id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } });
  }
  if (toolCalls.length) return { completionId, delta: "", toolCalls, usage: tokenUsageFor(value) };
  if (
    (event.type === "response.reasoning_text.delta" ||
      event.type === "response.reasoning_summary_text.delta") &&
    typeof event.delta === "string"
  )
    return {
      completionId,
      delta: "",
      reasoningDelta: event.delta,
      usage: tokenUsageFor(value),
    };
  if (
    (event.type === undefined ||
      event.type === "delta" ||
      event.type === "response.output_text.delta" ||
      event.type === "response.refusal.delta") &&
    typeof event.delta === "string"
  )
    return { completionId, delta: event.delta, usage: tokenUsageFor(value) };
  const chatDelta = event.choices?.[0]?.delta;
  if (chatDelta)
    return {
      completionId,
      delta: typeof chatDelta.content === "string" ? chatDelta.content : "",
      reasoningDelta: chatReasoningFor(chatDelta),
      toolCalls: chatDelta.tool_calls,
      usage: tokenUsageFor(value),
    };
  return completionId || tokenUsageFor(value)
    ? { completionId, delta: "", usage: tokenUsageFor(value) }
    : undefined;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function streamChunkFor(
  value: unknown,
): SecureInferenceStreamChunk | undefined {
  if (!value || typeof value !== "object") return undefined;
  const chunk = value as {
    id?: unknown;
    choices?: Array<{
      delta?: {
        content?: unknown;
        tool_calls?: ModelToolDelta[];
        reasoning_content?: unknown;
        reasoning?: unknown;
      };
    }>;
  };
  if (typeof chunk.id !== "string" || chunk.id === "") return undefined;
  const delta = chunk.choices?.[0]?.delta?.content;
  return {
    completionId: chunk.id,
    delta: typeof delta === "string" ? delta : "",
    reasoningDelta: chatReasoningFor(chunk.choices?.[0]?.delta),
    toolCalls: chunk.choices?.[0]?.delta?.tool_calls,
    usage: tokenUsageFor(value),
  };
}

function chatReasoningFor(
  delta: { reasoning_content?: unknown; reasoning?: unknown } | undefined,
): string | undefined {
  if (typeof delta?.reasoning_content === "string" && delta.reasoning_content)
    return delta.reasoning_content;
  return typeof delta?.reasoning === "string" ? delta.reasoning : undefined;
}

function receiptFor(
  receipt: VerifiedCompletionResult,
  environment?: SecureInferenceEnvironment,
): SecureInferenceReceipt {
  const evidence = receipt.attestation;
  const evidenceKind =
    receipt.signatureKind === "provider_tee" ? "model" : "gateway";
  const environmentEvidence = environment?.[evidenceKind];
  return {
    completionId: receipt.id,
    signatureKind: receipt.signatureKind,
    signingAddress: receipt.signature.signer.signingAddress,
    signingAlgorithm: receipt.signature.signer.signingAlgo,
    signedMessage: receipt.signature.signedText,
    signature: receipt.signature.signature,
    evidence: {
      kind: evidenceKind,
      signerAddress: evidence.signer.signingAddress,
      signingAlgorithm: evidence.signer.signingAlgo,
      tcbStatus: evidence.tcbStatus,
      advisoryIds: [...evidence.advisoryIds],
      ...(receipt.signatureKind === "provider_tee"
        ? {
            gpuEvidence:
              "gpuEvidence" in evidence ? evidence.gpuEvidence : undefined,
          }
        : {
            tlsBinding:
              "tlsBinding" in evidence ? evidence.tlsBinding.kind : undefined,
          }),
      deployment: {
        appCompose: evidence.deployment.appCompose,
        ...(evidence.deployment.runtimeMeasurements.osImageHash
          ? { osImageHash: evidence.deployment.runtimeMeasurements.osImageHash }
          : {}),
        ...(evidence.deployment.runtimeMeasurements.composeHash
          ? { composeHash: evidence.deployment.runtimeMeasurements.composeHash }
          : {}),
      },
      raw: {
        ...rawEvidenceFor(evidence),
        ...rawEvidenceForRaw(evidence.report),
        ...(environmentEvidence?.raw ?? {}),
        ...(environment
          ? {
              environment: {
                model: environment.model?.raw,
                gateway: environment.gateway.raw,
              },
            }
          : {}),
      },
    },
    ...(environment ? { environment } : {}),
  };
}

function evidenceFor(
  kind: "model" | "gateway",
  verified: {
    signer: { signingAddress: string; signingAlgo: SigningAlgo };
    tcbStatus: string;
    advisoryIds: readonly string[];
    deployment: {
      appCompose: string;
      runtimeMeasurements: { osImageHash?: string; composeHash?: string };
    };
    gpuEvidence?: "not_provided" | "verified";
    tlsBinding?: { kind: "none" | "attested" };
  },
  raw: ModelAttestation | GatewayAttestation,
): SecureInferenceEvidence {
  return {
    kind,
    signerAddress: verified.signer.signingAddress,
    signingAlgorithm: verified.signer.signingAlgo,
    tcbStatus: verified.tcbStatus,
    advisoryIds: [...verified.advisoryIds],
    ...(verified.gpuEvidence ? { gpuEvidence: verified.gpuEvidence } : {}),
    ...(verified.tlsBinding ? { tlsBinding: verified.tlsBinding.kind } : {}),
    deployment: {
      appCompose: verified.deployment.appCompose,
      ...(verified.deployment.runtimeMeasurements.osImageHash
        ? { osImageHash: verified.deployment.runtimeMeasurements.osImageHash }
        : {}),
      ...(verified.deployment.runtimeMeasurements.composeHash
        ? { composeHash: verified.deployment.runtimeMeasurements.composeHash }
        : {}),
    },
    raw: rawEvidenceForRaw(raw),
  };
}

function rawEvidenceForRaw(
  raw: ModelAttestation | GatewayAttestation,
): Record<string, unknown> {
  return {
    nonce: raw.nonce,
    signer: raw.signer,
    intel_quote: raw.intelQuote,
    event_log: raw.eventLog,
    app_compose: raw.appCompose,
    ...(raw.reportedQuoteData
      ? { reported_quote_data: raw.reportedQuoteData }
      : {}),
    ...("signingPublicKey" in raw && raw.signingPublicKey
      ? { signing_public_key: raw.signingPublicKey }
      : {}),
    ...("nvidiaPayload" in raw && raw.nvidiaPayload
      ? { nvidia_payload: raw.nvidiaPayload }
      : {}),
    ...("spkiFingerprint" in raw && raw.spkiFingerprint
      ? { spki_fingerprint: raw.spkiFingerprint }
      : {}),
  };
}

function rawEvidenceFor(evidence: {
  signer: { signingAddress: string; signingAlgo: string };
  tcbStatus: string;
  advisoryIds: readonly string[];
  deployment: {
    appCompose: string;
    runtimeMeasurements: { osImageHash?: string; composeHash?: string };
  };
  gpuEvidence?: string;
  tlsBinding?: unknown;
}): Record<string, unknown> {
  return {
    signer: evidence.signer,
    tcb_status: evidence.tcbStatus,
    advisory_ids: [...evidence.advisoryIds],
    deployment: evidence.deployment,
    ...(evidence.gpuEvidence ? { gpu_evidence: evidence.gpuEvidence } : {}),
    ...(evidence.tlsBinding ? { tls_binding: evidence.tlsBinding } : {}),
  };
}

function tokenUsageFor(value: unknown): SecureInferenceStreamChunk["usage"] {
  type Usage = { prompt_tokens?: unknown; completion_tokens?: unknown; input_tokens?: unknown; output_tokens?: unknown };
  const event = value as { usage?: Usage; response?: { usage?: Usage } };
  const usage = event?.response?.usage ?? event?.usage;
  if (!usage) return undefined;
  const count = (value: unknown) =>
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 1_000_000_000
      ? value
      : undefined;
  const inputTokens = count(usage.input_tokens ?? usage.prompt_tokens),
    outputTokens = count(usage.output_tokens ?? usage.completion_tokens);
  return inputTokens !== undefined || outputTokens !== undefined
    ? { inputTokens, outputTokens }
    : undefined;
}

function responseInputFor(messages: ModelToolMessage[]): unknown[] {
  return messages.flatMap((message): unknown[] => {
    if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
    const result: unknown[] = [];
    if (message.content || !message.tool_calls?.length) result.push({ role: message.role, content: message.content });
    for (const call of message.tool_calls ?? []) result.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    return result;
  });
}
