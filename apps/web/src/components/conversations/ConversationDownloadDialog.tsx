import { settingsStyles } from "@/styles/settings";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type ConversationExportFormat } from "@/lib/conversation-export";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";
import { type ConversationView } from "@cove/api-contract";
import {
  Dialog,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

export function ConversationDownloadDialog({
  conversation,
  onClose,
  onDownload,
  copy = englishConversationCopy,
}: {
  conversation: ConversationView | undefined;
  onClose: () => void;
  onDownload: (format: ConversationExportFormat) => void;
  copy?: ApplicationCopy;
}) {
  return (
    <Dialog
      className={settingsStyles.conversationDialog}
      onClose={onClose}
      open={Boolean(conversation)}
    >
      <DialogOverlay className={settingsStyles.conversationDialog_backdrop} />
      <div className={settingsStyles.conversationDialog_viewport}>
        <DialogContent className={settingsStyles.conversationDialog_panel}>
          <DialogTitle as="h2">{copy.downloadConversation}</DialogTitle>
          <p>{copy.downloadConversationHint}</p>
          <div
            className={cn(
              settingsStyles.conversationDialog_actions,
              "conversation-dialog__actions--download",
            )}
          >
            <Button
              variant="outline"
              onClick={() => onDownload("markdown")}
              type="button"
            >
              {copy.downloadAsMarkdown}
            </Button>
            <Button
              variant="outline"
              onClick={() => onDownload("json")}
              type="button"
            >
              {copy.downloadAsJSON}
            </Button>
            <Button variant="outline" onClick={onClose} type="button">
              {copy.cancel}
            </Button>
          </div>
        </DialogContent>
      </div>
    </Dialog>
  );
}
