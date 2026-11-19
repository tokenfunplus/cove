import { searchConversations } from "@/api";
import { conversationKeys } from "@/api/queryKeys";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ConversationSearchFilter } from "@cove/api-contract";

export function useConversationSearch(query: string, archived: boolean, ready: boolean, filters?: ConversationSearchFilter) {
  const normalized = query.trim();
  const [debounced, setDebounced] = useState(normalized);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(normalized), 200);
    return () => window.clearTimeout(timeout);
  }, [normalized]);
  const search = useQuery({
    queryKey: conversationKeys.search(debounced, archived, filters),
    queryFn: ({ signal }) => filters ? searchConversations(debounced, archived, signal, filters) : searchConversations(debounced, archived, signal),
    enabled: ready && Boolean(debounced),
    retry: false,
    gcTime: 30_000,
    refetchOnWindowFocus: false,
  });
  return {
    results: search.data ?? [],
    pending: Boolean(normalized) && (normalized !== debounced || search.isPending),
    failed: normalized === debounced && search.isError,
  };
}
