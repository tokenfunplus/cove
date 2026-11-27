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
      onClose={() => {
        if (!busy) close();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <DialogOverlay />
      <DialogContent
        className="study-dialog relative max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl p-6 sm:p-8"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="mb-6 flex items-center justify-between gap-4">
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
        {children}
      </DialogContent>
    </Dialog>
  );
}
