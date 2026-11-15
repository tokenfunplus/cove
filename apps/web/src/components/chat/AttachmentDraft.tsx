import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import type { AttachmentDraft as AttachmentDraftState } from "@/hooks/chat/use-attachment-draft";
import type { AttachmentSnapshot } from "@cove/api-contract";
import { Button } from "@/components/ui/button";
import { DocumentPreview } from "@/components/chat/SourceDocuments";
import { englishConversationCopy as copy } from "@/messages";

export function AttachmentDraft({
  state,
  disabled,
}: {
  state: AttachmentDraftState;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<AttachmentSnapshot>();
  return (
    <div className="space-y-2 px-3 pt-2">
      {state.selectionError && (
        <p role="alert" className="text-xs text-destructive">
          {state.selectionError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          className="sr-only"
          aria-label={copy.attachFiles}
          type="file"
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
          size="sm"
          disabled={disabled || state.attachments.length >= 4}
          onClick={() => input.current?.click()}
        >
          <Paperclip aria-hidden="true" className="mr-1 size-4" />
          {copy.attachFiles}
        </Button>
        <span className="text-xs text-muted-foreground">
          {copy.attachmentLimits}
        </span>
      </div>
      {state.attachments.map((item) => (
        <div
          className="flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm"
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
          className={`text-xs ${state.totalCharacters > 120000 ? "text-destructive" : "text-muted-foreground"}`}
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
