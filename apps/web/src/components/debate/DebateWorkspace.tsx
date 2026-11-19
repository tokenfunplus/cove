import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDebate } from "@/api/hooks/useDebates";
import { getDebateExport, getDebateTurn } from "@/api/debates";
import type { DebateControls, DebateRules, DebateTurn } from "@cove/api-contract";
import { DebateControlsFields, DebateUsageStrip, debateControls, debateControlsError } from "./DebateControlsFields";
import { DebateSummaryCard } from "./DebateSummaryCard";
import { debateMarkdown } from "@/lib/debate-export";
import { summarize } from "@/lib/chat/timeline";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogTitle,
} from "@/components/ui/dialog";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { ProviderSnapshotView } from "@/components/chat/ProviderSnapshotView";
import { GenerationMetrics } from "@/components/chat/GenerationMetrics";
import { VerificationDetailsButton } from "@/components/verification/VerificationDetailsButton";
import { DebateRulesFields } from "@/components/debate/DebateSetupDialog";
import { debateCopy as copy } from "@/messages/debate";
import { englishConversationCopy } from "@/messages";
import { debateStyles as styles } from "@/styles/debate";
import { cn } from "@/lib/utils";
import { ModelBrandIcon } from "@/components/providers/ModelBrandIcon";
import {
  ArrowUp,
  Download,
  MessagesSquare,
  Pause,
  Play,
  Settings2,
  Square,
  StepForward,
  X,
} from "lucide-react";

function phase(round: number) {
  return round === 1
    ? "Independent opening"
    : ["Cross-examination", "Evidence check", "New angles"][(round - 2) % 3];
}

