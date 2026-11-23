import { observeBrowserSessionExpiry, replaceBrowserSession } from "@/api/client";
import { conversationKeys, providerKeys, sessionKey, settingsKey } from "@/api/queryKeys";
import { postQuickPanelMessage, quickPanelDialogSelector, quickPanelFocusEvent, quickPanelMenuSelector, quickPanelSessionEvent } from "@/lib/quick-panel";
import { matchQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

function panelPopupOpen() {
  return document.querySelector(`${quickPanelDialogSelector}, ${quickPanelMenuSelector}`);
}

export function useQuickPanelBridge(composerId: string) {
  const cache = useQueryClient();
  const mounted = useRef(false);
  const pending = useRef(false);
  const attempted = useRef(false);
  const [hasShown, setHasShown] = useState(false);
  const [recovery, setRecovery] = useState<"connecting" | "failed">();

  const focusComposer = useCallback(() => {
    if (!panelPopupOpen()) document.getElementById(composerId)?.focus({ preventScroll: true });
  }, [composerId]);

  const reconnect = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    attempted.current = true;
    setRecovery("connecting");
    postQuickPanelMessage({ action: "reauthorize" });
  }, []);

  useEffect(() => {
    const unobserve = observeBrowserSessionExpiry(() => {
      if (!attempted.current) reconnect();
    });
    function onFocus() {
      setHasShown(true);
      focusComposer();
      if (!pending.current) {
        void cache.invalidateQueries({ queryKey: sessionKey });
        void cache.invalidateQueries({ queryKey: providerKeys.list });
        void cache.invalidateQueries({ queryKey: settingsKey });
      }
    }
    async function onSession(event: Event) {
      const token = (event as CustomEvent<{ token?: string | null }>).detail?.token;
      try {
        if (typeof token !== "string" || !token) throw new Error("Quick Panel connection failed");
        pending.current = true;
        setRecovery("connecting");
        replaceBrowserSession(token);
        await cache.cancelQueries();
        await cache.invalidateQueries({ queryKey: sessionKey }, { throwOnError: true });
        // Cancellation can restore a successful result from the previous session.
        await cache.invalidateQueries({
          predicate: (query) =>
            query.state.status === "error" ||
            matchQuery({ queryKey: conversationKeys.all }, query) ||
            matchQuery({ queryKey: providerKeys.list, exact: true }, query) ||
            matchQuery({ queryKey: settingsKey, exact: true }, query),
        });
        attempted.current = false;
        setRecovery(undefined);
      } catch {
        setRecovery("failed");
      } finally {
        pending.current = false;
      }
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing ||
          event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey ||
          panelPopupOpen() || (event.target instanceof Element &&
            event.target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [aria-expanded="true"]'))) return;
      event.preventDefault();
      postQuickPanelMessage({ action: "escape" });
    }
    window.addEventListener(quickPanelFocusEvent, onFocus);
    window.addEventListener(quickPanelSessionEvent, onSession);
    window.addEventListener("keydown", onEscape);
    if (!mounted.current) {
      mounted.current = true;
      postQuickPanelMessage({ action: "ready" });
    }
    return () => {
      unobserve();
      window.removeEventListener(quickPanelFocusEvent, onFocus);
      window.removeEventListener(quickPanelSessionEvent, onSession);
      window.removeEventListener("keydown", onEscape);
    };
  }, [cache, focusComposer, reconnect]);

  return { focusComposer, hasShown, recovery, reconnect };
}
