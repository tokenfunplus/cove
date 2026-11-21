import { request } from "./client";
import type { WebSearchSettings, WebSearchPolicy, WebToolResult, ModelToolCall, ModelToolMessage, GenerationVerification } from "@cove/api-contract";

export const getWebSearchSettings = () => request<WebSearchSettings>("/api/web-search/settings");
export const saveWebSearchSettings = (policy: WebSearchPolicy, apiKey: string) => request<WebSearchSettings>("/api/web-search/settings", {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy, api_key: apiKey }),
});
export const deleteWebSearchKey = (provider: string) => request<void>(`/api/web-search/providers/${encodeURIComponent(provider)}`, { method: "DELETE" });
export async function executeWebTool(id: string, input: { call: ModelToolCall; messages: ModelToolMessage[]; verification?: GenerationVerification }, signal?: AbortSignal): Promise<WebToolResult> {
  const path = `/api/generations/${encodeURIComponent(id)}/web-search/tools`;
  let result = await request<WebToolResult>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal });
  while (result.status === "running") {
    await new Promise<void>((resolve, reject) => {
      const done = () => { signal?.removeEventListener("abort", abort); resolve(); };
      const timer = setTimeout(done, 500);
      const abort = () => { clearTimeout(timer); reject(new DOMException("Generation stopped", "AbortError")); };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
    result = await request<WebToolResult>(`${path}/${encodeURIComponent(input.call.id)}`, { signal });
  }
  return result;
}

export const testWebSearchConnection = (policy: WebSearchPolicy) => request<void>("/api/web-search/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({policy}) });
