import { searchConversations } from "@/api";
import { conversationKeys } from "@/api/queryKeys";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export function useConversationSearch(query: string, archived: boolean, ready: boolean) {
  const normalized = query.trim();
  const [debounced, setDebounced] = useState(normalized);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(normalized), 200);
    return () => window.clearTimeout(timeout);
  }, [normalized]);
  const search = useQuery({
    queryKey: conversationKeys.search(debounced, archived),
    queryFn: ({ signal }) => searchConversations(debounced, archived, signal),
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
