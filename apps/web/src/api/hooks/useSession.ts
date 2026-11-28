import { getSession } from "@/api";
import { sessionKey } from "@/api/queryKeys";
import { appKeys } from "@/api/mini-apps";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  miniAppInventoryRevision,
  observeMiniAppInventoryChanges,
} from "@/lib/mini-app-inventory";

export function useLocalSession() {
  const cache = useQueryClient();
  useEffect(
    () =>
      observeMiniAppInventoryChanges(() => {
        // Wake dormant discovery after an actual mutation in this or another tab.
        // Discovery replaces this hint with the authoritative inventory response.
        cache.setQueryData(appKeys.presence, true);
        void cache.invalidateQueries({ queryKey: appKeys.instances });
        void cache.invalidateQueries({ queryKey: appKeys.releases });
      }),
    [cache],
  );
  return useQuery({
    queryKey: sessionKey,
    // The proof stays inside the HTTP client; query data contains readiness only.
    queryFn: async () => {
      const revision = miniAppInventoryRevision();
      const session = await getSession();
      if (revision === miniAppInventoryRevision())
        cache.setQueryData(appKeys.presence, session.has_mini_apps ?? null);
      return Boolean(session.csrf_token);
    },
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
