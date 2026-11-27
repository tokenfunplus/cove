import { fetchLocalService, request } from "@/api/client";
import type {
  DebateControls,
  ConversationView,
  DebateAction,
  DebateIntervention,
  DebateRules,
  DebateSession,
  DebateTurn,
  DebateView,
  StartDebateInput,
  DebateBrowserContext,
  DebateBrowserProgress,
  DebateBrowserResult,
} from "@cove/api-contract";

const path = (id: string) => `/api/debates/${encodeURIComponent(id)}`;
const json = (method: string, body: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const createDebate = (input: StartDebateInput) =>
  request<DebateSession>("/api/debates", json("POST", input));
export const getDebate = (id: string, before = 0, signal?: AbortSignal) =>
  request<DebateView>(`${path(id)}${before ? `?before=${before}` : ""}`, {
    signal,
  });
export const getDebateTurn = (id: string, turnId: string) =>
  request<DebateTurn>(`${path(id)}/turns/${encodeURIComponent(turnId)}`);
const browserTurnPath = (id: string, turnId: string) =>
  `${path(id)}/turns/${encodeURIComponent(turnId)}/browser`;
export const claimDebateBrowserTurn = (
  id: string,
  turnId: string,
  claimId: string,
  signal?: AbortSignal,
) =>
  request<DebateBrowserContext>(`${browserTurnPath(id, turnId)}/claim`, {
    ...json("POST", { claim_id: claimId }),
    signal,
  });
export const progressDebateBrowserTurn = (
  id: string,
  turnId: string,
  input: DebateBrowserProgress,
  signal?: AbortSignal,
) =>
  request<void>(`${browserTurnPath(id, turnId)}/progress`, {
    ...json("POST", input),
    signal,
  });
export const settleDebateBrowserTurn = (
  id: string,
  turnId: string,
  input: DebateBrowserResult,
  signal?: AbortSignal,
) =>
  request<DebateTurn>(`${browserTurnPath(id, turnId)}/settle`, {
    ...json("POST", input),
    signal,
  });
export const pauseDebateOnPageExit = (id: string) =>
  fetchLocalService(`${path(id)}/control`, {
    ...json("POST", { action: "pause" }),
    keepalive: true,
  });
export const controlDebate = (id: string, action: DebateAction) =>
  request<DebateSession>(`${path(id)}/control`, json("POST", { action }));
export const updateDebateRules = (id: string, rules: DebateRules) =>
  request<DebateSession>(`${path(id)}/rules`, json("PATCH", rules));
export const updateDebateControls = (id: string, controls: DebateControls) =>
  request<DebateSession>(`${path(id)}/controls`, json("PATCH", controls));
export const addDebateIntervention = (
  id: string,
  input: { client_request_id: string; body: string },
) =>
  request<DebateIntervention>(`${path(id)}/interventions`, json("POST", input));

export async function getDebateExport(id: string): Promise<DebateView> {
  const current = await getDebate(id);
  let page = current;
  const pages = [current.turns];
  while (page.has_more && page.turns[0]) {
    const cursor = page.turns[0].sequence;
    page = await getDebate(id, cursor);
    if (page.turns[0] && page.turns[0].sequence >= cursor)
      throw new Error("Invalid debate pagination");
    pages.unshift(page.turns);
  }
  return {
    ...current,
    turns: pages.flat().filter((turn) => turn.state !== "streaming"),
    has_more: false,
  };
}

export async function loadDebateForExport(
  view: ConversationView,
): Promise<ConversationView> {
  return view.debate_id
    ? { ...view, debate_export: await getDebateExport(view.debate_id) }
    : view;
}

/** Coalesced invalidations: every connect/reconnect reconciles authoritative state. */
export async function watchDebate(
  id: string,
  signal: AbortSignal,
  refresh: () => void,
) {
  while (!signal.aborted) {
    try {
      const response = await fetchLocalService(`${path(id)}/events`, {
        signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!response.ok || !response.body)
        throw new Error("Debate event stream unavailable");
      refresh();
      const reader = response.body.getReader();
      try {
        while (!signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          // Events carry no body data; bounded chunks only invalidate the read query.
          refresh();
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch {
      if (signal.aborted) return;
    }
    if (!signal.aborted)
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, 1500);
        signal.addEventListener("abort", done, { once: true });
      });
  }
}
