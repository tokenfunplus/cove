import { getSession } from "@/api";
import { sessionKey } from "@/api/queryKeys";
import { useQuery } from "@tanstack/react-query";

export function useLocalSession() {
  return useQuery({
    queryKey: sessionKey,
    // The proof stays inside the HTTP client; query data contains readiness only.
    queryFn: async () => Boolean((await getSession()).csrf_token),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
