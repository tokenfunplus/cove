import type { ProviderSnapshot } from "@cove/api-contract";
import { request } from "@/api/client";
import { runVerifiedBrowserTurn } from "./debate-browser-turn";
import type { SecureInferenceTransport } from "./secure-inference";

/** Only an explicit start triggers a chargeable request. Polling old jobs never claims work. */
export function runVerifiedAppTask(
  instance: string,
  task: string,
  signal: AbortSignal,
  loadTransport?: () => Promise<SecureInferenceTransport>,
) {
  const base =
    "/api/mini-apps/instances/" +
    encodeURIComponent(instance) +
    "/tasks/" +
    encodeURIComponent(task) +
    "/browser/";
  const claim_id = crypto.randomUUID();
  async function send<T>(step: string, values: Record<string, unknown>) {
    const body = JSON.stringify({ claim_id, ...values });
    for (let attempt = 0; ; attempt++) {
      try {
        return await request<T>(base + step, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          ...(step === "settle" ? {} : { signal }),
        });
      } catch (error) {
        const code = (error as { envelope?: { error?: { code?: string } } })
          ?.envelope?.error?.code;
        const transient =
          !code || code === "service_unavailable" || code === "mini_app_error";
        // Claims never repeat a model call. Settlements reuse their exact verified bytes.
        if (step === "claim" || !transient || attempt >= 7 || signal.aborted)
          throw error;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.min(100 * 2 ** attempt, 2000)),
        );
      }
    }
  }
  return runVerifiedBrowserTurn(
    {
      claim: async () => {
        const { snapshot, prompt, max_tokens } = await send<{
          snapshot: ProviderSnapshot;
          prompt: string;
          max_tokens?: number | null;
        }>("claim", {});
        return {
          turn: {
            snapshot,
            configuration: {
              system_prompt: "",
              max_tokens: max_tokens ?? null,
              temperature: null,
              top_p: null,
            },
          },
          messages: [
            { role: "system", content: "" },
            { role: "user", content: prompt },
          ],
        };
      },
      progress: ({ phase }) => send("progress", { phase }),
      settle: ({ body, verification }) =>
        send("settle", { body, verification }),
    },
    signal,
    loadTransport,
  );
}

// The initiating browser owns verified inference for the lifetime of its tab.
// Unmounting a form only stops observation. An explicit cancellation stops inference.
const activeTasks = new Map<string, AbortController>();
function warnBeforeClosing(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}

export async function startVerifiedAppTask(instance: string, task: string) {
  const key = instance + "/" + task;
  if (activeTasks.has(key)) return;
  const controller = new AbortController();
  activeTasks.set(key, controller);
  window.addEventListener("beforeunload", warnBeforeClosing);
  try {
    await runVerifiedAppTask(instance, task, controller.signal);
  } finally {
    activeTasks.delete(key);
    if (activeTasks.size === 0)
      window.removeEventListener("beforeunload", warnBeforeClosing);
  }
}

export function stopVerifiedAppTask(instance: string, task: string) {
  activeTasks.get(instance + "/" + task)?.abort();
}
