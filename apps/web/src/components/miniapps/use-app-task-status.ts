import { useQuery } from "@tanstack/react-query";
import { miniApps, type AppTask } from "@/api/mini-apps";

export function useAppTaskStatus(
  instance: string,
  recent: AppTask | null | undefined,
  kind: "generation" | "proposal",
) {
  const id = recent?.id;
  const poll = useQuery({
    queryKey: [
      kind === "proposal" ? "mini-app-proposal" : "mini-app-task",
      instance,
      id,
    ],
    enabled: !!id,
    queryFn: () =>
      kind === "proposal"
        ? miniApps.proposal(instance, id!)
        : miniApps.task(instance, id!),
    retry: false,
    refetchInterval: (query) => {
      const state = query.state.data?.state ?? recent?.state;
      if (state !== "running") return false;
      const code = (
        query.state.error as { envelope?: { error?: { code?: string } } } | null
      )?.envelope?.error?.code;
      if (
        code === "invalid_session" ||
        code === "permission_denied" ||
        code === "not_found"
      )
        return false;
      return query.state.error ? 2000 : 700;
    },
  });
  return { poll, task: poll.data ?? recent };
}
