import { useEffect, useRef, useState } from "react";
import type {
  ConversationView,
  Generation,
  GenerationBatch,
} from "@cove/api-contract";
import type { LiveTurn } from "@/lib/chat/live-turn";

export function useConversationScroll({
  view,
  liveTurn,
  generationBatch,
  generation,
  isLoading,
}: {
  view?: ConversationView;
  liveTurn?: LiveTurn;
  generationBatch?: GenerationBatch;
  generation?: Generation;
  isLoading?: boolean;
}) {
  const hasContent = Boolean(view?.messages.length || liveTurn);
  const messageListRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  const followLatestRef = useRef(true);
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const [showReturnToLatest, setShowReturnToLatest] = useState(false);

  useEffect(() => {
    const node = footerRef.current;
    if (!node) return;
    const measure = () => setFooterHeight(node.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [view?.id, isLoading, hasContent]);

  useEffect(() => {
    const node = messageListRef.current;
    if (!node || !view) return;
    const saved = scrollPositionsRef.current[view.id];
    if (saved !== undefined) {
      node.scrollTop = saved;
      followLatestRef.current =
        saved >= node.scrollHeight - node.clientHeight - 120;
      setShowReturnToLatest(!followLatestRef.current);
    } else {
      followLatestRef.current = true;
      node.scrollTop = view.messages.length === 0 ? 0 : node.scrollHeight;
    }
  }, [view?.id, isLoading]);

  useEffect(() => {
    if (!liveTurn) return;
    const node = messageListRef.current;
    followLatestRef.current = true;
    setShowReturnToLatest(false);
    if (node) node.scrollTop = node.scrollHeight;
    composerRef.current?.focus();
  }, [liveTurn?.clientRequestId]);

  useEffect(() => {
    const node = messageListRef.current;
    if (
      !node ||
      !followLatestRef.current ||
      (!view?.messages.length && !liveTurn)
    )
      return;
    node.scrollTop = node.scrollHeight;
  }, [
    view?.messages.length,
    liveTurn,
    generationBatch?.state,
    generation?.state,
  ]);

  function handleMessageScroll() {
    const node = messageListRef.current;
    if (!node || !view) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    scrollPositionsRef.current[view.id] = node.scrollTop;
    const nearLatest = distance <= 120;
    followLatestRef.current = nearLatest;
    setShowReturnToLatest(
      !nearLatest && Boolean(liveTurn || generationBatch || generation),
    );
  }

  function returnToLatest() {
    const node = messageListRef.current;
    if (!node) return;
    followLatestRef.current = true;
    setShowReturnToLatest(false);
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    node.scrollTo({
      top: node.scrollHeight,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }

  useEffect(() => {
    const node = messageListRef.current;
    if (!node || !hasContent) return;
    let active = true;
    const followResize = () => {
      if (active && followLatestRef.current) node.scrollTop = node.scrollHeight;
    };
    const observer = new ResizeObserver(followResize);
    observer.observe(node);
    void document.fonts?.ready.then(followResize);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [view?.id, isLoading, hasContent]);
  return {
    messageListRef,
    composerRef,
    footerRef,
    footerHeight,
    showReturnToLatest,
    handleMessageScroll,
    returnToLatest,
  };
}
