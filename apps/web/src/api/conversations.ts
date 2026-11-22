import { request } from "@/api/client";
import {
  type Conversation,
  type ConversationUpdateInput,
  type ConversationView,
  type ConversationWireView,
  type ConversationSearchResult,
  type ConversationSearchFilter,
} from "@cove/api-contract";

export function searchConversations(query: string, archived = false, signal?: AbortSignal, filters: ConversationSearchFilter = {}): Promise<ConversationSearchResult[]> {
  const parameters = new URLSearchParams({ q: query, archived: String(archived) });
  if (filters.projectId !== undefined) parameters.set("project_id", filters.projectId);
  if (filters.kind) parameters.set("kind", filters.kind);
  if (filters.updatedAfter) parameters.set("updated_after", filters.updatedAfter);
  return request(`/api/conversations/search?${parameters}`, { signal });
}

export function getConversations(
  options: { archived?: boolean; projectId?: string } = {},
): Promise<Conversation[]> {
  const params = new URLSearchParams(); if(options.archived)params.set("archived","true");if(options.projectId!==undefined)params.set("project_id",options.projectId);const query=params.size?`?${params}`:"";
  return request<Conversation[]>(`/api/conversations${query}`);
}

export function hydrateConversation(view: ConversationWireView): ConversationView {
  const {project_contexts: contexts, ...rest} = view;
  const hydrate = (batch: import("@cove/api-contract").GenerationBatch) => {
    if (!batch.project_context_id) return batch;
    const project = contexts?.[batch.project_context_id] ?? batch.project_context;
    if (!project) throw new Error("The saved project context is unavailable.");
    return {...batch, project_context:project};
  };
  return {...rest, generation_batches:rest.generation_batches?.map(hydrate),
    ...(rest.active_generation_batch ? {active_generation_batch:hydrate(rest.active_generation_batch)} : {})};
}
export async function getConversation(id: string): Promise<ConversationView> {
  return hydrateConversation(await request<ConversationWireView>(`/api/conversations/${encodeURIComponent(id)}`));
}

export function deleteConversation(id: string): Promise<void> {
  return request<void>(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function clearChatData(): Promise<void> {
  return request<void>("/api/data", { method: "DELETE" });
}

export function createConversation(title = "", membership?: { project_id?: string; source_conversation_id?: string }): Promise<Conversation> {
  return request<Conversation>("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, ...membership }),
  });
}

export function renameConversation(id: string, title: string): Promise<void> {
  return updateConversation(id, { title });
}

export function updateConversation(
  id: string,
  input: ConversationUpdateInput,
): Promise<void> {
  return request<void>(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
