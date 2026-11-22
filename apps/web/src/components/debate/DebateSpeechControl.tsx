import { useEffect, useRef, useState } from "react";
import { Loader2, Volume2, VolumeX } from "lucide-react";
import type { DebateTurn, DebateView } from "@cove/api-contract";
import { getDebate } from "@/api/debates";
import { useLocalSpeech } from "@/components/chat/LocalSpeech";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

// Fetch missing pages when generation gets ahead of playback or the reader
// browses older history. The speech source is always the live session cursor.
export async function pendingSpeechTurns(view: DebateView, after: number, signal: AbortSignal): Promise<DebateTurn[]> {
  const pages = [view.turns];
  let page = view;
  while (page.has_more && page.turns[0] && page.turns[0].sequence > after + 1) {
    const before = page.turns[0].sequence;
    page = await getDebate(view.session.id, before, signal);
    if (!page.turns[0] || page.turns[0].sequence >= before) {
      throw new Error("The next debate turn could not be loaded. Try enabling read aloud again.");
    }
    pages.unshift(page.turns);
  }
  return pages.flat().filter(turn => turn.sequence > after).sort((a, b) => a.sequence - b.sequence);
}

export function DebateSpeechControl({ view, stopping = false }: { view: DebateView; stopping?: boolean }) {
  const speech = useLocalSpeech();
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [queued, setQueued] = useState(0);
  const latest = useRef(view);
  const control = useRef(speech);
  latest.current = view;
  control.current = speech;
  const cursor = useRef(0);
  const skipped = useRef(new Set<string>());
  const wake = useRef<(() => void) | undefined>(undefined);
  const admission = useRef(0);
  const previousPlayback = useRef(speech?.playback);

  useEffect(() => { wake.current?.(); }, [view]);
  useEffect(() => () => { admission.current++; }, []);
  useEffect(() => {
    const previous = previousPlayback.current;
    previousPlayback.current = speech?.playback;
    // Manual reading, voice preview, settings, and the shared player's Stop
    // take ownership. They must not be replaced by the next automatic turn.
    if (enabled && (speech?.playback?.kind === "answer" || speech?.playback?.kind === "preview" || previous?.kind === "debate" && !speech?.playback)) {
      setEnabled(false);
    }
  }, [enabled, speech?.playback]);
  useEffect(() => {
    if (stopping || view.session.status === "stopped") {
      admission.current++;
      setChecking(false);
      setEnabled(false);
    }
  }, [view.session.status, stopping]);

  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const waitForTurn = () => new Promise<void>(resolve => {
      const finish = () => { wake.current = undefined; abort.signal.removeEventListener("abort", finish); resolve(); };
      wake.current = finish;
      abort.signal.addEventListener("abort", finish, { once: true });
    });
    void (async () => {
      let buffered: DebateTurn[] = [];
      let bufferedFrom: DebateView | undefined;
      try {
        while (!abort.signal.aborted) {
          const snapshot = latest.current;
          if (!buffered.length) {
            bufferedFrom = snapshot;
            buffered = await pendingSpeechTurns(snapshot, cursor.current, abort.signal);
          }
          const turns = buffered;
          if (abort.signal.aborted) return;
          const next = turns[0];
          setQueued(turns.filter(turn => turn.state === "completed" && turn.kind !== "summary" && !skipped.current.has(turn.id)).length);
          if (!next || next.state === "streaming") {
            setWaiting(true);
            buffered = [];
            if (bufferedFrom !== latest.current) continue;
            await waitForTurn();
            continue;
          }
          if (next.state !== "completed" || next.kind === "summary" || skipped.current.has(next.id)) {
            cursor.current = next.sequence;
            buffered.shift();
            continue;
          }
          setWaiting(false);
          const label = `Round ${next.round} · ${next.snapshot.model_id} · ${next.role}`;
          const result = await control.current!.readDebateTurn(view.session.id, next.id, label);
          if (abort.signal.aborted) return;
          if (result !== "finished") {
            setEnabled(false);
            setMessage(result === "failed" ? "Automatic reading stopped. Check the player or Speech settings, then enable it again." : "Automatic reading is off.");
            return;
          }
          cursor.current = next.sequence;
          buffered.shift();
        }
      } catch (error) {
        if (abort.signal.aborted) return;
        setEnabled(false);
        setMessage(error instanceof Error ? error.message : "Debate read aloud is unavailable. Try again.");
      }
    })();
    return () => {
      abort.abort();
      // Leave failure details available for inspection in the shared player.
      const current = control.current;
      if (current?.playback?.kind === "debate" && current.playback.phase !== "failed") current.stop();
    };
  }, [enabled, view.session.id]);

  async function toggle() {
    if (enabled) { setEnabled(false); setMessage(""); return; }
    if (!speech) return;
    const request = ++admission.current;
    setChecking(true);
    setMessage("");
    try {
      const ready = await speech.ensureReady();
      if (request !== admission.current || !ready) return;
      const current = latest.current;
      const streaming = current.turns.filter(turn => turn.state === "streaming");
      cursor.current = streaming.length ? Math.min(...streaming.map(turn => turn.sequence)) - 1 : Math.max(0, ...current.turns.map(turn => turn.sequence));
      skipped.current = new Set(current.turns.filter(turn => turn.state !== "streaming").map(turn => turn.id));
      previousPlayback.current = undefined;
      speech.stop();
      setEnabled(true);
    } catch (error) {
      if (request === admission.current) setMessage(error instanceof Error ? error.message : "Local speech could not be checked. Try again.");
    } finally {
      if (request === admission.current) setChecking(false);
    }
  }

  if (!speech) return null;
  const label = enabled ? "Turn off debate read aloud" : "Turn on debate read aloud";
  return <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
    <Tooltip content={enabled ? "New completed model turns play in order. Pause reading in the audio player; Debate keeps generating." : "Automatically read new model turns using your local speech settings. Earlier history stays silent."}>
      <Button size="icon-xs" variant={enabled ? "secondary" : "ghost"} aria-label={label} aria-pressed={enabled} aria-busy={checking} disabled={checking || stopping || view.session.status === "stopped"} onClick={() => void toggle()} className={enabled ? "text-primary" : ""}>
        {checking ? <Loader2 className="animate-spin" aria-hidden="true"/> : enabled ? <Volume2 aria-hidden="true"/> : <VolumeX aria-hidden="true"/>}
      </Button>
    </Tooltip>
    {enabled && <span className="text-[11px] text-muted-foreground" role="status">{waiting ? "Read aloud on · Waiting for the next turn" : `Read aloud on${queued > 1 ? ` · ${queued - 1} queued` : ""}`}</span>}
    {message && <span className="max-w-sm text-[11px] text-muted-foreground" role="status">{message}</span>}
  </div>;
}
