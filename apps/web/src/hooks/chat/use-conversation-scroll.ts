import { useEffect, useRef, useState } from "react";
import type {
  ConversationView,
  Generation,
  GenerationBatch,
} from "@cove/api-contract";
import type { LiveTurn } from "@/lib/chat/live-turn";
import type { ConversationNavigation } from "@/lib/workspace-types";

export function useConversationScroll({
  view,
  liveTurn,
  generationBatch,
  generation,
  isLoading,
  navigation,
}: {
  view?: ConversationView;
  liveTurn?: LiveTurn;
  generationBatch?: GenerationBatch;
  generation?: Generation;
  isLoading?: boolean;
  navigation?: ConversationNavigation;
}) {
  const hasContent = Boolean(view?.messages.length || liveTurn);
  const messageListRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  const followLatestRef = useRef(true);
  const explicitNavigationRef = useRef(false);
  const navigatedRequestRef = useRef<string | undefined>(undefined);
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
    explicitNavigationRef.current = false;
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
    explicitNavigationRef.current = false;
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
    if (explicitNavigationRef.current) {
      followLatestRef.current = false;
      setShowReturnToLatest(true);
      return;
    }
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
    explicitNavigationRef.current = false;
    setShowReturnToLatest(false);
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    node.scrollTo({
      top: node.scrollHeight,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }

  function scrollToMessage(id: string) {
    const node = messageListRef.current;
    const anchor = node && [...node.querySelectorAll<HTMLElement>("[data-timeline-anchor]")]
      .find((item) => item.dataset.timelineAnchor === id);
    if (!node || !anchor || !view) return false;
    // Stop following a stream before navigating to an earlier turn.
    explicitNavigationRef.current = true;
    followLatestRef.current = false;
    node.scrollTo({ top: node.scrollTop + anchor.getBoundingClientRect().top - node.getBoundingClientRect().top - 12, behavior: "instant" });
    handleMessageScroll();
    return true;
  }

  useEffect(() => {
    const node = messageListRef.current;
    if (!node) return;
    const resumeUserScroll = () => { explicitNavigationRef.current = false; };
    const events = ["wheel", "touchmove", "pointerdown", "keydown"] as const;
    for (const event of events) node.addEventListener(event, resumeUserScroll, { passive: true });
    return () => { for (const event of events) node.removeEventListener(event, resumeUserScroll); };
  }, [view?.id, isLoading, hasContent]);

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
  useEffect(() => {
    if (!navigation || !view || isLoading || navigation.conversationId !== view.id || navigatedRequestRef.current === navigation.requestId) return;
    // Wait for the measured composer space to be committed before positioning.
    if (footerRef.current && footerRef.current.getBoundingClientRect().height !== footerHeight) return;
    const index = view.messages.findIndex((message) => message.id === navigation.messageId);
    if (index < 0) return;
    const batch = view.generation_batches?.find((item) => item.selected_answer?.assistant_message_id === navigation.messageId || item.targets.some(
      (target) => target.generation.assistant_message_id === navigation.messageId,
    ));
    const anchor = batch?.user_message_id ?? view.messages.slice(0, index + 1).reverse().find((message) => message.role === "user")?.id;
    if (anchor && scrollToMessage(anchor)) navigatedRequestRef.current = navigation.requestId;
  }, [navigation?.requestId, view?.id, view?.messages, view?.generation_batches, isLoading, footerHeight]);

  return {
    messageListRef,
    composerRef,
    footerRef,
    footerHeight,
    showReturnToLatest,
    handleMessageScroll,
    returnToLatest,
    scrollToMessage,
  };
}
