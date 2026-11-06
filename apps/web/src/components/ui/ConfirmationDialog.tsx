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

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  onCancel,
  onConfirm,
  copy = englishConversationCopy,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  copy?: ApplicationCopy;
}) {
  return (
    <Dialog
      className={cn(settingsStyles.conversationDialog, "confirmation-dialog")}
      onClose={onCancel}
      open={open}
    >
      <DialogOverlay className={settingsStyles.conversationDialog_backdrop} />
      <div className={settingsStyles.conversationDialog_viewport}>
        <DialogContent
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
              autoFocus={destructive}
              onClick={onCancel}
              type="button"
            >
              {copy.cancel}
            </Button>
            <Button
              variant="outline"
              autoFocus={!destructive}
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
