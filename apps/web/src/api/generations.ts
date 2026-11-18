import { request } from "@/api/client";
import {
  type Generation,
  type GenerationMetrics,
  type GenerationBatch,
  type GenerationContextMessage,
  type GenerationInput,
  type GenerationVerification,
  type AttachmentInput,
  type AttachmentSnapshot,
  type GenerationPromptMessage,
} from "@cove/api-contract";

export type GenerationSelection = {
  editOfBatchId?: string;
  clientRequestId: string;
  body: string;
  attachments?: AttachmentInput[];
  expectedTargets?: GenerationInput["expected_targets"];
};

export function createGenerationBatch(
  conversationId: string,
  selection: GenerationSelection,
): Promise<GenerationBatch> {
  const input: GenerationInput = {
    ...(selection.editOfBatchId ? {edit_of_batch_id:selection.editOfBatchId} : {}),
    client_request_id: selection.clientRequestId,
    body: selection.body,
    attachments: selection.attachments,
    expected_targets: selection.expectedTargets,
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

export function previewAttachment(
  input: AttachmentInput,
): Promise<AttachmentSnapshot> {
  return request<AttachmentSnapshot>("/api/attachments/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function previewGenerationContext(input: {
  conversationId: string;
  body: string;
  attachments?: AttachmentInput[];
}): Promise<GenerationPromptMessage[]> {
  return request(
    `/api/conversations/${encodeURIComponent(input.conversationId)}/context-preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: input.body,
        attachments: input.attachments,
      }),
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
  metrics?: GenerationMetrics,
  reasoning?: string,
): Promise<Generation> {
  return request<Generation>(
    `/api/generations/${encodeURIComponent(id)}/secure/settle`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, verification, metrics, reasoning }),
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
