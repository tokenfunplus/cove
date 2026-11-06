import { request } from "@/api/client";
import { type WorkspaceSettings } from "@cove/api-contract";

export function getSettings(): Promise<WorkspaceSettings> {
  return request<WorkspaceSettings>("/api/settings");
}

export function updateSettings(
  settings: WorkspaceSettings,
): Promise<WorkspaceSettings> {
  return request<WorkspaceSettings>("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}
