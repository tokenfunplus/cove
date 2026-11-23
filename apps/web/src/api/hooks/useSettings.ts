import * as api from "@/api";
import { settingsKey } from "@/api/queryKeys";
import { useMutation, useQuery } from "@tanstack/react-query";

export function useSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: api.getSettings,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateSettings() {
  // Cache publication belongs to the caller so it can discard superseded saves.
  return useMutation({
    mutationFn: api.updateSettings,
    retry: false,
  });
}
