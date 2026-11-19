import * as api from "@/api/debates";
import { conversationKeys, debateKeys } from "@/api/queryKeys";
import type {
  DebateAction,
  DebateControls,
  DebateRules,
  StartDebateInput,
  Conversation,
} from "@cove/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useDebateBrowserTurns } from "@/hooks/debate/use-debate-browser-turns";

export function useCreateDebate() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (input: StartDebateInput) => api.createDebate(input),
    retry: false,
    onSuccess: () =>
      cache.invalidateQueries({ queryKey: conversationKeys.lists }),
  });
}

export function useDebate(id: string, before = 0) {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: debateKeys.detail(id, before),
    queryFn: () => api.getDebate(id, before),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.data?.session.status === "stopped" ? false : 5000,
  });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void api.watchDebate(id, controller.signal, () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void cache.invalidateQueries({ queryKey: debateKeys.session(id) });
      }, 200);
    });
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, cache]);
  const refresh = () =>
    cache.invalidateQueries({ queryKey: debateKeys.session(id) });
  const session = query.data?.session;
  useEffect(() => {
    if (!session) return;
    cache.setQueriesData<Conversation[]>({ queryKey: conversationKeys.lists }, items =>
      items?.some(item => item.id === session.id) ? items.map(item => item.id === session.id ? { ...item, debate_id: session.id, debate_status: session.status, debate_round: session.round, updated_at: session.updated_at } : item) : items,
    );
  }, [cache, session?.id, session?.status, session?.round, session?.updated_at]);
  // Pagination changes the reader, never the browser worker's current request.
  const latest = useQuery({
    queryKey: debateKeys.detail(id, 0),
    queryFn: () => api.getDebate(id),
    enabled: before > 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: before > 0 ? 5000 : false,
  });
  const cancelBrowserTurns = useDebateBrowserTurns(id, before ? latest.data : query.data, () => { void refresh(); });
  const control = useMutation({
    mutationFn: (action: DebateAction) => api.controlDebate(id, action),
    retry: false,
    onMutate: (action) => { if (action === "stop") cancelBrowserTurns(); },
    onSuccess: () => Promise.all([refresh(), cache.invalidateQueries({ queryKey: conversationKeys.lists })]),
  });
  const rules = useMutation({
    mutationFn: (next: DebateRules) => api.updateDebateRules(id, next),
    retry: false,
    onSuccess: refresh,
  });
  const intervention = useMutation({
    mutationFn: (input: { client_request_id: string; body: string }) =>
      api.addDebateIntervention(id, input),
    retry: false,
    onSuccess: refresh,
  });
  const controls = useMutation({
    mutationFn: (next: DebateControls) => api.updateDebateControls(id, next),
    retry: false,
    onSuccess: refresh,
  });
  return { ...query, liveData: before ? latest.data : query.data, control, rules, intervention, controls };
}
