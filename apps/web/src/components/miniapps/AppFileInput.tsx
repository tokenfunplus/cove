import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "./presentation";

export function AppFileInput({
  instance,
  onChoose,
}: {
  instance: string;
  onChoose: (text: string) => void;
}) {
  const start = useMutation({
    retry: false,
    mutationFn: () => miniApps.startFile(instance),
  });
  const op = start.data;
  const file = useQuery({
    queryKey: ["mini-app-file", instance, op?.id],
    queryFn: () => miniApps.file(instance, op!.id),
    enabled: !!op,
    retry: false,
    refetchInterval: (q) =>
      q.state.status === "error" ||
      (q.state.data && q.state.data.state !== "pending")
        ? false
        : 800,
  });
  const reset = start.reset;
  useEffect(() => {
    if (
      op &&
      file.data?.state === "completed" &&
      typeof file.data.text === "string"
    ) {
      onChoose(file.data.text);
      reset();
    }
  }, [op, file.data, onChoose, reset]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {op && (!file.data || file.data.state === "pending") ? (
        <Button asChild size="xs" variant="outline">
          <a href={"cove://pick/" + encodeURIComponent(op.id)}>
            Open Mac file picker
          </a>
        </Button>
      ) : (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={start.isPending}
          onClick={() => start.mutate()}
        >
          Import text file
        </Button>
      )}
      {file.data?.state === "cancelled" && (
        <span role="status" className="text-xs">
          File selection cancelled.
        </span>
      )}
      {file.data?.state === "failed" && (
        <ErrorMessage error="The file could not be imported." />
      )}
      <ErrorMessage error={start.error ?? file.error} />
    </div>
  );
}
