import type { Conversation, ConversationUpdateInput, ConversationView, ErrorEnvelope, Generation, GenerationBatch, GenerationBatchEvent, GenerationEvent, GenerationInput, GenerationVerification, Message, ProviderProfile, ProviderProfileInput, ProviderValidationResponse, SessionResponse, WorkspaceSettings } from "@cove/api-contract";

let csrfToken: string | undefined;

/**
 * SDK-owned requests still pass through the Browser Session-protected Local
 * Service proxy. This exposes only the session CSRF proof; Provider keys
 * remain server-side in Keychain and never enter the Chat Surface.
 */
export function browserSessionHeaders(): Record<string, string> {
  return csrfToken ? { "X-Cove-CSRF-Token": csrfToken } : {};
}

export class LocalServiceError extends Error {
  constructor(readonly envelope: ErrorEnvelope) {
    super(envelope.error.message);
    this.name = "LocalServiceError";
  }
}

function localServiceUnavailable(message = "Local service unavailable"): LocalServiceError {
  return new LocalServiceError({
    error: {
      code: "service_unavailable",
      message,
      details: null,
      request_id: "local"
    }
  });
}

export async function getSession(): Promise<SessionResponse> {
  const session = await fetchJSON<SessionResponse>("/api/session", {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  csrfToken = session.csrf_token;
  return session;
}

export function getConversations(options: { archived?: boolean } = {}): Promise<Conversation[]> {
  const query = options.archived ? "?archived=true" : "";
  return request<Conversation[]>(`/api/conversations${query}`);
}

export function getConversation(id: string): Promise<ConversationView> {
  return request<ConversationView>(`/api/conversations/${encodeURIComponent(id)}`);
}

export function getConversationMessages(id: string): Promise<Message[]> {
  return request<Message[]>(`/api/conversations/${encodeURIComponent(id)}/messages`);
}

export function deleteConversation(id: string): Promise<void> {
  return request<void>(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function clearChatData(): Promise<void> {
  return request<void>("/api/data", { method: "DELETE" });
}

export function getSettings(): Promise<WorkspaceSettings> {
  return request<WorkspaceSettings>("/api/settings");
}

export function updateSettings(settings: WorkspaceSettings): Promise<WorkspaceSettings> {
  return request<WorkspaceSettings>("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
}

export type GenerationSelection = {
  clientRequestId: string;
  body: string;
};

export function createGenerationBatch(conversationId: string, selection: GenerationSelection): Promise<GenerationBatch> {
  const input: GenerationInput = {
    client_request_id: selection.clientRequestId,
    body: selection.body
  };
  return request<GenerationBatch>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function getGenerationBatch(id: string): Promise<GenerationBatch> {
  return request<GenerationBatch>(`/api/generation-batches/${encodeURIComponent(id)}`);
}

export function cancelGenerationBatch(id: string): Promise<GenerationBatch> {
  return request<GenerationBatch>(`/api/generation-batches/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

export function retryGenerationTarget(id: string, clientRequestId: string): Promise<Generation> {
  return request<Generation>(`/api/generation-targets/${encodeURIComponent(id)}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_request_id: clientRequestId })
  });
}

export function selectGenerationAnswer(id: string): Promise<void> {
  return request<void>(`/api/generations/${encodeURIComponent(id)}/select`, { method: "POST" });
}

export function skipGenerationBatchContext(id: string): Promise<void> {
  return request<void>(`/api/generation-batches/${encodeURIComponent(id)}/skip-context`, { method: "POST" });
}

export function getGeneration(id: string): Promise<Generation> {
  return request<Generation>(`/api/generations/${encodeURIComponent(id)}`);
}

export function cancelGeneration(id: string): Promise<Generation> {
  return request<Generation>(`/api/generations/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

export function markSecureGenerationEnvironment(id: string): Promise<Generation> {
  return request<Generation>(`/api/generations/${encodeURIComponent(id)}/secure/environment`, { method: "POST" });
}

export function markSecureGenerationStreaming(id: string): Promise<Generation> {
  return request<Generation>(`/api/generations/${encodeURIComponent(id)}/secure/streaming`, { method: "POST" });
}

export function markSecureGenerationResponseVerification(id: string): Promise<Generation> {
  return request<Generation>(`/api/generations/${encodeURIComponent(id)}/secure/response`, { method: "POST" });
}

export function settleSecureGeneration(id: string, body: string, verification: GenerationVerification): Promise<Generation> {
  return request<Generation>(`/api/generations/${encodeURIComponent(id)}/secure/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, verification })
  });
}

