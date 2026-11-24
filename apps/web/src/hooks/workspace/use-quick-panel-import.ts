import { useLayoutEffect, useRef, useState } from "react";
import { postQuickPanelMessage, quickPanelImportEvent } from "@/lib/quick-panel";

const maximumTextBytes = 60_000;
const maximumPendingImports = 4;
const maximumRecentImports = 32;
const importIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

type PanelImport = { id: string; text: string };

export function useQuickPanelImport(onError: (message: string) => void) {
  const queueRef = useRef<PanelImport[]>([]);
  const [queue, setQueue] = useState<PanelImport[]>([]);
  const recent = useRef(new Set<string>());

  function updateQueue(next: PanelImport[]) {
    queueRef.current = next;
    setQueue(next);
  }

  // The listener must be installed before useQuickPanelBridge announces readiness.
  useLayoutEffect(() => {
    const received = recent.current;
    function receive(event: Event) {
      const detail = (event as CustomEvent<{ id?: unknown; text?: unknown }>).detail;
      const id = detail?.id;
      if (typeof id !== "string" || !importIdPattern.test(id)) return;
      event.preventDefault();
      if (received.has(id) || queueRef.current.some(item => item.id === id)) {
        postQuickPanelMessage({ action: "import-received", id });
        return;
      }
      const text = detail.text;
      if (typeof text !== "string" || text.length > maximumTextBytes || !text.trim() ||
          new TextEncoder().encode(text).length > maximumTextBytes) {
        postQuickPanelMessage({ action: "import-rejected", id });
        onError("Cove could not import this text. Try a shorter selection.");
        return;
      }
      if (queueRef.current.length >= maximumPendingImports) {
        postQuickPanelMessage({ action: "import-rejected", id });
        onError("Review or dismiss pending selections before importing more text.");
        return;
      }
      received.add(id);
      if (received.size > maximumRecentImports) received.delete(received.values().next().value!);
      updateQueue([...queueRef.current, { id, text }]);
      postQuickPanelMessage({ action: "import-received", id });
    }
    window.addEventListener(quickPanelImportEvent, receive);
    return () => window.removeEventListener(quickPanelImportEvent, receive);
  }, [onError]);

  function take(id: string) {
    if (queueRef.current[0]?.id !== id) return;
    const [item, ...rest] = queueRef.current;
    updateQueue(rest);
    return item;
  }

  return { pending: queue[0], take };
}