export function DebateWorkspace({
  id,
  focusMode = false,
  newDebateDisabled = false,
  onNewDebate,
}: {
  id: string;
  focusMode?: boolean;
  newDebateDisabled?: boolean;
  onNewDebate: () => void;
}) {
  const [before, setBefore] = useState(0);
  const debate = useDebate(id, before);
  const [draft, setDraft] = useState("");
  const [interventionId, setInterventionId] = useState(() =>
    crypto.randomUUID(),
  );
  const [rulesOpen, setRulesOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [editedControls, setEditedControls] = useState<DebateControls>();
  const [editedRules, setEditedRules] = useState<DebateRules>();
  const [inspected, setInspected] = useState<DebateTurn>();
  const [briefOpen, setBriefOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const interventionInput = useRef<HTMLTextAreaElement>(null);
  const readingAnchor = useRef<{ id: string; offset: number } | undefined>(undefined);
  const follow = useRef(true);
  const inspectionRequest = useRef(0);
  const view = debate.data;
  useLayoutEffect(() => {
    const input = interventionInput.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight + 2}px`;
    };
    resize();
    let width: number | undefined;
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver((entries) => {
      const entry = entries.find((entry) => entry.target === input);
      if (!entry || entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer?.observe(input);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      input.style.removeProperty("height");
    };
  }, [draft, focusMode, view?.session.id]);
  useLayoutEffect(() => {
    const element = transcript.current;
    const anchor = readingAnchor.current;
    if (!element || follow.current || !anchor) return;
    const turn = [...element.querySelectorAll<HTMLElement>("article")].find(turn => turn.id === anchor.id);
    if (turn) element.scrollTop += turn.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset;
  }, [focusMode]);
  useEffect(() => {
    if (!before && follow.current)
      end.current?.scrollIntoView?.({ block: "end" });
  }, [view?.turns, before, focusMode]);
  if (!view)
    return (
      <section
        className="flex min-h-0 flex-1 items-center justify-center p-8"
        aria-label={copy.title}
      >
        {debate.isError ? (
          <div role="alert" className={styles.error}>
            <p>Debate history is unavailable.</p>
            <Button onClick={() => void debate.refetch()}>Try again</Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading debate…</p>
        )}
      </section>
    );
  const { session } = view;
  const interventionHint = session.status === "stopped"
    ? "Completed turns remain saved. Start a new debate to continue."
    : "Your input joins at the next round boundary for every model.";
  const pending = view.interventions.filter((note) => !note.applied_round);
  const busy = debate.control.isPending;
  const error =
    debate.control.error ?? debate.rules.error ?? debate.intervention.error ?? (!controlsOpen ? debate.controls.error : undefined);
  function addIntervention() {
    if (!draft.trim() || debate.intervention.isPending) return;
    debate.intervention.mutate(
      { client_request_id: interventionId, body: draft.trim() },
      {
        onSuccess: () => {
          setDraft("");
          setInterventionId(crypto.randomUUID());
        },
      },
    );
  }
  function challenge(turn: DebateTurn) {
    if (debate.intervention.isPending) return;
    setDraft(
      `Regarding turn ${turn.sequence} (${turn.snapshot.model_id}): "${turn.body.slice(0, 300)}"\nMy challenge: `,
    );
    document
      .querySelector<HTMLTextAreaElement>("#debate-intervention")
      ?.focus();
  }
  function openControls() {
    debate.controls.reset();
    setEditedControls(debateControls(session.seats.length, session.controls));
    setControlsOpen(true);
  }
  function inspectTurn(turnId: string) {
    const request = ++inspectionRequest.current;
    const turn = view!.turns.find(turn => turn.id === turnId);
    setInspected(turn);
    if (!turn || turn.execution === "browser" && turn.state !== "streaming") {
      void getDebateTurn(id, turnId).then(full => {
        if (inspectionRequest.current === request) setInspected(full);
      }).catch(() => {
        if (inspectionRequest.current === request) setExportError("The original turn could not be loaded. Try again.");
      });
    }
  }
  async function exportTranscript() {
    setExporting(true);
    setExportError("");
    try {
      const text = debateMarkdown(await getDebateExport(id));
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/markdown;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "cove-debate.md";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError("The transcript could not be exported. Try again.");
    } finally {
      setExporting(false);
    }
  }
  const brief = (
    <>
      {session.summary && <DebateSummaryCard summary={session.summary} onInspect={inspectTurn} />}
      <section className={styles.section}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{copy.liveBrief}</h2>
          <span className="text-xs text-muted-foreground">Not a verdict</span>
        </div>
        <div className="grid grid-cols-3 gap-2 border-y border-border py-2">
          <div>
            <strong className="block text-lg font-semibold">
              {session.round}
            </strong>
            <span className={styles.hint}>Round</span>
          </div>
          <div>
            <strong className="block text-lg font-semibold">
              {session.total_turns}
            </strong>
            <span className={styles.hint}>Completed</span>
          </div>
          <div>
            <strong className="block text-lg font-semibold">
              {session.seats.length}
            </strong>
            <span className={styles.hint}>Models</span>
          </div>
        </div>
        <p className={styles.hint}>{copy.checkpoints}</p>
      </section>
      <section className={styles.section}>
        <h3 className="text-sm font-semibold">At the table</h3>
        {session.seats.map((seat, index) => (
          <div
            className="flex items-center gap-2"
            key={`${seat.provider_id}:${seat.model_id}`}
          >
            <ModelBrandIcon modelId={seat.model_id} className="size-5" />
            <div className="min-w-0">
              <strong className="block truncate text-xs font-medium" title={seat.model_id}>
                {seat.model_id}
              </strong>
              <span className={styles.hint}>
                {seat.role}
                {view.turns.some(
                  (turn) => turn.state === "streaming" && turn.seat === index,
                )
                  ? " · Speaking"
                  : ""}
              </span>
            </div>
          </div>
        ))}
      </section>
      <section className={styles.section}>
        <h3 className="text-sm font-semibold">
          {session.checkpoint
            ? `Checkpoint · Round ${session.checkpoint.round}`
            : "Latest positions"}
        </h3>
        <p className={styles.hint}>
          Attributed excerpts. Inspect the original turn to read the full
          position.
        </p>
        {(
          session.checkpoint?.positions ??
          session.seats.flatMap((_, seat) => {
            const turn = [...view.turns]
              .reverse()
              .find((turn) => turn.seat === seat && turn.state === "completed" && turn.kind !== "summary");
            return turn
              ? [
                  {
                    turn_id: turn.id,
                    sequence: turn.sequence,
                    seat,
                    body: turn.body,
                  },
                ]
              : [];
          })
        ).map((position) => (
          <button
            className={styles.position}
            key={position.turn_id}
            onClick={() => inspectTurn(position.turn_id)}
          >
            <span className="mb-1 block text-xs font-medium text-primary">
              Seat {position.seat + 1} · Turn {position.sequence}
            </span>
            <span className="line-clamp-3 whitespace-pre-wrap break-words">
              {summarize(position.body, 180)}
            </span>
          </button>
        ))}
      </section>
      <section
        className={`${styles.section} rounded-lg border border-border bg-accent/25 p-3`}
      >
        <h3 className="text-sm font-semibold">A checkpoint, not an ending</h3>
        <p className={styles.hint}>{copy.context}</p>
        <p className={styles.hint}>
          No shared confidence score or automatic winner.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditedRules(session.pending_rules ?? session.rules);
            setRulesOpen(true);
          }}
        >
          Inspect ground rules
        </Button>
      </section>
    </>
  );
  return (
    <section className={focusMode ? styles.focusShell : styles.shell} aria-label={copy.title} data-focus-mode={focusMode ? "true" : undefined}>
      <header className={focusMode ? styles.focusHeader : styles.header}>
        <div className={focusMode ? styles.focusHeaderContent : styles.headerContent}>
        <div className="contents">
          {!focusMode && (
            <p className={styles.headerSummary}>
              <MessagesSquare aria-hidden="true" className="size-4 text-primary" />
              Continuous debate
              <span className="font-normal text-muted-foreground">· {session.seats.length} perspectives</span>
            </p>
          )}
          <div className={focusMode ? styles.focusHeaderActions : "ml-auto flex max-w-full flex-wrap items-center justify-end gap-0.5"}>
            <Button
              size="sm"
              variant="ghost"
              className={focusMode ? undefined : "min-[1100px]:hidden"}
              onClick={() => setBriefOpen(true)}
            >
              Live brief
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={exporting}
              onClick={() => void exportTranscript()}
            >
              <Download aria-hidden="true" />
              {exporting ? "Exporting…" : "Export"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditedRules(session.pending_rules ?? session.rules);
                setRulesOpen(true);
              }}
            >
              <Settings2 aria-hidden="true" />
              Rules
            </Button>
              <Button size="sm" variant="ghost" className={focusMode ? "size-8 p-0" : "max-sm:size-8 max-sm:px-0"} title="New debate" disabled={newDebateDisabled || busy} onClick={onNewDebate}>
                <MessagesSquare aria-hidden="true" />
                <span className={focusMode ? "sr-only" : "max-sm:sr-only"}>New debate</span>
              </Button>
          </div>
        </div>
        <h1 className="sr-only">{session.topic}</h1>
        {focusMode && (
          <div className={styles.focusParticipants} role="list" aria-label="Debate participants">
            {session.seats.map((seat, index) => {
              const active = (debate.liveData?.turns ?? view.turns).some(turn => turn.seat === index && turn.state === "streaming") && session.status !== "stopped" && session.status !== "paused";
              return (
                <div key={`${seat.provider_id}:${seat.model_id}`} role="listitem" className={cn(styles.focusParticipant, active && styles.focusParticipantActive)} data-active-speaker={active ? "true" : undefined}>
                  <ModelBrandIcon modelId={seat.model_id} className="size-4" />
                  <span className="min-w-0 truncate font-medium" title={seat.model_id}>{seat.model_id.split("/").at(-1)}</span>
                  <span className="text-muted-foreground" aria-hidden="true">·</span>
                  <span className="max-w-24 truncate text-[11px] text-muted-foreground" title={seat.role}>{seat.role}</span>
                  <span className={cn("size-1.5 shrink-0 rounded-full", active ? "bg-primary" : "bg-border")} aria-hidden="true" />
                  <span className="sr-only">{active ? "Speaking" : session.status === "paused" || session.status === "stopped" ? "Inactive" : "Listening"}</span>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </header>
      <div className={focusMode ? styles.focusControls : styles.controls}>
        <div className={focusMode ? styles.focusControlsContent : "flex flex-wrap items-center justify-between gap-x-2 gap-y-1"}>
        <div className={styles.focusStatus}>
          <p className="text-xs font-medium text-primary" role="status">
            {session.status === "running"
              ? `Round ${session.round} · ${phase(session.round)}`
              : session.status === "pausing"
                ? "Finishing active work…"
                : session.status === "paused"
                  ? `Paused · Round ${session.round}`
                  : "Debate stopped"}
          </p>
          <p className="text-[11px] text-muted-foreground max-sm:sr-only">
            {session.total_turns} turns · <span>Rules v{session.rules.version}{session.pending_rules ? ` · v${session.pending_rules.version} queued` : ""}</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {session.status === "paused" && (
            <Button
              size="xs"
              variant="ghost"
              className="max-sm:size-6 max-sm:p-0"
              disabled={busy}
              onClick={() => debate.control.mutate("step")}
              title="Run one turn; the independent opening runs as a group"
            >
              <StepForward aria-hidden="true" />
              <span className="max-sm:sr-only">Step</span>
            </Button>
          )}
          {session.status !== "stopped" && (
            <>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy || session.status === "pausing"}
                onClick={() =>
                  debate.control.mutate(
                    session.status === "paused" ? "resume" : "pause",
                  )
                }
              >
                {session.status === "paused" ? (
                  <Play aria-hidden="true" />
                ) : (
                  <Pause aria-hidden="true" />
                )}
                {session.status === "paused" ? "Resume" : "Pause"}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={() => debate.control.mutate("stop")}
              >
                <Square aria-hidden="true" />
                Stop
              </Button>
            </>
          )}
        </div>
        </div>
      </div>
      <DebateUsageStrip usage={(debate.liveData ?? view).usage} onEdit={openControls} focusMode={focusMode} />
      <div className={focusMode ? styles.focusGrid : styles.grid}>
        <div className={cn(styles.conversation, focusMode && "flex-1")}>
          <div
            ref={transcript}
            className={focusMode ? styles.focusTranscript : styles.transcript}
            tabIndex={0}
            aria-label="Debate transcript"
            onScroll={(event) => {
              const element = event.currentTarget;
              follow.current =
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                100;
              const top = element.getBoundingClientRect().top;
              const firstVisible = [...element.querySelectorAll<HTMLElement>("article")].find(turn => turn.getBoundingClientRect().bottom > top);
              readingAnchor.current = firstVisible ? { id: firstVisible.id, offset: firstVisible.getBoundingClientRect().top - top } : undefined;
            }}
          >
            <div className={focusMode ? styles.focusReading : "space-y-3"}>
            {session.notice && (
              <p className={styles.sessionNotice}>{session.notice}</p>
            )}
            {session.browser_required && session.status !== "stopped" && (
              focusMode ? <p className="py-1 text-xs text-muted-foreground">{copy.focusBrowserHint}</p> : (
                <details className={styles.connectionNotice}>
                  <summary>{copy.focusBrowserHint}</summary>
                  <p>{copy.browserBackground}</p>
                </details>
              )
            )}
            {(error || exportError || debate.isError) && (
              <p role="alert" className={`${styles.error} mt-4`}>
                {error?.message ||
                  exportError ||
                  "Live updates are unavailable. Reconnecting…"}
              </p>
            )}
            {(view.has_more || before > 0) && <div className="flex flex-wrap justify-center gap-2 pt-2">
              {view.has_more && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    follow.current = false;
                    setBefore(view.turns[0]!.sequence);
                  }}
                >
                  Older turns
                </Button>
              )}
              {before > 0 && (
                <Button
                  size="xs"
                  onClick={() => {
                    follow.current = true;
                    setBefore(0);
                  }}
                >
                  Back to latest
                </Button>
              )}
            </div>}
            {view.turns.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                The opening perspectives are being prepared. Each model sees the
                topic and rules independently.
              </div>
            )}
            {view.turns.map((turn) => (
              <article
                className={focusMode ? cn(styles.focusTurn, turn.state === "streaming" && styles.focusTurnActive) : styles.turn}
                id={`debate-turn-${turn.id}`}
                key={turn.id}
              >
                <div className={styles.turnHeading}>
                  <span className={styles.avatar}><ModelBrandIcon modelId={turn.snapshot.model_id} /></span>
                  <div className="min-w-0 flex-1">
                    <strong className="break-all font-semibold">
                      {turn.kind === "summary" ? `Stage summary · ${turn.snapshot.model_id}` : turn.snapshot.model_id}
                    </strong>
                    <p className="text-xs text-muted-foreground">
                      {turn.kind === "summary" ? "Summary model" : turn.role} · {turn.snapshot.provider_name}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Turn {turn.sequence} · Round {turn.round} · v
                    {turn.rule_version}
                  </span>
                </div>
                <div className={focusMode ? styles.focusBody : styles.body}>
                  {turn.summary ? <DebateSummaryCard summary={turn.summary} onInspect={inspectTurn} /> : turn.kind === "summary" && turn.state === "streaming" ? <p className="text-sm text-muted-foreground">Preparing a stage summary with source citations…</p> : turn.body ? (
                    <MarkdownMessage content={turn.body} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {turn.state === "streaming"
                        ? "Preparing a perspective…"
                        : turn.error_message}
                    </p>
                  )}
                </div>
                {turn.state === "streaming" && (
                  <p className="mt-2 text-xs text-primary">{turn.phase === "verifying_environment" ? "Verifying NearAI environment…" : turn.phase === "verifying_response" ? "Verifying response…" : "Speaking…"}</p>
                )}
                {turn.reasoning && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      Provider reasoning
                    </summary>
                    <MarkdownMessage content={turn.reasoning} />
                  </details>
                )}
                <div className={styles.footer}>
                  <span>{turn.state}</span>
                  {turn.verification && (
                    <span>{turn.verification.status === "verified_model" ? "Model and response verified" : turn.verification.status === "verified_gateway" ? "Gateway and response verified" : "Verification incomplete"}</span>
                  )}
                  {turn.state === "completed" && turn.kind !== "summary" && (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={debate.intervention.isPending}
                      onClick={() => challenge(turn)}
                    >
                      Challenge
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => inspectTurn(turn.id)}
                  >
                    Details
                  </Button>
                </div>
              </article>
            ))}
            <div ref={end} />
            </div>
          </div>
          <form
            className={focusMode ? styles.focusComposer : styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              addIntervention();
            }}
          >
            <div className={focusMode ? `${styles.focusHeading} space-y-2` : "space-y-2"}>
            {pending.length > 0 && (
              <div className={styles.pending}>
                <p className="text-xs font-semibold text-primary">
                  {session.status === "stopped"
                    ? "Not applied before stopping"
                    : copy.pending}
                </p>
                {pending.map((note) => (
                  <p className="whitespace-pre-wrap break-words" key={note.id}>
                    {note.body}
                  </p>
                ))}
              </div>
            )}
            <div className={styles.inputRow}>
            <label className="sr-only" htmlFor="debate-intervention">
              Your intervention
            </label>
            <Textarea
              ref={interventionInput}
              id="debate-intervention"
              className={styles.interventionInput}
              aria-describedby="debate-intervention-hint"
              title={interventionHint}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setInterventionId(crypto.randomUUID());
              }}
              rows={1}
              maxLength={4000}
              disabled={
                session.status === "stopped" || debate.intervention.isPending
              }
              placeholder={copy.intervention}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey) &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  addIntervention();
                }
              }}
            />
            <div className="contents">
              <p id="debate-intervention-hint" className="sr-only">
                {interventionHint}
              </p>
              <Button
                size="icon-sm"
                className={styles.interventionSubmit}
                title="Add to debate (Command/Ctrl+Enter)"
                type="submit"
                disabled={
                  !draft.trim() ||
                  debate.intervention.isPending ||
                  session.status === "stopped" ||
                  pending.length >= 8
                }
              >
                <ArrowUp aria-hidden="true" />
                <span className="sr-only">{debate.intervention.isPending ? "Adding…" : "Add to debate"}</span>
              </Button>
            </div>
            </div>
            </div>
          </form>
        </div>
        <aside className={focusMode ? "hidden" : styles.inspector} hidden={focusMode} aria-label={copy.liveBrief}>
          {brief}
        </aside>
      </div>
      <Dialog
        open={controlsOpen}
        onClose={() => { if (!debate.controls.isPending) setControlsOpen(false); }}
        className={styles.dialog}
      >
        <DialogOverlay />
        <DialogContent className={styles.dialogContent}>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>Summaries, budget &amp; pace</DialogTitle>
            <Button size="icon" variant="ghost" aria-label="Close debate settings" disabled={debate.controls.isPending} onClick={() => setControlsOpen(false)}><X aria-hidden="true" /></Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Settings apply before further calls. Active requests can finish. Raise a budget or disable automatic pause before resuming a budget-paused session.</p>
          {(debate.liveData ?? view).usage && <p className="mt-2 text-xs text-muted-foreground">Reported input: {(debate.liveData ?? view).usage!.input_tokens.toLocaleString()} tokens · Output: {(debate.liveData ?? view).usage!.output_tokens.toLocaleString()} tokens</p>}
          {editedControls && <form className="mt-5 space-y-5" onSubmit={event => {
            event.preventDefault();
            if (session.status === "stopped" || debateControlsError(editedControls, session.seats.length) || debate.controls.isPending) return;
            debate.controls.mutate(editedControls, { onSuccess: () => setControlsOpen(false) });
          }}>
            <fieldset disabled={session.status === "stopped" || debate.controls.isPending}><DebateControlsFields controls={editedControls} seats={session.seats} onChange={setEditedControls} /></fieldset>
            {debate.controls.error && <p className={styles.error} role="alert">{debate.controls.error.message}</p>}
            {session.status === "stopped" ? <p className={styles.hint}>This session is stopped. Settings are kept for reference.</p> : <div className="flex justify-end"><Button type="submit" disabled={debate.controls.isPending || !!debateControlsError(editedControls, session.seats.length)}>{debate.controls.isPending ? "Saving…" : "Save settings"}</Button></div>}
          </form>}
        </DialogContent>
      </Dialog>
      <Dialog
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        className={styles.dialog}
      >
        <DialogOverlay />
        <DialogContent className={styles.dialogContent}>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>{copy.rules}</DialogTitle>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Close ground rules"
              onClick={() => setRulesOpen(false)}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Rules v{session.rules.version} are active. Updates apply together at
            the next round boundary; existing turns keep their original version.
          </p>
          {editedRules && (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                debate.rules.mutate(editedRules, {
                  onSuccess: () => setRulesOpen(false),
                });
              }}
            >
              <DebateRulesFields
                rules={editedRules}
                onChange={setEditedRules}
              />
              {debate.rules.error && (
                <p role="alert" className={styles.error}>
                  {debate.rules.error.message}
                </p>
              )}
              <Button
                type="submit"
                disabled={
                  debate.rules.isPending ||
                  session.status === "stopped" ||
                  !editedRules.text.trim()
                }
              >
                Apply next round
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={briefOpen}
        onClose={() => setBriefOpen(false)}
        className={styles.dialog}
      >
        <DialogOverlay />
        <DialogContent className={styles.dialogContent}>
          <div className="mb-5 flex items-center justify-between">
            <DialogTitle>Live brief</DialogTitle>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Close live brief"
              onClick={() => setBriefOpen(false)}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          {brief}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(inspected)}
        onClose={() => { inspectionRequest.current++; setInspected(undefined); }}
        className={styles.dialog}
      >
        <DialogOverlay />
        <DialogContent className={styles.dialogContent}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <DialogTitle>
              Turn {inspected?.sequence} · {inspected?.role}
            </DialogTitle>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Close turn details"
              onClick={() => { inspectionRequest.current++; setInspected(undefined); }}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          {inspected && (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                Round {inspected.round} · Rules v{inspected.rule_version} ·{" "}
                {inspected.state}
              </p>
              {inspected.summary ? <><DebateSummaryCard summary={inspected.summary} onInspect={inspectTurn} /><details className="mt-4 text-sm"><summary>Original summary response</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{inspected.body}</pre></details></> : <MarkdownMessage
                content={
                  inspected.body ||
                  inspected.error_message ||
                  "The turn is still in progress."
                }
              />}
              <div className="mt-6">
                <ProviderSnapshotView
                  snapshot={inspected.snapshot}
                  copy={englishConversationCopy}
                  embedded
                />
                <GenerationMetrics
                  metrics={inspected.metrics}
                  snapshot={inspected.snapshot}
                  embedded
                />
                <VerificationDetailsButton verification={inspected.verification} providerName={inspected.snapshot.provider_name} modelId={inspected.snapshot.model_id} copy={englishConversationCopy} />
                <details className="mt-5 text-sm">
                  <summary className="cursor-pointer">
                    Effective ground rules and context references
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-muted p-3 font-sans text-xs leading-relaxed">
                    {inspected.configuration.system_prompt}
                  </pre>
                  <p className="mt-3 break-all text-xs text-muted-foreground">
                    Source identifiers:{" "}
                    {inspected.context_ids.join(", ") ||
                      "Independent opening; no other participant answers were included."}
                  </p>
                </details>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
