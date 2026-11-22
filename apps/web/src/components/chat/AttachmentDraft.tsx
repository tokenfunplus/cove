import { useRef, useState, type ReactNode } from "react";
import { Link, Paperclip, X } from "lucide-react";
import type { AttachmentDraft as AttachmentDraftState } from "@/hooks/chat/use-attachment-draft";
import type { AttachmentSnapshot } from "@cove/api-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogOverlay } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { DocumentPreview } from "@/components/chat/SourceDocuments";
import { cn } from "@/lib/utils";
import { englishConversationCopy as copy } from "@/messages";

export function AttachmentDraft({
  localOnly = false,
  state,
  children,
  disabled,
  compact = false,
  draft = "",
}: {
  localOnly?: boolean;
  state: AttachmentDraftState;
  children: (actions: ReactNode) => ReactNode;
  disabled: boolean;
  compact?: boolean;
  draft?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<AttachmentSnapshot>();
  const [webOpen, setWebOpen] = useState(false);
  const [webUrl, setWebUrl] = useState("");

  function readWebpage() {
    if (localOnly || state.localOnly || disabled || !webUrl.trim()) return;
    void state.addWebSource(webUrl.trim());
    setWebOpen(false);
  }
  const actions = (
      <div className="flex shrink-0 items-center gap-0.5">
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
        <Tooltip suppressRestoredFocus content={<><span className="block font-medium">{copy.attachFiles}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{copy.attachmentLimits}</span></>}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-lg text-muted-foreground"
          disabled={disabled || state.attachments.length >= 4}
          onClick={() => input.current?.click()}
        >
          <Paperclip aria-hidden="true" className="size-4" />
          <span className="sr-only">{copy.attachFiles}</span>
        </Button>
        </Tooltip>
        <Tooltip suppressRestoredFocus content={<><span className="block font-medium">{copy.readWebpage}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">Attach a saved copy of a public webpage.</span></>}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-lg text-muted-foreground"
          disabled={localOnly || state.localOnly || disabled || state.attachments.length >= 4}
          onClick={() => {
            setWebUrl(draft.match(/https?:\/\/[^\s<>"\u3000-\u303f]+/i)?.[0] ?? "");
            setWebOpen(true);
          }}
        >
          <Link aria-hidden="true" className="size-4" />
          <span className="sr-only">{copy.readWebpage}</span>
        </Button>
        </Tooltip>
      </div>
  );
  return (
    <>
      {state.selectionError && (
        <p role="alert" className={cn("mb-2 text-xs text-destructive", compact && "order-first basis-full px-1 pt-1")}>
          {state.selectionError}
        </p>
      )}
      {state.attachments.map((item) => (
        <div
          className={cn("mb-2 flex items-start gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm", compact && "order-first basis-full")}
          key={item.key}
        >
          <div className="min-w-0 flex-1">
            <p className="break-words">{item.name}</p>
            {item.sourceUrl && (
              <p className="break-all text-xs text-muted-foreground">
                {item.sourceUrl}
              </p>
            )}
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
                {item.sourceUrl ? copy.readingWebpage : copy.parsingFile}
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
          className={cn(`mb-2 text-xs ${state.totalCharacters > 120000 ? "text-destructive" : "text-muted-foreground"}`, compact && "order-first basis-full px-1 text-[10px]")}
          role={state.totalCharacters > 120000 ? "alert" : undefined}
        >
          {state.totalCharacters.toLocaleString()} / 120,000 {copy.characters}.{" "}
          {copy.attachmentDisclosure}
        </p>
      )}
      {children(actions)}
      {selected && (
        <DocumentPreview
          document={selected}
          onClose={() => setSelected(undefined)}
        />
      )}
      {webOpen && (
        <Dialog
          open
          onClose={() => setWebOpen(false)}
          label={copy.readWebpage}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
        >
          <DialogOverlay />
          <DialogContent className="flex w-full max-w-lg flex-col gap-4 rounded-2xl p-4 sm:p-6">
            <h2 className="font-semibold">{copy.readWebpage}</h2>
            <p className="text-sm text-muted-foreground">
              {copy.webpageNotice}
            </p>
            <label className="space-y-2 text-sm">
              <span>{copy.webpageUrl}</span>
              <Input
                type="url"
                value={webUrl}
                onChange={(event) => setWebUrl(event.target.value)}
                placeholder="https://example.com/article"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    readWebpage();
                  }
                }}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setWebOpen(false)}>
                {copy.close}
              </Button>
              <Button type="button" disabled={disabled || !webUrl.trim()} onClick={readWebpage}>
                {copy.readWebpage}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
