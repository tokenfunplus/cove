import type { ProviderSnapshot } from "@cove/api-contract";
import { request } from "@/api/client";
import { runVerifiedBrowserTurn } from "./debate-browser-turn";
import type { SecureInferenceTransport } from "./secure-inference";

/** Only an explicit start triggers a chargeable request. Polling old jobs never claims work. */
export function runVerifiedAppTask(instance: string, task: string, signal: AbortSignal, loadTransport?: () => Promise<SecureInferenceTransport>) {
  const base = "/api/mini-apps/instances/" + encodeURIComponent(instance) + "/tasks/" + encodeURIComponent(task) + "/browser/";
  const claim_id = crypto.randomUUID();
  function send<T>(step: string, values: Record<string, unknown>) {
    return request<T>(base + step, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({claim_id, ...values}),
      ...(step === "settle" ? {} : { signal }),
    });
  }
  return runVerifiedBrowserTurn({
    claim: async () => {
      const {snapshot, prompt} = await send<{snapshot: ProviderSnapshot; prompt: string}>("claim", {});
      return {
        turn: {snapshot, configuration: {system_prompt:"", max_tokens:2048, temperature:null, top_p:null}},
        messages: [{role:"system", content:""}, {role:"user", content:prompt}],
      };
    },
    progress: ({phase}) => send("progress", {phase}),
    settle: ({body,verification}) => send("settle", {body,verification}),
  }, signal, loadTransport);
}
