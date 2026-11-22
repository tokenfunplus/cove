import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogOverlay } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModelBrandIcon } from "@/components/providers/ModelBrandIcon";
import type { ActiveModelSet } from "@/components/providers/model-selection";
import type { GenerationBatch, ProviderProfile } from "@cove/api-contract";

export function EditPromptDialog({
  batch,
  body,
  targets,
  profiles,
  onClose,
  onSubmit,
  busy = false,
  error,
  onCancelSubmission,
}: {
  batch: GenerationBatch;
  body: string;
  targets: ActiveModelSet;
  profiles: ProviderProfile[];
  onClose: () => void;
  onSubmit: (body: string, targets: ActiveModelSet) => void;
  busy?: boolean;
  error?: string;
  onCancelSubmission?: () => void;
}) {
  const [text, setText] = useState(body);
  const [selected, setSelected] = useState(() =>
    targets.map((target) => JSON.stringify(target)),
  );
  useEffect(() => {
    if (text === body) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [text, body]);
  const chosen = targets.filter((target) =>
    selected.includes(JSON.stringify(target)),
  );
  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      label="Edit prompt and branch"
      className="fixed inset-0 z-70 grid place-items-center p-4"
    >
      <DialogOverlay />
      <DialogContent className="relative z-10 grid max-h-[85dvh] w-[min(660px,calc(100vw-32px))] gap-4 overflow-y-auto rounded-2xl border border-border bg-popover p-5 text-sm text-popover-foreground shadow-popover">
        <h2 className="font-semibold">Edit prompt and branch</h2>
        <p className="text-xs text-muted-foreground">
          This creates a separate conversation using this turn's saved context
          and attachments. The original conversation is retained. Your current
          System Prompt and generation settings apply.
        </p>
        <label className="grid gap-2">
          Edited prompt
          <Textarea
            autoFocus
            className="min-h-36"
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        {!!batch.attachments?.length && (
          <p className="text-xs text-muted-foreground">
            Reusing saved attachments:{" "}
            {batch.attachments.map((item) => item.name).join(", ")}
          </p>
        )}
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-xs font-medium">Models to run</legend>
          {targets.map((target) => {
            const key = JSON.stringify(target);
            return (
              <label
                key={key}
                className="flex min-w-0 items-center gap-2 text-xs"
              >
                <Checkbox

                  disabled={busy}
                  checked={selected.includes(key)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      (checked === true)
                        ? [...current, key]
                        : current.filter((item) => item !== key),
                    )
                  }
                />
                <ModelBrandIcon modelId={target.modelId} className="size-4" />
                <span className="break-all">
                  {
                    profiles.find((profile) => profile.id === target.providerId)
                      ?.name
                  }{" "}
                  · {target.modelId}
                </span>
              </label>
            );
          })}
        </fieldset>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={busy ? onCancelSubmission : onClose}
            disabled={busy && !onCancelSubmission}
          >
            {busy ? "Stop submission" : "Cancel"}
          </Button>
          <Button
            disabled={busy || !text.trim() || !chosen.length}
            onClick={() => onSubmit(text.trim(), chosen)}
          >
            Send in new branch
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
