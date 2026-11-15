import * as api from "@/api";
import { providerKeys } from "@/api/queryKeys";
import type { ProviderProfile } from "@cove/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function providerCatalogQueryOptions(id: string) {
  return {
    queryKey: providerKeys.catalog(id),
    queryFn: () => api.getProviderCatalog(id),
    enabled: Boolean(id),
    // Discovery may require a macOS Keychain authorization. Returning from its
    // dialog must not start another read, nor should a denial trigger retries.
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 5 * 60 * 1000,
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
  const cache = useQueryClient();
  return useMutation({
    mutationFn: api.testProviderConnection,
    retry: false,
    onSuccess: (_result, input) => {
      // An explicit successful test can recover a catalog whose automatic
      // read was denied. Draft keys are not saved by a connection test.
      if (input.id && !input.secret)
        return cache.invalidateQueries({
          queryKey: providerKeys.catalog(input.id),
          exact: true,
        });
    },
  });
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
