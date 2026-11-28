import { useEffect, useState } from "react";
import { navigateWorkspace } from "@/lib/workspace-navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { miniApps, type AppTask } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "./presentation";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";

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
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["mini-app-task", instance, task] }),
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
  };
  const retry = useMutation({
    retry: false,
    mutationFn: () => miniApps.retryTaskSave(instance, task),
    onSuccess: refresh,
  });
  const discard = useMutation({
    retry: false,
    mutationFn: () => miniApps.discardTaskResult(instance, task),
    onError: () => setConfirmDiscard(false),
    onSuccess: async () => {
      setConfirmDiscard(false);
      await refresh();
    },
  });
  const busy = retry.isPending || discard.isPending;
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
        disabled={busy}
        onClick={() => retry.mutate()}
      >
        {retry.isPending ? "Saving result…" : "Retry saving result"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => setConfirmDiscard(true)}
      >
        Discard unsaved result
      </Button>
      <ErrorMessage error={retry.error} />
      <ErrorMessage error={discard.error} />
      <ConfirmationDialog
        open={confirmDiscard}
        title="Discard this unsaved result?"
        description="This removes only the unsaved model output and releases other app tasks. Saved records and attachments stay in place. The model will not run again."
        confirmLabel="Discard result"
        destructive
        busy={busy}
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => discard.mutate()}
      />
    </section>
  );
}

export function AppTaskSaveBlockedNotice({
  error,
  onCleared,
}: {
  error: unknown;
  onCleared?: () => void;
}) {
  const pending = taskSavePendingError(error);
  const activity = useQuery({
    queryKey: ["mini-app-host-activity"],
    queryFn: () => miniApps.hostActivity(),
    enabled: pending,
    retry: false,
    refetchInterval: pending ? 1500 : false,
  });
  const owner = activity.data?.activity.find(
    (item) => item.status === "save_failed",
  );
  useEffect(() => {
    if (pending && activity.isSuccess && !activity.isFetching && !owner)
      onCleared?.();
  }, [
    pending,
    activity.isSuccess,
    activity.isFetching,
    activity.dataUpdatedAt,
    owner,
    onCleared,
  ]);
  if (!pending) return null;
  return (
    <p role="alert" className="text-sm leading-relaxed text-muted-foreground">
      {owner
        ? `A result from ${owner.instance_name} is waiting to be saved. `
        : "An app result is waiting to be saved. "}
      Open Activity to retry saving or discard the unsaved output before
      starting another app task.{" "}
      <a
        className="font-medium text-primary underline underline-offset-4"
        href="/apps?section=activity"
        onClick={(event) => {
          if (
            event.button ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          navigateWorkspace("/apps?section=activity");
        }}
      >
        Open Activity
      </a>
    </p>
  );
}
