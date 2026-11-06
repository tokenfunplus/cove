import { LocalServiceError } from "@/api/client";
import { getGenerationBatch } from "@/api/generations";
import {
  type ErrorEnvelope,
  type GenerationBatch,
  type GenerationBatchEvent,
} from "@cove/api-contract";

export async function* subscribeGenerationBatch(
  id: string,
  afterEventId?: string,
): AsyncGenerator<GenerationBatchEvent> {
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

async function* openGenerationBatchEvents(
  id: string,
  afterEventId?: string,
): AsyncGenerator<GenerationBatchEvent> {
  const headers = new Headers({ Accept: "text/event-stream" });
  if (afterEventId) headers.set("Last-Event-ID", afterEventId);
  const response = await fetch(
    `/api/generation-batches/${encodeURIComponent(id)}/events`,
    { credentials: "same-origin", headers },
  );
  if (!response.ok) {
    const payload = (await response.json()) as ErrorEnvelope;
    throw new LocalServiceError(payload);
  }
  if (!response.body)
    throw new Error("Generation Batch event stream has no body");
  for await (const event of decodeSSE(response.body)) {
    yield event;
  }
}

function isTerminalGenerationBatch(batch: GenerationBatch): boolean {
  return (
    batch.state === "completed" ||
    batch.state === "completed_with_errors" ||
    batch.state === "stopped" ||
    batch.state === "failed"
  );
}

function waitForGenerationReconnect(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

async function* decodeSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<GenerationBatchEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), {
        stream: !chunk.done,
      });
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

function parseSSEFrame(frame: string): GenerationBatchEvent | undefined {
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) {
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value =
      separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "data") {
      data.push(value);
    }
  }
  if (data.length === 0) {
    return undefined;
  }
  return JSON.parse(data.join("\n")) as GenerationBatchEvent;
}
