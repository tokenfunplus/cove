import * as api from "@/api";
import { settingsKey } from "@/api/queryKeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: api.getSettings,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateSettings() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: api.updateSettings,
    retry: false,
    onSuccess: (settings) => {
      cache.setQueryData(settingsKey, settings);
    },
  });
}
