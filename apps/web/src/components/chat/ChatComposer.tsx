import { ArrowUp, LockKeyhole, Square } from "lucide-react";
import { useEffect, type RefObject } from "react";
import {
  type ConversationView,
  type ProviderProfile,
} from "@cove/api-contract";
import { type ActiveModelSet } from "@/components/providers/model-selection";
import { shouldSubmitComposerKey } from "@/components/chat/composer-keyboard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type ApplicationCopy } from "@/messages";
import { chatStyles } from "@/styles/chat";
import { cn } from "@/lib/utils";
import { primitivesStyles } from "@/styles/primitives";
import { AttachmentDraft } from "@/components/chat/AttachmentDraft";
import { DraftContext } from "@/components/chat/DraftContext";
import { type AttachmentDraft as AttachmentDraftState } from "@/hooks/chat/use-attachment-draft";

type Props = {
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

  const canSend =
    !navigationBusy &&
    !attachmentDraft?.invalid &&
    !isSending &&
    !catalogLoading &&
    !requiresContextChoice &&
    Boolean(draft.trim());
  const actionLabel = isSending ? copy.stopGeneration : copy.sendMessage;
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
        {attachmentDraft && (
          <AttachmentDraft state={attachmentDraft} disabled={isSending || navigationBusy} compact={compact} />
        )}
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
        <div className={cn(chatStyles.generationComposer_bar, compact && "contents")}>
          {attachmentDraft ? (
            <DraftContext
              compact={compact}
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
          <div className="flex shrink-0 items-center gap-2">
            {privateMode && (
              <span className={cn(chatStyles.generationComposer_mode, compact && "hidden")} hidden={compact}>
                <span />
                {copy.privateMode}
              </span>
            )}
            <Button
              variant="default"
              aria-label={actionLabel}
              title={actionLabel}
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
          </div>
        </div>
      </div>
      <p className={cn(chatStyles.generationComposer_foot, compact && "hidden")} hidden={compact}>
        <LockKeyhole aria-hidden="true" size={11} strokeWidth={1.8} />
        {copy.composerFoot}
      </p>
    </form>
  );
}
