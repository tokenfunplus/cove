import { request } from "@/api/client";
import {
  type Generation,
  type GenerationBatch,
  type GenerationContextMessage,
  type GenerationInput,
  type GenerationVerification,
} from "@cove/api-contract";

export type GenerationSelection = {
  clientRequestId: string;
  body: string;
};

export function createGenerationBatch(
  conversationId: string,
  selection: GenerationSelection,
): Promise<GenerationBatch> {
  const input: GenerationInput = {
    client_request_id: selection.clientRequestId,
    body: selection.body,
  };
  return request<GenerationBatch>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function getGenerationBatch(id: string): Promise<GenerationBatch> {
  return request<GenerationBatch>(
    `/api/generation-batches/${encodeURIComponent(id)}`,
  );
}

export function cancelGenerationBatch(id: string): Promise<GenerationBatch> {
  return request<GenerationBatch>(
    `/api/generation-batches/${encodeURIComponent(id)}/cancel`,
    { method: "POST" },
  );
}

export function retryGenerationTarget(
  id: string,
  clientRequestId: string,
): Promise<Generation> {
  return request<Generation>(
    `/api/generation-targets/${encodeURIComponent(id)}/retry`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_request_id: clientRequestId }),
    },
  );
}

export function selectGenerationAnswer(id: string): Promise<void> {
  return request<void>(`/api/generations/${encodeURIComponent(id)}/select`, {
    method: "POST",
  });
}

export function skipGenerationBatchContext(id: string): Promise<void> {
  return request<void>(
    `/api/generation-batches/${encodeURIComponent(id)}/skip-context`,
    { method: "POST" },
  );
}

export function cancelGeneration(id: string): Promise<Generation> {
  return request<Generation>(
    `/api/generations/${encodeURIComponent(id)}/cancel`,
    { method: "POST" },
  );
}

export function markSecureGenerationEnvironment(
  id: string,
): Promise<Generation> {
  return request<Generation>(
    `/api/generations/${encodeURIComponent(id)}/secure/environment`,
    { method: "POST" },
  );
}

export function markSecureGenerationStreaming(id: string): Promise<Generation> {
  return request<Generation>(
    `/api/generations/${encodeURIComponent(id)}/secure/streaming`,
    { method: "POST" },
  );
}

export function markSecureGenerationResponseVerification(
  id: string,
): Promise<Generation> {
  return request<Generation>(
    `/api/generations/${encodeURIComponent(id)}/secure/response`,
    { method: "POST" },
  );
}

export function settleSecureGeneration(
  id: string,
  body: string,
  verification: GenerationVerification,
): Promise<Generation> {
  return request<Generation>(
    `/api/generations/${encodeURIComponent(id)}/secure/settle`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, verification }),
    },
  );
}

export function getGenerationBatchContext(
  id: string,
): Promise<GenerationContextMessage[]> {
  return request<GenerationContextMessage[]>(
    `/api/generation-batches/${encodeURIComponent(id)}/context`,
  );
}
