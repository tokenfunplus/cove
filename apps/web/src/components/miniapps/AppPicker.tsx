import { useCallback, useState } from "react";
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
  ...context
}: AppContext & { close: () => void }) {
  const [location, setLocation] = useState<{ id: string; view?: string }>();
  const open = useCallback(
    (id: string, view?: string) => setLocation({ id, view }),
    [],
  );
  return (
    <Dialog
      open
      onClose={close}
      className="fixed inset-0 z-[100] grid place-items-center p-2 sm:p-5"
    >
      <DialogOverlay />
      <DialogContent className="max-h-[94dvh] w-full max-w-2xl space-y-3 overflow-auto rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <DialogTitle>Mini Apps</DialogTitle>
          <Button onClick={close} variant="ghost" size="sm">
            Done
          </Button>
        </div>
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
      </DialogContent>
    </Dialog>
  );
}
