import { answerToolsCopy as toolCopy } from "@/messages/answer-tools";
import { useEffect, useRef, useState } from "react";
import { X, Undo2, Redo2, Copy, Download, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConversationPanel } from "@/components/chat/ConversationPanel";
import { AnswerToolsContext } from "@/components/chat/AnswerActions";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { ModelAnswerCard } from "@/components/chat/ModelAnswerCard";
import { inferenceModeForSnapshot } from "@/components/providers/model-selection";
import type { AnswerTools } from "@/hooks/chat/use-answer-tools";
import { workbenchDiff } from "@/lib/chat/workbench";
import { copyText } from "@/lib/clipboard";
import { answerToolsStyles as styles } from "@/styles/answer-tools";

export function AnswerToolsPanel({ tools }: { tools: AnswerTools }) {
  const {
    open,
    setOpen,
    tab,
    setTab,
    state,
    busy,
    externalBusy,
    history,
    documentSource,
  } = tools;
  const [view, setView] = useState<"edit" | "preview" | "changes">("edit");
  const editor = useRef<HTMLTextAreaElement>(null);
  const revisionReview = useRef<HTMLElement>(null);
  useEffect(() => {
    if (tools.candidate === undefined) return;
    revisionReview.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [tools.candidate]);
  if (!open) return null;
  const disabled = busy || externalBusy;
  const revisionBatch = tools.sideConversation?.generation_batches?.find(
    (batch) => batch.id === state.generationBatch?.id,
  );
  const revisionMessages =
    tools.revisionTask?.sideId === tools.sideConversation?.id
      ? (tools.sideConversation?.messages.filter(
          (message) =>
            message.role === "assistant" &&
            message.generation_batch_id === state.generationBatch?.id,
        ) ?? [])
      : [];
  const savedRevisionAttempts = new Set(
    revisionBatch?.targets.filter(target => revisionMessages.some(message => message.id === target.generation.assistant_message_id))
      .map(target => target.generation.id),
  );
  const liveRevisionTargets = state.liveTurn?.targets?.filter(target =>
    busy || target.phase !== "completed" || !savedRevisionAttempts.has(target.generationId ?? ""),
  ) ?? [];
  const canApply = tools.revisionTask?.base === history.content;
  const candidateRange = tools.revisionTask?.range;
  const candidateDocument =
    tools.candidate === undefined
      ? undefined
      : candidateRange && candidateRange.end > candidateRange.start
        ? history.content.slice(0, candidateRange.start) +
          tools.candidate +
          history.content.slice(candidateRange.end)
        : tools.candidate;
  function downloadDraft() {
    const url = URL.createObjectURL(
      new Blob([history.content], { type: "text/markdown;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cove-workbench.md";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    tools.markExported();
  }
  return (
    <AnswerToolsContext.Provider value={undefined}>
      <aside aria-label={toolCopy.title} className={styles.panel}>
        <header className={styles.header}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <SquarePen size={16} aria-hidden="true" />
            {toolCopy.title}
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={toolCopy.close}
            onClick={() => setOpen(false)}
          >
            <X />
          </Button>
        </header>
        <div
          className={styles.tabs}
          role="group"
          aria-label={toolCopy.toolChoice}
        >
          {[
            ["ask", toolCopy.sideConversation],
            ["write", toolCopy.workbench],
          ].map(([value, label]) => (
            <Button
              key={value}
              aria-pressed={tab === value}
              disabled={busy}
              size="sm"
              variant={tab === value ? "secondary" : "ghost"}
              onClick={() => setTab(value as typeof tab)}
            >
              {label}
            </Button>
          ))}
        </div>
        {tools.feedback && (
          <div
            role="status"
            className="border-b border-border bg-muted px-4 py-2 text-xs"
          >
            {tools.feedback}
          </div>
        )}
        {tab === "ask" ? (
          <>
            <div className="space-y-2 border-b border-border p-4">
              {tools.quote && (
                <blockquote className={styles.quote}>{tools.quote}</blockquote>
              )}
              <p className={styles.hint}>{toolCopy.sideNotice}</p>
            </div>
            {tools.sideConversation ? (
              <ConversationPanel
                focusMode
                composerId="side-generation-input"
                privateMode={tools.privateMode}
                view={tools.sideConversation}
                copy={tools.copy}
                attachmentDraft={tools.attachments}
                draft={state.draft}
                onDraftChange={state.setDraft}
                onSend={() => void tools.sendQuestion()}
                onCancel={() => void tools.cancel()}
                isSending={busy}
                navigationBusy={externalBusy}
                liveTurn={state.liveTurn}
                generationBatch={state.generationBatch}
                generationBatches={
                  tools.sideConversation.generation_batches ?? []
                }
                activeModelSet={tools.activeModelSet}
                profiles={tools.providerProfiles}
                providerStatus={tools.selectionStatus}
                onRetry={(batchId, targetId) =>
                  void tools.commands.handleRetry(batchId, targetId)
                }
                onSelectAnswer={(batchId, generationId) =>
                  void tools.commands.handleSelectAnswer(batchId, generationId)
                }
                onSkipContext={(batchId) =>
                  void tools.commands.handleSkipContext(batchId)
                }
                onCancelTarget={(batchId, generationId) =>
                  void tools.commands.handleCancelTarget(batchId, generationId)
                }
              />
            ) : (
              <div className={`${styles.body} flex flex-col justify-end gap-3`}>
                <label htmlFor="side-question" className="text-sm font-medium">
                  {toolCopy.questionLabel}
                </label>
                <Textarea
                  id="side-question"
                  value={state.draft}
                  onChange={(event) => state.setDraft(event.target.value)}
                  placeholder={toolCopy.questionPlaceholder}
                  disabled={disabled}
                />
                <Button
                  disabled={
                    disabled ||
                    !tools.quote ||
                    !state.draft.trim() ||
                    tools.selectionStatus !== "ready"
                  }
                  onClick={() => void tools.sendQuestion()}
                >
                  {toolCopy.sendQuestion}
                </Button>
                {busy && (
                  <Button variant="outline" onClick={() => void tools.cancel()}>
                    {toolCopy.stop}
                  </Button>
                )}
              </div>
            )}
          </>
        ) : documentSource ? (
          <>
            <div className="space-y-3 border-b border-border p-4">
              <p className={styles.hint}>
                Draft from {documentSource.snapshot?.model_id ?? "saved answer"}
                . Edits stay separate from the original answer and Provider
                context.
              </p>
              <div className="flex flex-wrap items-center gap-1">
                {[
                  ["edit", toolCopy.edit],
                  ["preview", toolCopy.preview],
                  ["changes", toolCopy.changes],
                ].map(([value, label]) => (
                  <Button
                    key={value}
                    size="xs"
                    variant={view === value ? "secondary" : "ghost"}
                    aria-pressed={view === value}
                    onClick={() => {
                      tools.dispatch({ type: "checkpoint" });
                      setView(value as typeof view);
                    }}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={toolCopy.undo}
                  disabled={!history.past.length || busy}
                  onClick={() => tools.dispatch({ type: "undo" })}
                >
                  <Undo2 />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={toolCopy.redo}
                  disabled={!history.future.length || busy}
                  onClick={() => tools.dispatch({ type: "redo" })}
                >
                  <Redo2 />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    void copyText(history.content).then((ok) =>
                      tools.setFeedback(
                        ok ? toolCopy.copied : toolCopy.copyFailed,
                      ),
                    )
                  }
                >
                  <Copy />
                  {toolCopy.copy}
                </Button>
                <Button size="xs" variant="ghost" onClick={downloadDraft}>
                  <Download />
                  {toolCopy.download}
                </Button>
              </div>
            </div>
            <div className={`${styles.body} flex flex-col gap-4`}>
              {view === "edit" ? (
                <label className="flex min-h-64 flex-1 flex-col gap-2 text-xs text-muted-foreground">
                  {toolCopy.workingDraft}
                  <textarea
                    ref={editor}
                    aria-label={toolCopy.workingDraft}
                    className={styles.editor}
                    value={history.content}
                    maxLength={120000}
                    disabled={busy}
                    onChange={(event) =>
                      tools.dispatch({
                        type: "edit",
                        content: event.target.value,
                      })
                    }
                    onBlur={() => tools.dispatch({ type: "checkpoint" })}
                    onSelect={(event) => {
                      const { selectionStart: start, selectionEnd: end } =
                        event.currentTarget;
                      tools.setRevisionRange(
                        end > start ? { start, end } : undefined,
                      );
                    }}
                  />
                </label>
              ) : view === "preview" ? (
                <MarkdownMessage content={history.content} />
              ) : (
                <DraftDiff
                  before={documentSource.body}
                  after={history.content}
                />
              )}
              {tools.revisionTask && liveRevisionTargets.length > 0 && (
                <div className="space-y-2" role="status">
                  {busy && <p className={styles.hint}>{toolCopy.preparingRevision}</p>}
                  {liveRevisionTargets.map((target) => (
                    <ModelAnswerCard
                      key={target.key}
                      targetId={target.targetId ?? target.key}
                      modelId={target.modelId}
                      body={target.assistantBody}
                        reasoning={target.reasoningBody}
                      phase={target.phase}
                      snapshot={target.snapshot}
                      errorCode={target.errorCode}
                      copy={tools.copy}
                    />
                  ))}
                </div>
              )}
              {!busy &&
                revisionMessages.map((message) => {
                  const attempt = revisionBatch?.targets.find(
                    (target) =>
                      target.generation.assistant_message_id === message.id,
                  )?.generation;
                  return (
                    <section
                      key={message.id}
                      className="space-y-2 rounded-xl border border-border p-3"
                      aria-label={toolCopy.proposedRevision}
                    >
                      <ModelAnswerCard
                        targetId={attempt?.id ?? message.id}
                        modelId={
                          message.provider_snapshot?.model_id ?? "Assistant"
                        }
                        providerName={message.provider_snapshot?.provider_name}
                        body={message.body}
                        reasoning={message.reasoning}
                        phase="completed"
                        copy={tools.copy}
                        snapshot={message.provider_snapshot}
                        verification={attempt?.verification}
                        mode={inferenceModeForSnapshot(
                          message.provider_snapshot,
                        )}
                        metrics={attempt?.metrics}
                        actions={
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canApply}
                            onClick={() => tools.setCandidate(message.body)}
                          >
                            {toolCopy.reviewChanges}
                          </Button>
                        }
                      />
                      {!canApply && (
                        <p className={styles.hint}>{toolCopy.staleRevision}</p>
                      )}
                    </section>
                  );
                })}
              {candidateDocument !== undefined && (
                <section
                  ref={revisionReview}
                  className="space-y-3 rounded-xl border border-primary/30 p-3"
                  aria-label={toolCopy.reviewRevision}
                >
                  <h3 className="text-sm font-semibold">
                    {toolCopy.proposedChanges}
                  </h3>
                  <DraftDiff
                    before={history.content}
                    after={candidateDocument}
                  />
                  <div className={styles.actions}>
                    <Button
                      size="sm"
                      disabled={!canApply}
                      onClick={() => {
                        tools.applyCandidate();
                        setView("edit");
                        requestAnimationFrame(() => editor.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
                      }}
                    >
                      {toolCopy.applyRevision}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => tools.setCandidate(undefined)}
                    >
                      {toolCopy.dismiss}
                    </Button>
                  </div>
                </section>
              )}
            </div>
            <div className={styles.footer}>
              {tools.revisionRange && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span>
                    {tools.revisionRange.end - tools.revisionRange.start}{" "}
                    characters selected for rewriting
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => tools.setRevisionRange(undefined)}
                  >
                    {toolCopy.wholeDraft}
                  </Button>
                </div>
              )}
              <label className="block space-y-2 text-xs font-medium">
                {toolCopy.revisionRequest}
                <Textarea
                  aria-label={toolCopy.revisionRequest}
                  value={tools.revisionInstruction}
                  onChange={(event) =>
                    tools.setRevisionInstruction(event.target.value)
                  }
                  placeholder={toolCopy.revisionPlaceholder}
                  disabled={disabled}
                />
              </label>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={
                    disabled ||
                    !tools.revisionInstruction.trim() ||
                    !history.content.trim() ||
                    tools.selectionStatus !== "ready"
                  }
                  onClick={() => void tools.requestRevision()}
                >
                  {tools.revisionRange
                    ? toolCopy.rewriteSelection
                    : toolCopy.reviseDraft}
                </Button>
                {busy && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void tools.cancel()}
                  >
                    {toolCopy.stop}
                  </Button>
                )}
              </div>
              <p className={styles.hint}>{toolCopy.revisionNotice}</p>
            </div>
          </>
        ) : (
          <div className={styles.body}>
            <p className={styles.hint}>{toolCopy.emptyWorkbench}</p>
          </div>
        )}
      </aside>
      <Dialog
        open={Boolean(tools.replacement)}
        onClose={() => tools.setReplacement(undefined)}
        label={toolCopy.replaceDraft}
        className="fixed inset-0 z-50 grid place-items-center p-4"
      >
        <DialogOverlay />
        <DialogContent className="w-full max-w-sm space-y-4 rounded-2xl p-5">
          <DialogTitle>{toolCopy.replaceDraftTitle}</DialogTitle>
          <p className={styles.hint}>{toolCopy.replaceDraftNotice}</p>
          <div className={styles.actions}>
            <Button
              variant="outline"
              onClick={() => tools.setReplacement(undefined)}
            >
              {toolCopy.keepDraft}
            </Button>
            <Button onClick={tools.confirmReplacement}>
              {toolCopy.replaceDraft}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AnswerToolsContext.Provider>
  );
}

function DraftDiff({ before, after }: { before: string; after: string }) {
  if (before === after)
    return <p className={styles.hint}>{toolCopy.noChanges}</p>;
  return (
    <div
      aria-label={toolCopy.draftDifferences}
      className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed"
    >
      {workbenchDiff(before, after).map((line, index) => (
        <div
          key={index}
          className={
            line.kind === "added"
              ? "bg-primary/10 text-primary"
              : line.kind === "removed"
                ? "bg-destructive/10 text-destructive line-through"
                : "text-muted-foreground"
          }
        >
          <span className="select-none" aria-hidden="true">
            {line.kind === "added"
              ? "+ "
              : line.kind === "removed"
                ? "− "
                : "  "}
          </span>
          {line.text || " "}
        </div>
      ))}
    </div>
  );
}
