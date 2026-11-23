import { useEffect, useRef, type RefObject } from "react";
import { postQuickPanelMessage, quickPanelDialogSelector, quickPanelMenuSelector } from "@/lib/quick-panel";

const compactHeight = 148;
const maximumHeight = 620;

function pixels(value: string) {
  return Number.parseFloat(value) || 0;
}

function layoutHeight(element: Element) {
  const style = getComputedStyle(element);
  if (style.display === "none" || style.position === "absolute" || style.position === "fixed") return 0;
  return element.getBoundingClientRect().height + pixels(style.marginTop) + pixels(style.marginBottom);
}

export function useQuickPanelHeight(rootRef: RefObject<HTMLElement | null>, hasAttachments: boolean) {
  const lastHeight = useRef<number | undefined>(undefined);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame: number | undefined;
    let observed = new Set<Element>();
    const observer = new ResizeObserver(schedule);

    function measure(root: HTMLElement) {
      const conversation = root.querySelector("[data-quick-panel-conversation]");
      const messages = conversation?.querySelector('[data-workspace-region="messages"]');
      const viewport = messages?.parentElement;
      const content = messages?.querySelector("[data-message-content]");
      const chrome = [
        ...Array.from(root.children).filter(child => child !== conversation),
        ...Array.from(conversation?.children ?? []).filter(child => child !== viewport),
      ];
      const dialog = document.querySelector(quickPanelDialogSelector);
      const menu = document.querySelector(quickPanelMenuSelector);
      const nextObserved = new Set(chrome);
      if (content) nextObserved.add(content);
      if (menu) nextObserved.add(menu);
      for (const element of observed) {
        if (!nextObserved.has(element)) observer.unobserve(element);
      }
      for (const element of nextObserved) {
        if (!observed.has(element)) observer.observe(element);
      }
      observed = nextObserved;

      // Read the transcript's natural height independently of its scroll viewport.
      const visibleTranscript = viewport && messages && content && content.getBoundingClientRect().height > 0;
      let transcriptHeight = 0;
      if (visibleTranscript) {
        const style = getComputedStyle(messages);
        transcriptHeight = layoutHeight(content) + pixels(style.paddingTop) + pixels(style.paddingBottom);
      }
      const chromeHeight = chrome.reduce((total, element) => total + layoutHeight(element), 0);
      const height = Math.ceil(Math.min(maximumHeight, Math.max(
        compactHeight,
        chromeHeight + transcriptHeight + (visibleTranscript ? 0 : 12),
        visibleTranscript ? 310 : 0,
        hasAttachments ? 224 : 0,
        menu ? Math.max(328, menu.scrollHeight + 108) : 0,
        dialog ? 544 : 0,
      )));
      if (height !== lastHeight.current) {
        lastHeight.current = height;
        postQuickPanelMessage({ action: "resize", height });
      }
    }

    function schedule() {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (root) measure(root);
      });
    }

    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "open"] });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [rootRef, hasAttachments]);
}
