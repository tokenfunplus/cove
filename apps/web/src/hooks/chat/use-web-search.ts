import { useRef, useState } from "react";
import { getWebSearchSettings } from "@/api/web-search";
import type { WebSearchSettings } from "@cove/api-contract";

const preferenceKey = "cove.web-search-conversations.v1";
function preferences(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(preferenceKey) ?? "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).filter(([id, enabled]) => id.length < 200 && typeof enabled === "boolean").slice(-500));
  } catch { /* Unavailable browser preferences leave new chats off. */ }
  return {};
}

export function useWebSearch(conversationId: string | undefined, openSettings: (section: "web-search") => void, feedback: (message?: string, tone?: "error" | "info" | "success") => void) {
  const [choices, setChoices] = useState(preferences);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<WebSearchSettings>();
  const current = useRef(conversationId);
  current.current = conversationId;
  const pendingSetup = useRef<string | undefined>(undefined);
  const enabled = Boolean(conversationId && choices[conversationId]);
  function setEnabled(id: string, value: boolean) {
    setChoices(previous => {
      const next = { ...previous, [id]: value };
      try { localStorage.setItem(preferenceKey, JSON.stringify(Object.fromEntries(Object.entries(next).slice(-500)))); } catch { /* Keep the current window usable. */ }
      return next;
    });
  }
  async function toggle() {
    if (!conversationId || busy) return;
    pendingSetup.current = undefined;
    if (enabled) { setEnabled(conversationId, false); return; }
    setBusy(true);
    try {
      const result = await getWebSearchSettings();
      setSettings(result);
      if (current.current !== conversationId) return;
      if (!result.providers.some(item => item.provider === result.policy.provider && item.configured)) {
        pendingSetup.current = conversationId;
        feedback("Configure a search Provider to enable Web search. Your draft is saved in this window.", "info");
        openSettings("web-search");
      } else setEnabled(conversationId, true);
    } catch {
      if (current.current !== conversationId) return;
      pendingSetup.current = conversationId;
      feedback("Web search settings could not be loaded. Open Settings to configure a search Provider.");
      openSettings("web-search");
    } finally { setBusy(false); }
  }
  function configured(result: WebSearchSettings) {
    setSettings(result);
    if (current.current && !result.providers.some(item => item.provider === result.policy.provider && item.configured)) { setEnabled(current.current, false); return; }
    if (pendingSetup.current === current.current && current.current && result.providers.some(item => item.provider === result.policy.provider && item.configured)) {
      setEnabled(current.current, true);
      pendingSetup.current = undefined;
      feedback("Web search is on for this conversation.", "success");
    }
  }
  return { enabled, busy, toggle, configured, budgetLabel: (models: number) => settings ? `Web search on · up to ${settings.policy.max_searches * models} search requests across ${models} model${models === 1 ? "" : "s"}` : "Web search on · per-model limits in Settings" };
}
