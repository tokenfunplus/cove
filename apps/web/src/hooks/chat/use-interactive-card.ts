import { useEffect, useId, useRef, useState } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { CardRun, CardValues } from "@cove/api-contract";
import { setInteractiveDraftDirty } from "@/lib/chat/interactive-drafts";
import {
  registerCardController,
  type PreparedCardReference,
} from "@/lib/chat/interactive-context";
import { loadInteractiveCard, saveInteractiveCard } from "@/api/interactive";

export function interactiveCardQuery(client: QueryClient, id: string) {
  const queryKey = ["interactive-card", id];
  return {
    queryKey,
    queryFn: async () => {
      const loaded = await loadInteractiveCard(id);
      const cached = client.getQueryData<CardRun>(queryKey);
      return cached && cached.revision > loaded.revision ? cached : loaded;
    },
    retry: false as const,
    refetchOnWindowFocus: "always" as const,
  };
}

export function useInteractiveCard(id: string, questionDirty = false) {
  const token = useId();
  const mounted = useRef(true);
  const questionDirtyRef = useRef(questionDirty);
  questionDirtyRef.current = questionDirty;
  const client = useQueryClient();
  const key = ["interactive-card", id];
  const query = useQuery(interactiveCardQuery(client, id));
  const [draft, setDraft] = useState<
    { values: CardValues; checks: Record<string, string> } | undefined
  >();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [preparations, setPreparations] = useState(0);
  const server = useRef<CardRun | undefined>(undefined);
  const current = useRef(draft);
  current.current = draft;
  const version = useRef(0);
  const acknowledged = useRef(0);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setInteractiveDraftDirty(token, false);
    };
  }, [token]);
  useEffect(() => {
    if (
      query.data &&
      version.current === acknowledged.current &&
      (!server.current || query.data.revision >= server.current.revision)
    ) {
      server.current = query.data;
      setDraft({ values: query.data.values, checks: query.data.checks });
    }
  }, [query.data]);
  function edit(values: CardValues, checks: Record<string, string>) {
    version.current++;
    const next = { values, checks };
    current.current = next;
    setDraft(next);
    setError(undefined);
    setInteractiveDraftDirty(token, true);
  }
  function flush() {
    const operation = queue.current.then(async () => {
      const latest = current.current;
      const saved = server.current;
      const revision = version.current;
      if (!latest || !saved || revision === acknowledged.current) return saved;
      setSaving(true);
      try {
        await client.cancelQueries({ queryKey: key, exact: true });
        const next = await saveInteractiveCard({
          generation_id: id,
          revision: saved.revision,
          ...latest,
        });
        server.current = next;
        acknowledged.current = revision;
        if (mounted.current) {
          setInteractiveDraftDirty(
            token,
            version.current !== acknowledged.current ||
              questionDirtyRef.current,
          );
          if (client.getQueryData(key)) client.setQueryData(key, next);
        }
        setError(undefined);
        return next;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save this card.");
        throw e;
      } finally {
        setSaving(false);
      }
    });
    queue.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
  useEffect(() => {
    if (!draft || version.current === acknowledged.current) return;
    void flush().catch(() => undefined);
  }, [draft]);
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => {
      if (
        version.current !== acknowledged.current ||
        questionDirtyRef.current
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  useEffect(() => {
    setInteractiveDraftDirty(
      token,
      version.current !== acknowledged.current || questionDirty,
    );
    return () => setInteractiveDraftDirty(token, false);
  }, [questionDirty, token]);
  async function reload() {
    await queue.current;
    await client.cancelQueries({ queryKey: key, exact: true });
    const loaded = await loadInteractiveCard(id);
    const next =
      server.current && loaded.revision < server.current.revision
        ? server.current
        : loaded;
    version.current = 0;
    acknowledged.current = 0;
    server.current = next;
    setDraft({ values: next.values, checks: next.checks });
    client.setQueryData(key, next);
    setError(undefined);
    setInteractiveDraftDirty(token, questionDirtyRef.current);
  }
  const prepare = useRef<() => Promise<PreparedCardReference>>(async () => {
    throw new Error("The card is loading.");
  });
  prepare.current = async () => {
    setPreparations((n) => n + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (mounted.current) setPreparations((n) => Math.max(0, n - 1));
    };
    try {
      const saved = await flush();
      if (!saved || !saved.can_continue || saved.submitted_batch_id)
        throw new Error(
          "This card is no longer the current answer. Remove its reference to send an ordinary message.",
        );
      return {
        ...structuredClone({
          generation_id: id,
          revision: saved.revision,
          values: saved.values,
          checks: saved.checks,
        }),
        release,
      };
    } catch (error) {
      release();
      throw error;
    }
  };
  useEffect(
    () => registerCardController(id, token, () => prepare.current()),
    [id, token],
  );
  return {
    run: server.current ?? query.data,
    draft,
    edit,
    flush,
    reload,
    error,
    loading: query.isPending,
    loadError: query.error,
    saving,
    preparing: preparations > 0,
    dirty: version.current !== acknowledged.current,
  };
}
