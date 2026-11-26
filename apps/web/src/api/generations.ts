import { request } from "@/api/client";
import {
  type ProjectContextPreview,
  type ProjectExpectation,
  type ProjectContextEnvelope,
  type Generation,
  type GenerationMetrics,
  type GenerationBatch,
  type GenerationContextMessage,
  type GenerationInput,
  type GenerationVerification,
  type AttachmentInput,
  type AttachmentSnapshot,
  type GenerationPromptMessage,
  type PreparedWebSource,
} from "@cove/api-contract";

export type GenerationSelection = {
  interactive?: boolean;
  interaction?: import("@cove/api-contract").CardSubmission;
  localOnly?: boolean;
  expectedProject?: ProjectExpectation;
  editOfBatchId?: string;
  clientRequestId: string;
  body: string;
  attachments?: AttachmentInput[];
  webSourceTokens?: string[];
  webSearchEnabled?: boolean;
  expectedTargets?: GenerationInput["expected_targets"];
};

export function createGenerationBatch(
  conversationId: string,
  selection: GenerationSelection,
): Promise<GenerationBatch> {
  const input: GenerationInput = {
    interactive: selection.interactive,
    interaction: selection.interaction,
    ...(selection.localOnly ? { local_only: true } : {}),
    ...(selection.editOfBatchId
      ? { edit_of_batch_id: selection.editOfBatchId }
      : {}),
    expected_project: selection.expectedProject,
    client_request_id: selection.clientRequestId,
    body: selection.body,
    attachments: selection.attachments,
    web_source_tokens: selection.webSourceTokens,
    web_search_enabled: selection.webSearchEnabled,
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
  interaction?: import("@cove/api-contract").CardSubmission;
  interactive?: boolean;
  conversationId: string;
  body: string;
  attachments?: AttachmentInput[];
  webSourceTokens?: string[];
}): Promise<GenerationPromptMessage[] | ProjectContextPreview> {
  return request(
    `/api/conversations/${encodeURIComponent(input.conversationId)}/context-preview?format=project-v1`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(input.interactive ? { interactive: true } : {}),
        ...(input.interaction ? { interaction: input.interaction } : {}),
        body: input.body,
        attachments: input.attachments,
        web_source_tokens: input.webSourceTokens,
      }),
    },
  );
}

export function prepareWebSource(
  url: string,
  signal: AbortSignal,
): Promise<PreparedWebSource> {
  return request<PreparedWebSource>("/api/web-sources/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });
}

export function releaseWebSource(token: string): Promise<void> {
  return request<void>(`/api/web-sources/${encodeURIComponent(token)}`, {
    method: "DELETE",
  });
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
  localOnly = false,
): Promise<Generation> {
  return request<Generation>(
    `/api/generation-targets/${encodeURIComponent(id)}/retry`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_request_id: clientRequestId,
        ...(localOnly ? { local_only: true } : {}),
      }),
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

export function getProjectBatchContext(
  id: string,
): Promise<ProjectContextEnvelope> {
  return request(
    `/api/generation-batches/${encodeURIComponent(id)}/context?format=project-v1`,
  );
}
