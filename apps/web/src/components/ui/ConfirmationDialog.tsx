import { settingsStyles } from "@/styles/settings";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";
import {
  Dialog,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { TriangleAlert } from "lucide-react";
import { useRef } from "react";

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  busy = false,
  onCancel,
  onConfirm,
  copy = englishConversationCopy,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  copy?: ApplicationCopy;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      layer="confirmation"
      className={cn(settingsStyles.conversationDialog, "confirmation-dialog")}
      onClose={() => { if (!busy) onCancel(); }}
      open={open}
    >
      <DialogOverlay className={settingsStyles.conversationDialog_backdrop} />
      <div className={settingsStyles.conversationDialog_viewport}>
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (destructive ? cancel : confirm).current?.focus();
          }}
          className={cn(
            settingsStyles.conversationDialog_panel,
            "confirmation-dialog__panel",
          )}
        >
          <div
            className={settingsStyles.confirmationDialog_icon}
            aria-hidden="true"
          >
            <TriangleAlert size={20} strokeWidth={1.8} />
          </div>
          <DialogTitle as="h2">{title}</DialogTitle>
          <p>{description}</p>
          <div className={settingsStyles.conversationDialog_actions}>
            <Button
              variant="outline"
              ref={cancel}
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              {cancelLabel ?? copy.cancel}
            </Button>
            <Button
              variant="outline"
              ref={confirm}
              disabled={busy}
              aria-busy={busy}
              className={cn(
                settingsStyles.confirmationDialog_confirm,
                destructive
                  ? "confirmation-dialog__confirm confirmation-dialog__confirm--danger"
                  : "confirmation-dialog__confirm",
              )}
              onClick={onConfirm}
              type="button"
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogContent>
      </div>
    </Dialog>
  );
}
