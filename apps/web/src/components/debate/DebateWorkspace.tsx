import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDebate } from "@/api/hooks/useDebates";
import { getDebateExport, getDebateTurn } from "@/api/debates";
import type { DebateRules, DebateTurn } from "@cove/api-contract";
import { debateMarkdown } from "@/lib/debate-export";
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
  onNewDebate,
}: {
  id: string;
  focusMode?: boolean;
  onNewDebate: () => void;
}) {
  const [before, setBefore] = useState(0);
  const debate = useDebate(id, before);
  const [draft, setDraft] = useState("");
  const [interventionId, setInterventionId] = useState(() =>
    crypto.randomUUID(),
  );
  const [rulesOpen, setRulesOpen] = useState(false);
  const [editedRules, setEditedRules] = useState<DebateRules>();
  const [inspected, setInspected] = useState<DebateTurn>();
  const [briefOpen, setBriefOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const readingAnchor = useRef<{ id: string; offset: number } | undefined>(undefined);
  const follow = useRef(true);
  const inspectionRequest = useRef(0);
  const view = debate.data;
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
  const pending = view.interventions.filter((note) => !note.applied_round);
  const busy = debate.control.isPending;
  const error =
    debate.control.error ?? debate.rules.error ?? debate.intervention.error;
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
    setDraft(
      `Regarding turn ${turn.sequence} (${turn.snapshot.model_id}): "${turn.body.slice(0, 300)}"\nMy challenge: `,
    );
    document
      .querySelector<HTMLTextAreaElement>("#debate-intervention")
      ?.focus();
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
      <section className={styles.section}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{copy.liveBrief}</h2>
          <span className="text-xs text-muted-foreground">Not a verdict</span>
        </div>
        <div className="grid grid-cols-3 gap-2 border-y border-border py-4">
          <div>
            <strong className="block text-2xl font-medium">
              {session.round}
            </strong>
            <span className={styles.hint}>Round</span>
          </div>
          <div>
            <strong className="block text-2xl font-medium">
              {session.total_turns}
            </strong>
            <span className={styles.hint}>Completed</span>
          </div>
          <div>
            <strong className="block text-2xl font-medium">
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
            className="flex items-center gap-3"
            key={`${seat.provider_id}:${seat.model_id}`}
          >
            <span className={styles.avatar}>{index + 1}</span>
            <div className="min-w-0">
              <strong className="block break-all text-sm font-medium">
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
              .find((turn) => turn.seat === seat && turn.state === "completed");
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
            onClick={() => {
              const turn = view.turns.find(
                (turn) => turn.id === position.turn_id,
              );
              if (turn) {
                setInspected(turn);
                return;
              }
              void getDebateTurn(id, position.turn_id).then(setInspected).catch(() => setExportError("The original turn could not be loaded. Try again."));
            }}
          >
            <span className="mb-2 block text-xs font-medium text-primary">
              Seat {position.seat + 1} · Turn {position.sequence}
            </span>
            <span className="line-clamp-4 whitespace-pre-wrap">
              {position.body}
            </span>
          </button>
        ))}
      </section>
      <section
        className={`${styles.section} rounded-2xl border border-border bg-accent/25 p-4`}
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
        <div className={focusMode ? styles.focusHeading : undefined}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={styles.eyebrow}>{focusMode ? copy.focusEyebrow : "An open-ended conversation"}</p>
          <div className="flex gap-1">
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
          </div>
        </div>
        <h1 className={focusMode ? styles.focusTopic : styles.topic}>{session.topic}</h1>
        <div className={focusMode ? "hidden" : styles.tags} hidden={focusMode}>
          <span className={`${styles.tag} text-primary`}>
            Continuous debate
          </span>
          <span className={styles.tag}>
            {session.seats.length} perspectives
          </span>
          <span className={styles.tag}>
            Rules v{session.rules.version}
            {session.pending_rules
              ? ` · v${session.pending_rules.version} queued`
              : ""}
          </span>
        </div>
        {focusMode && (
          <div className={cn(styles.focusParticipants, session.seats.length === 3 && "lg:grid-cols-3", session.seats.length === 4 && "lg:grid-cols-4")} role="list" aria-label="Debate participants">
            {session.seats.map((seat, index) => {
              const active = (debate.liveData?.turns ?? view.turns).some(turn => turn.seat === index && turn.state === "streaming") && session.status !== "stopped" && session.status !== "paused";
              return (
                <div key={`${seat.provider_id}:${seat.model_id}`} role="listitem" className={cn(styles.focusParticipant, active && styles.focusParticipantActive)} data-active-speaker={active ? "true" : undefined}>
                  <ModelBrandIcon modelId={seat.model_id} className="size-7" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" title={seat.model_id}>{seat.model_id}</p>
                    <p className="truncate text-xs text-muted-foreground">{seat.role}</p>
                  </div>
                  <span className={cn("size-2 shrink-0 rounded-full", active ? "bg-primary" : "bg-border")} aria-hidden="true" />
                  <span className="sr-only">{active ? "Speaking" : session.status === "paused" || session.status === "stopped" ? "Inactive" : "Listening"}</span>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </header>
      <div className={focusMode ? styles.focusControls : styles.controls}>
        <div className={focusMode ? "mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3" : "contents"}>
        <div>
          <p className="text-sm font-medium text-primary" role="status">
            {session.status === "running"
              ? `Round ${session.round} · ${phase(session.round)}`
              : session.status === "pausing"
                ? "Finishing active work…"
                : session.status === "paused"
                  ? `Paused · Round ${session.round}`
                  : "Debate stopped"}
          </p>
          <p className={styles.hint}>
            {focusMode ? `${session.total_turns} completed turns · Rules v${session.rules.version}${session.pending_rules ? ` · v${session.pending_rules.version} queued` : ""}` : "No round limit · Agreement does not end the debate"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {session.status === "paused" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => debate.control.mutate("step")}
              title="Run one turn; the independent opening runs as a group"
            >
              <StepForward aria-hidden="true" />
              Step
            </Button>
          )}
          {session.status === "stopped" ? (
            <Button size="sm" onClick={onNewDebate}>
              <MessagesSquare aria-hidden="true" />
              New debate
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
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
                size="sm"
                variant="outline"
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
              <p className={`${styles.notice} mt-4`}>{session.notice}</p>
            )}
            {session.browser_required && session.status !== "stopped" && (
              <p className={focusMode ? "py-1 text-xs text-muted-foreground" : `${styles.notice} mt-4`}>{focusMode ? copy.focusBrowserHint : copy.browserBackground}</p>
            )}
            {(error || exportError || debate.isError) && (
              <p role="alert" className={`${styles.error} mt-4`}>
                {error?.message ||
                  exportError ||
                  "Live updates are unavailable. Reconnecting…"}
              </p>
            )}
            <div className="flex flex-wrap justify-center gap-2 pt-4">
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
            </div>
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
                  <span className={styles.avatar}>{focusMode ? <ModelBrandIcon modelId={turn.snapshot.model_id} /> : turn.seat + 1}</span>
                  <div className="min-w-0 flex-1">
                    <strong className="break-all font-semibold">
                      {turn.snapshot.model_id}
                    </strong>
                    <p className="text-xs text-muted-foreground">
                      {turn.role} · {turn.snapshot.provider_name}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Turn {turn.sequence} · Round {turn.round} · v
                    {turn.rule_version}
                  </span>
                </div>
                <div className={focusMode ? styles.focusBody : styles.body}>
                  {turn.body ? (
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
                {turn.verification && (
                  <p className="mt-2 text-xs text-muted-foreground">{turn.verification.status === "verified_model" ? "Model and response verified" : turn.verification.status === "verified_gateway" ? "Gateway and response verified" : "Verification incomplete"}</p>
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
                  {turn.state === "completed" && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => challenge(turn)}
                    >
                      Challenge
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      const request = ++inspectionRequest.current;
                      setInspected(turn);
                      if (turn.execution === "browser" && turn.state !== "streaming") {
                        void getDebateTurn(id, turn.id).then(full => { if (inspectionRequest.current === request) setInspected(full); }).catch(() => setExportError("Verification details could not be loaded. Try again."));
                      }
                    }}
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
            <div className={focusMode ? `${styles.focusHeading} space-y-2` : "contents"}>
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
            <label className="sr-only" htmlFor="debate-intervention">
              Your intervention
            </label>
            <Textarea
              id="debate-intervention"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setInterventionId(crypto.randomUUID());
              }}
              rows={2}
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
            <div className="flex items-center justify-between gap-3">
              <p className={styles.hint}>
                {session.status === "stopped"
                  ? "Completed turns remain saved. Start a new debate to continue."
                  : "Your input joins at the next round boundary for every model."}
              </p>
              <Button
                size="sm"
                type="submit"
                disabled={
                  !draft.trim() ||
                  debate.intervention.isPending ||
                  session.status === "stopped" ||
                  pending.length >= 8
                }
              >
                {debate.intervention.isPending ? "Adding…" : "Add to debate"}
              </Button>
            </div>
            </div>
          </form>
        </div>
        <aside className={focusMode ? "hidden" : styles.inspector} hidden={focusMode} aria-label={copy.liveBrief}>
          {brief}
        </aside>
      </div>
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
              <MarkdownMessage
                content={
                  inspected.body ||
                  inspected.error_message ||
                  "The turn is still in progress."
                }
              />
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
