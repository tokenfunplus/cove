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
import { AttachmentDraft, type WebpageAction } from "@/components/chat/AttachmentDraft";
import { DraftContext } from "@/components/chat/DraftContext";
import { QuickPanelTools } from "@/components/chat/QuickPanelTools";
import { type AttachmentDraft as AttachmentDraftState } from "@/hooks/chat/use-attachment-draft";

type Props = {
  execution?: {localOnly:boolean;setLocalOnly:(value:boolean)=>void;openLocalModels:()=>void};
  webSearch?: { enabled: boolean; busy: boolean; toggle: () => void; budgetLabel?: string };
  composerId?: string;
  compact?: boolean;
  quickPanel?: boolean;
  quickPanelModelControl?: ReactNode;
  connectionReady?: boolean;
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
  quickPanel = false,
  quickPanelModelControl,
  connectionReady = true,
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
  const executionNotice = allLocal
    ? "The selected models process your question and context on this Mac. Experimental local model: check facts, code, and citations."
    : "Your question, selected history, project context, and attached source text go to the listed Providers.";
  const toolsDisabled = isSending || navigationBusy || !connectionReady;
  const webSearchDisabled = Boolean(webSearch?.busy || isSending || navigationBusy || execution?.localOnly || (allLocal && !webSearch?.enabled));
  const localWarning = localMismatch && (
    <p role="alert" className="text-destructive">
      Choose an installed local chat model to send in this mode. <Button variant="link" size="xs" onClick={execution?.openLocalModels}>Choose local model</Button>
    </p>
  );
  const canSend =
    connectionReady &&
    !localMismatch &&
    !navigationBusy &&
    !attachmentDraft?.invalid &&
    !isSending &&
    !catalogLoading &&
    !requiresContextChoice &&
    Boolean(draft.trim());
  const actionLabel = isSending ? copy.stopGeneration : copy.sendMessage;
  function renderInput(sourceActions?: ReactNode, webpage?: WebpageAction) {
    const contextAction = attachmentDraft ? (
      <DraftContext
        compact
        destinations={activeModelSet.map(t=>{const p=profiles.find(p=>p.id===t.providerId);return `${p?.name??t.providerId} / ${t.modelId}: ${p?.endpoint??"unavailable"}`;})}
        conversationId={view.id}
        body={draft}
        attachments={attachmentDraft}
        disabled={isSending || navigationBusy || (quickPanel && !connectionReady)}
        renderTrigger={quickPanel ? (open, disabled) => (
          <QuickPanelTools
            attachments={attachmentDraft}
            disabled={toolsDisabled}
            webpage={webpage}
            context={view.id ? { open, disabled } : undefined}
            webSearch={webSearch && { ...webSearch, disabled: webSearchDisabled }}
            localOnly={execution && { enabled: execution.localOnly, disabled: Boolean(webSearch?.busy), toggle: execution.setLocalOnly }}
            onManage={execution?.openLocalModels}
          />
        ) : undefined}
      />
    ) : (
      <span className={cn(chatStyles.generationComposer_contextNote, compact && "sr-only")}>
        {copy.contextSnapshot.toUpperCase()} ·{" "}
        {(view.generation_batches ?? []).filter(batch => batch.context_frozen).length} TURNS
      </span>
    );
    const localTools = !quickPanel && attachmentDraft && <ComposerLocalTools key={view.id} attachments={attachmentDraft} projectId={view.project_id} disabled={toolsDisabled} onManage={execution?.openLocalModels} compact={compact} actions={compact ? <>{sourceActions}{contextAction}</> : undefined}/>;
    return <>
        {view.project_id&&<ProjectInputSummary id={view.project_id} attachments={attachmentDraft}/>}
        <label htmlFor={composerId}>{copy.sendMessage}</label>
        <Textarea
          className="focus-visible:ring-0 focus-visible:outline-none focus-visible:bg-transparent"
          id={composerId}
          value={draft}
          disabled={navigationBusy}
          placeholder={quickPanel ? "Ask anything…" : compact ? copy.focusComposerPlaceholder : copy.composerPlaceholder}
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
          {compact && !quickPanel && attachmentDraft ? localTools : <>{sourceActions}{localTools}{contextAction}</>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!quickPanel && webSearch && <Tooltip content={<><span className="block font-medium">Web search {webSearch.enabled ? "on" : "off"}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{webSearch.enabled ? webSearch.budgetLabel ?? "Models can search when needed." : "Let models search for current information and sources."}</span></>}><Button type="button" variant="ghost" size="icon-sm" aria-label="Web search" aria-pressed={webSearch.enabled} aria-busy={webSearch.busy} disabled={webSearchDisabled} className={cn("rounded-lg", webSearch.enabled ? "bg-accent text-primary ring-1 ring-primary/15" : "text-muted-foreground")} onClick={webSearch.toggle}>{webSearch.busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Globe className="size-4" aria-hidden="true" />}</Button></Tooltip>}

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
        if (!quickPanel && event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (quickPanel || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        if (!navigationBusy && !isSending && attachmentDraft)
          void attachmentDraft.addAttachments(
            Array.from(event.dataTransfer.files),
          );
      }}
      className={cn(chatStyles.generationComposer, compact && chatStyles.focusComposer, quickPanel && "[&_textarea]:max-h-[120px]")}
      data-composer-style="nearai"
      data-compact={compact ? "true" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (event.target === event.currentTarget && canSend) onSend();
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
          <AttachmentDraft localOnly={execution?.localOnly} state={attachmentDraft} disabled={isSending || navigationBusy || !connectionReady} compact={compact} quickPanel={quickPanel} draft={draft}>
            {renderInput}
          </AttachmentDraft>
        ) : renderInput()}
      </div>
      {quickPanel ? (
        <div className="mt-1 grid gap-1 text-[11px] leading-4 text-muted-foreground" aria-label="Execution locations">
          <div className="flex min-w-0 items-center gap-2">
            {quickPanelModelControl}
            {webSearch?.busy ? (
              <span role="status" className="inline-flex items-center gap-1 whitespace-nowrap">
                <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />Checking search settings
              </span>
            ) : webSearch?.enabled && <span className="whitespace-nowrap">Web search on</span>}
            {(execution?.localOnly || destinations.length > 0) && (
              <Tooltip content={<>{retrieved && <span className="block">Document search: On this Mac</span>}{destinations.length > 0 && <span className="block font-medium">Answer: {destinations.join(" + ")}</span>}{executionNotice}</>}>
                <span tabIndex={0} className="ml-auto flex min-w-0 items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {execution?.localOnly && <LockKeyhole className="size-3 shrink-0" aria-hidden="true" />}
                  <span className="truncate">
                    {execution?.localOnly ? "Only on this Mac" : allLocal ? "On this Mac" : `Send to ${destinations.join(" + ")}`}
                  </span>
                </span>
              </Tooltip>
            )}
          </div>
          {localWarning}
        </div>
      ) : execution && <div className={cn("mt-2 grid gap-2 text-xs", compact && "mt-1 gap-1 text-[10px] leading-4")} aria-label="Execution locations">
        <div className={cn("flex flex-wrap items-center justify-between gap-2", compact && "flex-nowrap")}><Tooltip content={executionNotice}><span tabIndex={compact ? 0 : undefined} className={compact ? "min-w-0 flex-1 truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" : undefined}>{retrieved?"Search: On this Mac → ":""}Answer: {destinations.join(" + ")||"Choose a model"}</span></Tooltip><label className="flex shrink-0 items-center gap-2 whitespace-nowrap"><Checkbox  checked={execution.localOnly} disabled={isSending||navigationBusy||webSearch?.busy} onCheckedChange={checked=>execution.setLocalOnly(checked === true)}/>Only on this Mac</label></div>
        {localMismatch?localWarning:<p className={cn("text-muted-foreground", compact && "sr-only")}>{allLocal?"The selected models process your question and context on this Mac.":executionNotice}</p>}
        {allLocal&&<p className={cn("text-muted-foreground", compact && "sr-only")}>Experimental local model: check facts, code, and citations.</p>}
      </div>}
      <p className={cn(chatStyles.generationComposer_foot, compact && "hidden")} hidden={compact}>
        <LockKeyhole aria-hidden="true" size={11} strokeWidth={1.8} />
        {allLocal?"History and local model processing stay on this Mac.":copy.composerFoot}
      </p>
    </form>
  );
}
