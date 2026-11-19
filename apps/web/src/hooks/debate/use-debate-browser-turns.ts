import { useCallback, useEffect, useRef } from "react";
import type { DebateView } from "@cove/api-contract";
import * as api from "@/api/debates";
import { runDebateBrowserTurn } from "@/lib/inference/debate-browser-turn";

export function useDebateBrowserTurns(id: string, view: DebateView | undefined, refresh: () => void) {
  const runs = useRef(new Map<string, AbortController>());
  const attempted = useRef(new Set<string>());
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const cancel = useCallback(() => { for (const controller of runs.current.values()) controller.abort(); }, []);
  useEffect(() => {
    const exit = () => {
      if (runs.current.size) {
        cancel();
        void api.pauseDebateOnPageExit(id).catch(() => undefined);
      }
    };
    window.addEventListener("pagehide", exit);
    return () => { window.removeEventListener("pagehide", exit); cancel(); };
  }, [id, cancel]);
  useEffect(() => {
    if (!view) return;
    if (view.session.status === "stopped" || view.session.status === "paused") { cancel(); return; }
    const live = new Set(view.turns.map(turn => turn.id));
    for (const turnId of attempted.current) if (!live.has(turnId) && !runs.current.has(turnId)) attempted.current.delete(turnId);
    // Defer starts so React's development effect replay cannot claim twice.
    const timer = setTimeout(() => {
      for (const turn of view.turns) {
        if (turn.execution !== "browser" || turn.state !== "streaming" || attempted.current.has(turn.id)) continue;
        attempted.current.add(turn.id);
        const controller = new AbortController();
        const claimId = crypto.randomUUID();
        runs.current.set(turn.id, controller);
        const timeout = setTimeout(() => controller.abort(), 120_000);
        void runDebateBrowserTurn({
          claim: () => api.claimDebateBrowserTurn(id, turn.id, claimId, controller.signal),
          progress: input => api.progressDebateBrowserTurn(id, turn.id, { ...input, claim_id: claimId }, controller.signal),
          settle: input => api.settleDebateBrowserTurn(id, turn.id, { ...input, claim_id: claimId }),
        }, controller.signal).catch(() => undefined).finally(() => {
          clearTimeout(timeout);
          runs.current.delete(turn.id);
          refreshRef.current();
        });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [id, view, cancel]);
  return cancel;
}
