import { useQuery, useMutation } from "@tanstack/react-query";
import { miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "./presentation";

export function MacSelection({
  instance,
  view,
  open,
}: {
  instance: string;
  view: string;
  open: (id: string, initial: Record<string, string>) => void;
}) {
  const receipt = new URLSearchParams(window.location.search).get("selection") ?? "";
  const pending = useQuery({
    queryKey: ["mini-app-selection", instance, view, receipt],
    queryFn: () => miniApps.nativeSelection(instance, view, receipt),
    refetchOnWindowFocus: "always",
    staleTime: 0,
  });
  const item = pending.data?.target;
  const take = useMutation({
    mutationFn: (selection: { id: string; action: string; field: string }) =>
      miniApps.takeNativeSelection(instance, selection.id),
    onSuccess: async ({ text }, selection) => {
      open(selection.action, { [selection.field]: text });
      await pending.refetch();
    },
  });
  if (!item || item.view !== view || !pending.data?.id) return null;
  return (
    <div>
      <Button
        size="sm"
        disabled={take.isPending}
        onClick={() =>
          take.mutate({
            id: pending.data!.id!,
            action: item.action,
            field: item.field,
          })
        }
      >
        Use Mac selection in {item.title} · {item.field}
      </Button>
      <ErrorMessage error={take.error} />
    </div>
  );
}