export function retryMessage(messageId: string, clientRequestId: string): Promise<Generation> {
  return request<Generation>(`/api/messages/${encodeURIComponent(messageId)}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_request_id: clientRequestId })
  });
}

export async function* subscribeGeneration(id: string, afterEventId?: string): AsyncGenerator<GenerationEvent> {
  let lastEventId = afterEventId;
  while (true) {
    try {
      for await (const event of openGenerationEvents(id, lastEventId)) {
        if (event.event_id) {
          lastEventId = event.event_id;
        }
        yield event;
        if (isTerminalEvent(event.type)) {
          return;
        }
      }
    } catch (error) {
      const current = await getGeneration(id).catch(() => undefined);
      if (!current) {
        throw error;
      }
      if (isTerminalGeneration(current)) {
        return;
      }
      await waitForGenerationReconnect();
      continue;
    }

    const current = await getGeneration(id);
    if (isTerminalGeneration(current)) {
      return;
    }
    await waitForGenerationReconnect();
  }
}

export async function* subscribeGenerationBatch(id: string, afterEventId?: string): AsyncGenerator<GenerationBatchEvent> {
  let lastEventId = afterEventId;
  while (true) {
    try {
      for await (const event of openGenerationBatchEvents(id, lastEventId)) {
        if (event.event_id) {
          lastEventId = event.event_id;
        }
        yield event;
      }
    } catch (error) {
      const current = await getGenerationBatch(id).catch(() => undefined);
      if (!current) throw error;
      if (isTerminalGenerationBatch(current)) return;
      await waitForGenerationReconnect();
      continue;
    }
    const current = await getGenerationBatch(id);
    if (isTerminalGenerationBatch(current)) return;
    await waitForGenerationReconnect();
  }
}

async function* openGenerationEvents(id: string, afterEventId?: string): AsyncGenerator<GenerationEvent> {
  const headers = new Headers({ Accept: "text/event-stream" });
  if (afterEventId) {
    headers.set("Last-Event-ID", afterEventId);
  }
  const response = await fetch(`/api/generations/${encodeURIComponent(id)}/events`, {
    credentials: "same-origin",
    headers
  });
  if (!response.ok) {
    const payload = await response.json() as ErrorEnvelope;
    throw new LocalServiceError(payload);
  }
  if (!response.body) {
    throw new Error("Generation event stream has no body");
  }
  yield* decodeSSE(response.body);
}

async function* openGenerationBatchEvents(id: string, afterEventId?: string): AsyncGenerator<GenerationBatchEvent> {
  const headers = new Headers({ Accept: "text/event-stream" });
  if (afterEventId) headers.set("Last-Event-ID", afterEventId);
  const response = await fetch(`/api/generation-batches/${encodeURIComponent(id)}/events`, { credentials: "same-origin", headers });
  if (!response.ok) {
    const payload = await response.json() as ErrorEnvelope;
    throw new LocalServiceError(payload);
  }
  if (!response.body) throw new Error("Generation Batch event stream has no body");
  for await (const event of decodeSSE(response.body)) {
    yield event as GenerationBatchEvent;
  }
}

function isTerminalEvent(type: GenerationEvent["type"]): boolean {
  return type === "completed" || type === "stopped" || type === "failed";
}

function isTerminalGeneration(generation: Generation): boolean {
  return generation.state === "completed" || generation.state === "stopped" || generation.state === "failed";
}

function isTerminalGenerationBatch(batch: GenerationBatch): boolean {
  return batch.state === "completed" || batch.state === "completed_with_errors" || batch.state === "stopped" || batch.state === "failed";
}

function waitForGenerationReconnect(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

export function createConversation(title = ""): Promise<Conversation> {
  return request<Conversation>("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title })
  });
}

export function renameConversation(id: string, title: string): Promise<void> {
  return updateConversation(id, { title });
}

export function updateConversation(id: string, input: ConversationUpdateInput): Promise<void> {
  return request<void>(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function getProviderProfiles(): Promise<ProviderProfile[]> {
  return request<ProviderProfile[]>("/api/models");
}

export function getProviderCatalog(id: string): Promise<ProviderValidationResponse> {
  return request<ProviderValidationResponse>(`/api/models/${encodeURIComponent(id)}/catalog`);
}

export function saveProviderProfile(input: ProviderProfileInput): Promise<ProviderProfile> {
  const path = input.id ? `/api/models/${encodeURIComponent(input.id)}` : "/api/models";
  return request<ProviderProfile>(path, {
    method: input.id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function testProviderConnection(input: ProviderProfileInput): Promise<ProviderValidationResponse> {
  return request<ProviderValidationResponse>("/api/models/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function deleteProviderProfile(id: string): Promise<void> {
  return request<void>(`/api/models/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function deleteProviderKey(id: string): Promise<void> {
  return request<void>(`/api/models/${encodeURIComponent(id)}/key`, { method: "DELETE" });
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method?.toUpperCase() ?? "GET";
  if (!isSafeMethod(method) && !csrfToken) {
    await getSession();
  }

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (!isSafeMethod(method) && csrfToken) {
    headers.set("X-Cove-CSRF-Token", csrfToken);
  }
  return fetchJSON<T>(path, { ...init, credentials: "same-origin", headers });
}

async function fetchJSON<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw localServiceUnavailable();
  }
  if (response.status === 204) {
    return undefined as T;
  }
  let payload: T | ErrorEnvelope;
  try {
    payload = (await response.json()) as T | ErrorEnvelope;
  } catch {
    if (response.ok) {
      throw localServiceUnavailable("Local service returned an invalid response");
    }
    throw new LocalServiceError({
      error: {
        code: response.status >= 500 ? "service_unavailable" : "validation",
        message: response.status >= 500 ? "Local service unavailable" : "Request failed",
        details: null,
        request_id: "local"
      }
    });
  }
  if (!response.ok) {
    throw new LocalServiceError(payload as ErrorEnvelope);
  }
  return payload as T;
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

async function* decodeSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<GenerationEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseSSEFrame(frame);
        if (event) {
          yield event;
        }
      }
      if (chunk.done) {
        if (buffer.trim() !== "") {
          const event = parseSSEFrame(buffer);
          if (event) {
            yield event;
          }
        }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSSEFrame(frame: string): GenerationEvent | undefined {
  let eventId = "";
  let eventType = "message";
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) {
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "id") {
      eventId = value;
    } else if (field === "event") {
      eventType = value;
    } else if (field === "data") {
      data.push(value);
    }
  }
  if (data.length === 0) {
    return undefined;
  }
  return JSON.parse(data.join("\n")) as GenerationEvent;
}
