import { useState } from "react";
import { usePreviewGenerationContext } from "@/api/hooks/useGenerations";
import { LocalServiceError } from "@/api";
import type { AttachmentDraft } from "@/hooks/chat/use-attachment-draft";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogOverlay } from "@/components/ui/dialog";
import { englishConversationCopy as copy } from "@/messages";
import { ListFilter } from "lucide-react";

export function DraftContext({
  conversationId,
  body,
  attachments,
  disabled,
  compact = false,
}: {
  conversationId: string;
  body: string;
  attachments: AttachmentDraft;
  disabled: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const preview = usePreviewGenerationContext();
  function review() {
    setOpen(true);
    preview.mutate({
      conversationId,
      body,
      attachments: attachments.attachments.flatMap((item) =>
        item.input ? [item.input] : [],
      ),
    });
  }
  const characters = (preview.data ?? []).reduce(
    (sum, item) => sum + Array.from(item.content).length,
    0,
  );
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={compact ? "icon-sm" : "sm"}
        className={compact ? "rounded-lg text-muted-foreground" : undefined}
        title={copy.reviewContext}
        disabled={disabled || attachments.invalid}
        onClick={review}
      >
        {compact && <ListFilter aria-hidden="true" size={16} />}
        <span className={compact ? "sr-only" : undefined}>{copy.reviewContext}</span>
      </Button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          label={copy.reviewContext}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
        >
          <DialogOverlay />
          <DialogContent className="flex max-h-[85dvh] w-full max-w-3xl flex-col gap-3 rounded-2xl p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{copy.reviewContext}</h2>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {copy.close}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {copy.draftContextNotice}
            </p>
            {preview.isPending && <p role="status">{copy.loading}</p>}
            {preview.isError && (
              <p role="alert">
                {preview.error instanceof LocalServiceError
                  ? preview.error.envelope.error.message
                  : copy.contextLoadFailed}
              </p>
            )}
            {preview.isSuccess && (
              <>
                <p className="text-sm">
                  {characters.toLocaleString()} / 240,000 {copy.characters} ·{" "}
                  {copy.contextBudgetNotice}
                </p>
                <div
                  className="min-h-0 space-y-4 overflow-auto"
                  tabIndex={0}
                  aria-label={copy.reviewContext}
                >
                  {preview.data.map((item, index) => (
                    <div key={index}>
                      <p className="mb-1 text-sm font-semibold capitalize">
                        {item.role}
                      </p>
                      <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono text-xs [overflow-wrap:anywhere]">
                        {item.content}
                      </pre>
                    </div>
                  ))}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
