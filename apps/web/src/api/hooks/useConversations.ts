import * as api from "@/api";
import { conversationKeys, debateKeys, generationKeys } from "@/api/queryKeys";
import type { ConversationUpdateInput } from "@cove/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

function conversationListOptions(archived = false) {
  return {
    queryKey: conversationKeys.list(archived),
    queryFn: () => api.getConversations({ archived }),
    retry: false as const,
  };
}

export function useConversations(archived = false) {
  const cache = useQueryClient();
  const previousDebateMetadata = useRef<string | undefined>(undefined);
  const query = useQuery({
    ...conversationListOptions(archived),
    refetchOnWindowFocus: true,
    refetchInterval: query => query.state.data?.some(item => item.debate_status === "running" || item.debate_status === "pausing") ? 3000 : query.state.data?.some(item => item.debate_id) ? 15000 : false,
  });
  const debateMetadata = query.data?.filter(item => item.debate_id).map(item => `${item.id}:${item.debate_status}:${item.debate_round}:${item.updated_at}`).join("|");
  useEffect(() => {
    if (debateMetadata === undefined) return;
    if (previousDebateMetadata.current !== undefined && previousDebateMetadata.current !== debateMetadata) {
      // A state or activity change can alter both badges and filtered membership.
      void cache.invalidateQueries({ queryKey: conversationKeys.searches });
    }
    previousDebateMetadata.current = debateMetadata;
  }, [cache, debateMetadata]);
  return query;
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: conversationKeys.detail(id),
    queryFn: () => api.getConversation(id!),
    enabled: Boolean(id),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useCreateConversation() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) => api.createConversation(title),
    retry: false,
    onSuccess: () =>
      cache.invalidateQueries({ queryKey: conversationKeys.lists }),
  });
}

export function useRenameConversation() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.renameConversation(id, title),
    retry: false,
    onSuccess: (_, { id }) =>
      Promise.all([
        cache.invalidateQueries({ queryKey: conversationKeys.lists }),
        cache.invalidateQueries({ queryKey: conversationKeys.detail(id) }),
      ]),
  });
}

export function useUpdateConversation() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: ConversationUpdateInput;
    }) => api.updateConversation(id, input),
    retry: false,
    onSuccess: (_, { id }) =>
      Promise.all([
        cache.invalidateQueries({ queryKey: conversationKeys.lists }),
        cache.invalidateQueries({ queryKey: conversationKeys.detail(id) }),
      ]),
  });
}

export function useDeleteConversation() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: api.deleteConversation,
    retry: false,
    onSuccess: (_, id) => {
      cache.removeQueries({
        queryKey: conversationKeys.detail(id),
        exact: true,
      });
      cache.removeQueries({ queryKey: generationKeys.all });
      cache.removeQueries({ queryKey: debateKeys.session(id) });
      return cache.invalidateQueries({ queryKey: conversationKeys.lists });
    },
  });
}

export function useClearChatData() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: api.clearChatData,
    retry: false,
    onSuccess: async () => {
      await cache.cancelQueries({ queryKey: conversationKeys.all });
      await cache.cancelQueries({ queryKey: generationKeys.all });
      await cache.cancelQueries({ queryKey: debateKeys.all });
      cache.removeQueries({ queryKey: conversationKeys.all });
      cache.removeQueries({ queryKey: generationKeys.all });
      cache.removeQueries({ queryKey: debateKeys.all });
      cache.setQueryData(conversationKeys.list(false), []);
      cache.setQueryData(conversationKeys.list(true), []);
    },
  });
}

// Event-driven refreshes also populate the same keys used by mounted queries.
export function useConversationCache() {
  const cache = useQueryClient();
  return {
    loadConversation: async (id: string) => {
      const view = await cache.fetchQuery({
        queryKey: conversationKeys.detail(id),
        queryFn: () => api.getConversation(id),
        staleTime: 0,
        retry: false,
      });
      // Refresh visible searches alongside authoritative detail reconciliation.
      void cache.invalidateQueries({ queryKey: conversationKeys.searches });
      return view;
    },
    loadConversations: (options: { archived?: boolean } = {}) =>
      cache.fetchQuery({
        ...conversationListOptions(options.archived),
        staleTime: 0,
      }),
  };
}
