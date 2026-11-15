import { ArrowUp, LockKeyhole, Square } from "lucide-react";
import { type RefObject } from "react";
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
import { primitivesStyles } from "@/styles/primitives";
import { AttachmentDraft } from "@/components/chat/AttachmentDraft";
import { DraftContext } from "@/components/chat/DraftContext";
import { type AttachmentDraft as AttachmentDraftState } from "@/hooks/chat/use-attachment-draft";

type Props = {
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
  catalogLoading: boolean;
  privateMode: boolean;
  requiresContextChoice: boolean;
  composerRef: RefObject<HTMLTextAreaElement | null>;
};
export function ChatComposer({
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
  catalogLoading,
  privateMode,
  composerRef,
  requiresContextChoice,
}: Props) {
  const canSend =
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
        if (!isSending && attachmentDraft)
          void attachmentDraft.addAttachments(
            Array.from(event.dataTransfer.files),
          );
      }}
      className={chatStyles.generationComposer}
      data-composer-style="nearai"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <div className={chatStyles.generationComposer_models}>
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
      <div className={chatStyles.generationComposer_box}>
        {attachmentDraft && (
          <AttachmentDraft state={attachmentDraft} disabled={isSending} />
        )}
        <label htmlFor="generation-input">{copy.sendMessage}</label>
        <Textarea
          className="focus-visible:ring-0 focus-visible:outline-none focus-visible:bg-transparent"
          id="generation-input"
          value={draft}
          placeholder={copy.composerPlaceholder}
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
        <div className={chatStyles.generationComposer_bar}>
          {attachmentDraft ? (
            <DraftContext
              conversationId={view.id}
              body={draft}
              attachments={attachmentDraft}
              disabled={isSending}
            />
          ) : (
            <span className={chatStyles.generationComposer_contextNote}>
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
              <span className={chatStyles.generationComposer_mode}>
                <span />
                {copy.privateMode}
              </span>
            )}
            <Button
              variant="default"
              aria-label={actionLabel}
              title={actionLabel}
              className={chatStyles.generationComposer_send}
              type={isSending ? "button" : "submit"}
              onClick={isSending ? onCancel : undefined}
              disabled={isSending ? !onCancel : !canSend}
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
      <p className={chatStyles.generationComposer_foot}>
        <LockKeyhole aria-hidden="true" size={11} strokeWidth={1.8} />
        {copy.composerFoot}
      </p>
    </form>
  );
}
