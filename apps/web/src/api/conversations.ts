import { request } from "@/api/client";
import {
  type Conversation,
  type ConversationUpdateInput,
  type ConversationView,
} from "@cove/api-contract";

export function getConversations(
  options: { archived?: boolean } = {},
): Promise<Conversation[]> {
  const query = options.archived ? "?archived=true" : "";
  return request<Conversation[]>(`/api/conversations${query}`);
}

export function getConversation(id: string): Promise<ConversationView> {
  return request<ConversationView>(
    `/api/conversations/${encodeURIComponent(id)}`,
  );
}

export function deleteConversation(id: string): Promise<void> {
  return request<void>(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function clearChatData(): Promise<void> {
  return request<void>("/api/data", { method: "DELETE" });
}

export function createConversation(title = ""): Promise<Conversation> {
  return request<Conversation>("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
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
