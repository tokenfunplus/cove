import * as api from "@/api";
import { providerKeys } from "@/api/queryKeys";
import type { ProviderProfile } from "@cove/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function providerCatalogQueryOptions(id: string) {
  return {
    queryKey: providerKeys.catalog(id),
    queryFn: () => api.getProviderCatalog(id),
    enabled: Boolean(id),
  };
}

export function useProviders() {
  return useQuery({
    queryKey: providerKeys.list,
    queryFn: api.getProviderProfiles,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useSaveProvider() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: api.saveProviderProfile,
    retry: false,
    onSuccess: (saved) => {
      cache.setQueryData<ProviderProfile[]>(
        providerKeys.list,
        (current = []) => [
          saved,
          ...current.filter((profile) => profile.id !== saved.id),
        ],
      );
      return cache.invalidateQueries({
        queryKey: providerKeys.catalog(saved.id),
      });
    },
  });
}

export function useTestProviderConnection() {
  return useMutation({ mutationFn: api.testProviderConnection, retry: false });
}

export function useDeleteProvider() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: api.deleteProviderProfile,
    retry: false,
    onSuccess: (_, id) => {
      cache.setQueryData<ProviderProfile[]>(providerKeys.list, (current = []) =>
        current.filter((profile) => profile.id !== id),
      );
      cache.removeQueries({ queryKey: providerKeys.catalog(id), exact: true });
    },
  });
}

export function useDeleteProviderKey() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: api.deleteProviderKey,
    retry: false,
    onSuccess: (_, id) => {
      cache.setQueryData<ProviderProfile[]>(providerKeys.list, (current = []) =>
        current.map((profile) =>
          profile.id === id ? { ...profile, configured: false } : profile,
        ),
      );
      cache.removeQueries({ queryKey: providerKeys.catalog(id), exact: true });
    },
  });
}
