import { useEffect, useState } from "react";

const storagePrefix = "cove.timeline.bookmarks.";

function readBookmarks(conversationId: string) {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(storagePrefix + conversationId) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Persist references only. Message content continues to belong to Conversation History. */
export function useTimelineBookmarks(conversationId: string) {
  const [state, setState] = useState(() => ({ conversationId, ids: readBookmarks(conversationId), sessionOnly: false }));
  useEffect(() => {
    const load = () => setState({ conversationId, ids: readBookmarks(conversationId), sessionOnly: false });
    load();
    const onStorage = (event: StorageEvent) => {
      if (event.key === storagePrefix + conversationId || event.key === null) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [conversationId]);

  const ids = state.conversationId === conversationId ? state.ids : [];
  function toggleBookmark(id: string) {
    const next = ids.includes(id) ? ids.filter((saved) => saved !== id) : [...ids, id];
    let sessionOnly = false;
    try {
      if (next.length) window.localStorage.setItem(storagePrefix + conversationId, JSON.stringify(next));
      else window.localStorage.removeItem(storagePrefix + conversationId);
    } catch {
      sessionOnly = true;
    }
    setState({ conversationId, ids: next, sessionOnly });
  }
  return { bookmarkedIds: new Set(ids), toggleBookmark, sessionOnly: state.sessionOnly };
}
