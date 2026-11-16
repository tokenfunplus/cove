import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import type { AttachmentDraft as AttachmentDraftState } from "@/hooks/chat/use-attachment-draft";
import type { AttachmentSnapshot } from "@cove/api-contract";
import { Button } from "@/components/ui/button";
import { DocumentPreview } from "@/components/chat/SourceDocuments";
import { cn } from "@/lib/utils";
import { englishConversationCopy as copy } from "@/messages";

export function AttachmentDraft({
  state,
  disabled,
  compact = false,
}: {
  state: AttachmentDraftState;
  disabled: boolean;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<AttachmentSnapshot>();
  return (
    <div className={compact ? "contents" : "space-y-2 px-3 pt-2"}>
      {state.selectionError && (
        <p role="alert" className={cn("text-xs text-destructive", compact && "order-first basis-full px-1 pt-1")}>
          {state.selectionError}
        </p>
      )}
      <div className={compact ? "shrink-0" : "flex flex-wrap items-center gap-2"}>
        <input
          ref={input}
          className="sr-only"
          aria-label={copy.attachFiles}
          type="file"
          tabIndex={-1}
          multiple
          disabled={disabled || state.attachments.length >= 4}
          onChange={(event) => {
            void state.addAttachments(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size={compact ? "icon-sm" : "sm"}
          className={compact ? "rounded-lg text-muted-foreground" : undefined}
          title={copy.attachFiles}
          disabled={disabled || state.attachments.length >= 4}
          onClick={() => input.current?.click()}
        >
          <Paperclip aria-hidden="true" className={cn("size-4", !compact && "mr-1")} />
          <span className={compact ? "sr-only" : undefined}>{copy.attachFiles}</span>
        </Button>
        <span className={cn("text-xs text-muted-foreground", compact && "hidden")} hidden={compact}>
          {copy.attachmentLimits}
        </span>
      </div>
      {state.attachments.map((item) => (
        <div
          className={cn("flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm", compact && "order-first basis-full")}
          key={item.key}
        >
          <div className="min-w-0 flex-1">
            <p className="break-words">{item.name}</p>
            {item.error ? (
              <p role="alert" className="text-destructive">
                {item.error}
              </p>
            ) : item.snapshot ? (
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => setSelected(item.snapshot)}
              >
                {copy.previewSource} ·{" "}
                {item.snapshot.characters.toLocaleString()} {copy.characters}
              </Button>
            ) : (
              <p role="status" className="text-xs text-muted-foreground">
                {copy.parsingFile}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={`${copy.removeAttachment}: ${item.name}`}
            onClick={() => state.removeAttachment(item.key)}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      ))}
      {state.attachments.length > 0 && (
        <p
          className={cn(`text-xs ${state.totalCharacters > 120000 ? "text-destructive" : "text-muted-foreground"}`, compact && "order-first basis-full px-1 text-[10px]")}
          role={state.totalCharacters > 120000 ? "alert" : undefined}
        >
          {state.totalCharacters.toLocaleString()} / 120,000 {copy.characters}.{" "}
          {copy.attachmentDisclosure}
        </p>
      )}
      {selected && (
        <DocumentPreview
          document={selected}
          onClose={() => setSelected(undefined)}
        />
      )}
    </div>
  );
}
