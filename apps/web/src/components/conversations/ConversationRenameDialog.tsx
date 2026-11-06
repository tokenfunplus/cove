import { settingsStyles } from "@/styles/settings";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";
import { type Conversation } from "@cove/api-contract";
import {
  Dialog,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEffect, useState } from "react";

export function ConversationRenameDialog({
  conversation,
  isSaving,
  onClose,
  onSave,
  copy = englishConversationCopy,
}: {
  conversation: Conversation | undefined;
  isSaving: boolean;
  onClose: () => void;
  onSave: (title: string) => void;
  copy?: ApplicationCopy;
}) {
  const [title, setTitle] = useState(conversation?.title ?? "");
  useEffect(
    () => setTitle(conversation?.title ?? ""),
    [conversation?.id, conversation?.title],
  );

  return (
    <Dialog
      className={settingsStyles.conversationDialog}
      onClose={onClose}
      open={Boolean(conversation)}
    >
      <DialogOverlay className={settingsStyles.conversationDialog_backdrop} />
      <div className={settingsStyles.conversationDialog_viewport}>
        <DialogContent className={settingsStyles.conversationDialog_panel}>
          <DialogTitle as="h2">{copy.renameConversation}</DialogTitle>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim()) onSave(title);
            }}
          >
            <label htmlFor="conversation-title">{copy.conversationTitle}</label>
            <Input
              autoFocus
              disabled={isSaving}
              id="conversation-title"
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
            <div className={settingsStyles.conversationDialog_actions}>
              <Button
                variant="outline"
                disabled={isSaving}
                onClick={onClose}
                type="button"
              >
                {copy.cancel}
              </Button>
              <Button
                variant="default"
                disabled={isSaving || !title.trim()}
                type="submit"
              >
                {isSaving ? copy.saving : copy.saveTitle}
              </Button>
            </div>
          </form>
        </DialogContent>
      </div>
    </Dialog>
  );
}
