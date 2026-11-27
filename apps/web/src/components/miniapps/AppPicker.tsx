import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppDirectory } from "./AppDirectory";
import { AppWorkspace, type AppContext } from "./AppWorkspace";

export default function AppPicker({
  close,
  initialInstance,
  introduction,
  ...context
}: AppContext & {
  close: () => void;
  initialInstance?: string;
  introduction?: ReactNode;
}) {
  const [location, setLocation] = useState<
    { id: string; view?: string } | undefined
  >(() => (initialInstance ? { id: initialInstance } : undefined));
  const open = useCallback(
    (id: string, view?: string) => setLocation({ id, view }),
    [],
  );
  return (
    <Dialog
      open
      onClose={close}
      className="fixed inset-0 z-[100] flex min-h-0 items-center justify-center p-2 sm:p-5"
    >
      <DialogOverlay />
      <DialogContent className="flex max-h-full min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
          <DialogTitle>Mini Apps</DialogTitle>
          <Button onClick={close} variant="ghost" size="sm">
            Done
          </Button>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4">
          {introduction}
          {location ? (
            <AppWorkspace
              key={location.id}
              {...location}
              {...context}
              navigate={open}
              back={() => setLocation(undefined)}
            />
          ) : (
            <AppDirectory open={open} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
