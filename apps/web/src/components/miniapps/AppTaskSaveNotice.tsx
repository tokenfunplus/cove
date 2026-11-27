import { useMutation, useQueryClient } from "@tanstack/react-query";
import { miniApps, type AppTask } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "./presentation";

export function taskNeedsSave(
  task: Pick<AppTask, "state" | "pending_save"> | null | undefined,
) {
  return task?.pending_save === true || task?.state === "save_failed";
}

export function taskSavePendingError(error: unknown) {
  return (
    (error as { envelope?: { error?: { code?: string } } } | null)?.envelope
      ?.error?.code === "task_save_pending"
  );
}

export function AppTaskSaveNotice({
  instance,
  task,
  onSaved,
}: {
  instance: string;
  task: string;
  onSaved?: () => void;
}) {
  const cache = useQueryClient();
  const retry = useMutation({
    retry: false,
    mutationFn: () => miniApps.retryTaskSave(instance, task),
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({
          queryKey: ["mini-app-task", instance, task],
        }),
        cache.invalidateQueries({
          queryKey: ["mini-app-proposal", instance, task],
        }),
        cache.invalidateQueries({ queryKey: ["mini-app-tasks", instance] }),
        cache.invalidateQueries({
          queryKey: ["mini-app-latest-proposal", instance],
        }),
        cache.invalidateQueries({ queryKey: ["mini-app-activity", instance] }),
        cache.invalidateQueries({ queryKey: ["mini-app-host-activity"] }),
      ]);
      onSaved?.();
    },
  });
  return (
    <section
      aria-label="Unsaved task result"
      className="space-y-3 rounded-xl border border-border bg-muted/60 p-4 text-sm"
    >
      <div role="status" className="space-y-1.5">
        <p className="font-semibold">This result still needs saving.</p>
        <p className="leading-relaxed text-muted-foreground">
          Cove could not save the task's final result. Retrying saves the same
          result without running the model again.
        </p>
        <p className="leading-relaxed text-muted-foreground">
          Keep Cove open. If you quit before saving, this unsaved result will be
          lost.
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={retry.isPending}
        onClick={() => retry.mutate()}
      >
        {retry.isPending ? "Saving result…" : "Retry saving result"}
      </Button>
      <ErrorMessage error={retry.error} />
    </section>
  );
}

export function AppTaskSaveBlockedNotice({ error }: { error: unknown }) {
  if (!taskSavePendingError(error)) return null;
  return (
    <p role="alert" className="text-sm leading-relaxed text-muted-foreground">
      An app result is waiting to be saved. Open Mini Apps, choose Activity and
      retry saving it before starting another app task.{" "}
      <a
        className="font-medium text-primary underline underline-offset-4"
        href="cove://apps"
      >
        Open Mini Apps
      </a>
    </p>
  );
}
