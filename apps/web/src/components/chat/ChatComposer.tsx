import { Checkbox } from "@/components/ui/checkbox";
import { ComposerLocalTools } from "./ComposerLocalTools";
import { ProjectInputSummary } from "@/components/projects/ProjectInputSummary";
import { ArrowUp, Globe, LoaderCircle, LockKeyhole, Square } from "lucide-react";
import { useEffect, type ReactNode, type RefObject } from "react";
import {
  type ConversationView,
  type ProviderProfile,
} from "@cove/api-contract";
import { type ActiveModelSet } from "@/components/providers/model-selection";
import { shouldSubmitComposerKey } from "@/components/chat/composer-keyboard";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { type ApplicationCopy } from "@/messages";
import { chatStyles } from "@/styles/chat";
import { cn } from "@/lib/utils";
import { primitivesStyles } from "@/styles/primitives";
import { AttachmentDraft } from "@/components/chat/AttachmentDraft";
import { DraftContext } from "@/components/chat/DraftContext";
import { type AttachmentDraft as AttachmentDraftState } from "@/hooks/chat/use-attachment-draft";

type Props = {
  execution?: {localOnly:boolean;setLocalOnly:(value:boolean)=>void;openLocalModels:()=>void};
  webSearch?: { enabled: boolean; busy: boolean; toggle: () => void; budgetLabel?: string };
  composerId?: string;
  compact?: boolean;
  attachmentDraft?: AttachmentDraftState;
  view: ConversationView;
  copy: ApplicationCopy;
  activeModelSet: ActiveModelSet;
  profiles: ProviderProfile[];
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  isSending: boolean;
  navigationBusy?: boolean;
  catalogLoading: boolean;
  privateMode: boolean;
  requiresContextChoice: boolean;
  composerRef: RefObject<HTMLTextAreaElement | null>;
};
export function ChatComposer({
  execution,
  webSearch,
  composerId = "generation-input",
  compact = false,
  attachmentDraft,
  view,
  copy,
  activeModelSet,
  profiles,
  draft,
  onDraftChange,
  onSend,
  onCancel,
  isSending,
  navigationBusy = false,
  catalogLoading,
  privateMode,
  composerRef,
  requiresContextChoice,
}: Props) {
  useEffect(() => {
    const textarea = composerRef.current;
    if (!compact || !textarea) return;
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      textarea.style.removeProperty("height");
    };
  }, [compact, draft, composerRef]);

  const localMismatch = Boolean(execution?.localOnly && (webSearch?.enabled || activeModelSet.some(target=>profiles.find(p=>p.id===target.providerId)?.kind!=="local")));
  const retrieved = attachmentDraft?.attachments.some(item=>item.snapshot?.retrieval);
  const destinations = activeModelSet.map(target=>{const p=profiles.find(profile=>profile.id===target.providerId);return p?.kind==="local"?"On this Mac":p?.name??target.providerId;});
  const allLocal=activeModelSet.length>0&&activeModelSet.every(target=>profiles.find(p=>p.id===target.providerId)?.kind==="local");
  const canSend =
    !localMismatch &&
    !navigationBusy &&
    !attachmentDraft?.invalid &&
    !isSending &&
    !catalogLoading &&
    !requiresContextChoice &&
    Boolean(draft.trim());
  const actionLabel = isSending ? copy.stopGeneration : copy.sendMessage;
  function renderInput(sourceActions?: ReactNode) {
    return <>
        {view.project_id&&<ProjectInputSummary id={view.project_id} attachments={attachmentDraft}/>}
        <label htmlFor={composerId}>{copy.sendMessage}</label>
        <Textarea
          className="focus-visible:ring-0 focus-visible:outline-none focus-visible:bg-transparent"
          id={composerId}
          value={draft}
          disabled={navigationBusy}
          placeholder={compact ? copy.focusComposerPlaceholder : copy.composerPlaceholder}
          rows={compact ? 1 : undefined}
          onChange={(event) => onDraftChange(event.target.value)}
          ref={composerRef}
          onKeyDown={(event) => {
            if (
              !isSending &&
              shouldSubmitComposerKey({
                ...event,
                isComposing: event.nativeEvent.isComposing,
              })
            ) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        <div className={cn(chatStyles.generationComposer_bar, compact && "mt-0 shrink-0 gap-1")}>
          <div className="flex min-w-0 items-center gap-0.5">
          {sourceActions}
          {attachmentDraft&&<ComposerLocalTools key={view.id} attachments={attachmentDraft} projectId={view.project_id} disabled={isSending||navigationBusy} onManage={execution?.openLocalModels}/>}
          {attachmentDraft ? (
            <DraftContext
              compact
              destinations={activeModelSet.map(t=>{const p=profiles.find(p=>p.id===t.providerId);return `${p?.name??t.providerId} / ${t.modelId}: ${p?.endpoint??"unavailable"}`;})}
              conversationId={view.id}
              body={draft}
              attachments={attachmentDraft}
              disabled={isSending || navigationBusy}
            />
          ) : (
            <span className={cn(chatStyles.generationComposer_contextNote, compact && "sr-only")}>
              {copy.contextSnapshot.toUpperCase()} ·{" "}
              {
                (view.generation_batches ?? []).filter(
                  (batch) => batch.context_frozen,
                ).length
              }{" "}
              TURNS
            </span>
          )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {webSearch && <Tooltip content={<><span className="block font-medium">Web search {webSearch.enabled ? "on" : "off"}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{webSearch.enabled ? webSearch.budgetLabel ?? "Models can search when needed." : "Let models search for current information and sources."}</span></>}><Button type="button" variant="ghost" size="icon-sm" aria-label="Web search" aria-pressed={webSearch.enabled} aria-busy={webSearch.busy} disabled={webSearch.busy || isSending || navigationBusy || execution?.localOnly || (allLocal && !webSearch.enabled)} className={cn("rounded-lg", webSearch.enabled ? "bg-accent text-primary ring-1 ring-primary/15" : "text-muted-foreground")} onClick={webSearch.toggle}>{webSearch.busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Globe className="size-4" aria-hidden="true" />}</Button></Tooltip>}

            {privateMode && (
              <span className={cn(chatStyles.generationComposer_mode, compact && "hidden")} hidden={compact}>
                <span />
                {copy.privateMode}
              </span>
            )}
            <Tooltip content={actionLabel}>
            <Button
              variant="default"
              aria-label={actionLabel}
              className={cn(chatStyles.generationComposer_send, compact && "size-8 rounded-lg")}
              type={isSending ? "button" : "submit"}
              onClick={isSending ? onCancel : undefined}
              disabled={navigationBusy || (isSending ? !onCancel : !canSend)}
            >
              {isSending ? (
                <Square
                  aria-hidden="true"
                  className="size-3"
                  fill="currentColor"
                  strokeWidth={0}
                />
              ) : (
                <ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
              )}
            </Button>
            </Tooltip>
          </div>
        </div>
    </>;
  }
  return (
    <form
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        if (!navigationBusy && !isSending && attachmentDraft)
          void attachmentDraft.addAttachments(
            Array.from(event.dataTransfer.files),
          );
      }}
      className={cn(chatStyles.generationComposer, compact && chatStyles.focusComposer)}
      data-composer-style="nearai"
      data-compact={compact ? "true" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <div className={cn(chatStyles.generationComposer_models, compact && "hidden")} hidden={compact}>
        <span className={chatStyles.generationComposer_label}>
          {copy.activeModelSet}
        </span>
        {activeModelSet.map((target) => {
          const profile = profiles.find(
            (candidate) => candidate.id === target.providerId,
          );
          return (
            <span
              className={chatStyles.generationComposer_chip}
              key={`${target.providerId}:${target.modelId}`}
            >
              <span aria-hidden="true" className={primitivesStyles.dot} />
              <b>{profile?.name ?? target.providerId}</b>
              {target.modelId}
            </span>
          );
        })}
        {activeModelSet.length >= 2 ? (
          <span className={chatStyles.generationComposer_hint}>
            {copy.modelComparison}
          </span>
        ) : null}
      </div>
      <div className={cn(chatStyles.generationComposer_box, compact && chatStyles.focusComposerBox)}>
        {attachmentDraft ? (
          <AttachmentDraft localOnly={execution?.localOnly} state={attachmentDraft} disabled={isSending || navigationBusy} compact={compact} draft={draft}>
            {renderInput}
          </AttachmentDraft>
        ) : renderInput()}
      </div>
      {execution&&<div className="mt-2 grid gap-2 text-xs" aria-label="Execution locations">
        <div className="flex flex-wrap items-center justify-between gap-2"><span>{retrieved?"Search: On this Mac → ":""}Answer: {destinations.join(" + ")||"Choose a model"}</span><label className="flex items-center gap-2"><Checkbox  checked={execution.localOnly} disabled={isSending||navigationBusy||webSearch?.busy} onCheckedChange={checked=>{if((checked === true)&&webSearch?.enabled)webSearch.toggle();execution.setLocalOnly((checked === true));}}/>Only on this Mac</label></div>
        {localMismatch?<p role="alert" className="text-destructive">Choose an installed local chat model to send in this mode. <Button variant="link" size="xs" onClick={execution.openLocalModels}>Choose local model</Button></p>:<p className="text-muted-foreground">{allLocal?"The selected models process your question and context on this Mac.":"Your question, selected history, project context, and attached source text go to the listed Providers."}</p>}
        {allLocal&&<p className="text-muted-foreground">Experimental local model: check facts, code, and citations.</p>}
      </div>}
      <p className={cn(chatStyles.generationComposer_foot, compact && "hidden")} hidden={compact}>
        <LockKeyhole aria-hidden="true" size={11} strokeWidth={1.8} />
        {allLocal?"History and local model processing stay on this Mac.":copy.composerFoot}
      </p>
    </form>
  );
}
