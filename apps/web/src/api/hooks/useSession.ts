import { getSession } from "@/api";
import { sessionKey } from "@/api/queryKeys";
import { appKeys } from "@/api/mini-apps";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export function useLocalSession() {
  const cache = useQueryClient();
  return useQuery({
    queryKey: sessionKey,
    // The proof stays inside the HTTP client; query data contains readiness only.
    queryFn: async () => {
      const session = await getSession();
      cache.setQueryData(appKeys.presence, session.has_mini_apps === true);
      return Boolean(session.csrf_token);
    },
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
