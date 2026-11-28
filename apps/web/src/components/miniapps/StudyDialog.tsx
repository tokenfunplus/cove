import type { ReactNode } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function StudyDialog({
  title,
  close,
  children,
  busy = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  return (
    <Dialog
      open
      layer="study"
      onClose={() => {
        if (!busy) close();
      }}
      className="fixed inset-0 flex min-h-0 items-center justify-center p-3 sm:p-4"
    >
      <DialogOverlay />
      <DialogContent
        className="study-dialog relative flex max-h-full min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4 sm:px-8">
          <DialogTitle className="text-2xl font-semibold tracking-tight">
            {title}
          </DialogTitle>
          <Button
            size="icon"
            variant="ghost"
            disabled={busy}
            aria-label="Close dialog"
            onClick={close}
          >
            <X className="size-5" />
          </Button>
        </div>
        <div className="study-dialog-body min-h-0 overflow-y-auto overscroll-contain p-6 sm:p-8">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
