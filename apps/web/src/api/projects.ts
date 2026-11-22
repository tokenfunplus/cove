import { hydrateConversation } from "./conversations";
import { request } from "./client";
import type {
  AttachmentInput,
  ConversationView,
  ConversationWireView,
  Project,
} from "@cove/api-contract";
export const projectKeys = ["projects"] as const;
export function getProjects(): Promise<Project[]> {
  return request("/api/projects");
}
export function getProject(id: string): Promise<Project> {
  return request(`/api/projects/${encodeURIComponent(id)}`);
}
export function saveProject(
  input: Pick<
    Project,
    "name" | "description" | "instructions" | "background"
  > & { id?: string; revision?: number },
): Promise<Project> {
  const { id, ...body } = input;
  return request(`/api/projects${id ? `/${encodeURIComponent(id)}` : ""}`, {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
export function addProjectSource(
  id: string,
  revision: number,
  input: { file?: AttachmentInput; web_source_token?: string },
): Promise<Project> {
  return request(`/api/projects/${encodeURIComponent(id)}/sources`, {
    method: "POST",
    body: JSON.stringify({ revision, ...input }),
    headers: { "Content-Type": "application/json" },
  });
}
export function removeProjectSource(
  id: string,
  source: string,
  revision: number,
): Promise<Project> {
  return request(
    `/api/projects/${encodeURIComponent(id)}/sources/${encodeURIComponent(source)}/remove`,
    {
      method: "POST",
      body: JSON.stringify({ revision }),
      headers: { "Content-Type": "application/json" },
    },
  );
}
export function deleteProject(
  id: string,
  revision: number,
  deleteConversations: boolean,
): Promise<void> {
  return request(`/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: JSON.stringify({
      revision,
      delete_conversations: deleteConversations,
    }),
    headers: { "Content-Type": "application/json" },
  });
}
export function moveProjectConversation(
  id: string,
  project: string,
  revision: number,
): Promise<ConversationView> {
  return request<ConversationWireView>(
    `/api/conversations/${encodeURIComponent(id)}/project`,
    {
      method: "POST",
      body: JSON.stringify({
        project_id: project,
        membership_revision: revision,
      }),
      headers: { "Content-Type": "application/json" },
    },
  ).then(hydrateConversation);
}
