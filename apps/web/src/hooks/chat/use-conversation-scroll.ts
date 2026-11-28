import { useWorkspaceActive } from "@/lib/workspace-active";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ConversationView,
  Generation,
  GenerationBatch,
} from "@cove/api-contract";
import type { LiveTurn } from "@/lib/chat/live-turn";
import type { ConversationNavigation } from "@/lib/workspace-types";

const latestThreshold = 24;

type ScrollMode = "question" | "latest" | "reading";

function distanceFromLatest(node: HTMLElement) {
  return node.scrollHeight - node.scrollTop - node.clientHeight;
}

export function useConversationScroll({
  view,
  liveTurn,
  generationBatch,
  generation,
  isLoading,
  navigation,
  quickPanel = false,
}: {
  view?: ConversationView;
  liveTurn?: LiveTurn;
  generationBatch?: GenerationBatch;
  generation?: Generation;
  isLoading?: boolean;
  navigation?: ConversationNavigation;
  quickPanel?: boolean;
}) {
  const active = useWorkspaceActive();
  const hasContent = Boolean(view?.messages.length || liveTurn);
  const messageListRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const readingAnchorRef = useRef<
    | { element: HTMLElement; top: number; key?: string; index: number }
    | undefined
  >(undefined);
  const userIntentRef = useRef(0);
  const updatedRepliesRef = useRef(new Set<string>());
  const lengthsRef = useRef(new Map<string, number>());
  const [updatedReplies, setUpdatedReplies] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  const initialScrollMode = quickPanel ? "question" : "latest";
  const scrollModeRef = useRef<ScrollMode>(initialScrollMode);
  const quickPanelQuestionIdRef = useRef<string | undefined>(undefined);
  const explicitNavigationRef = useRef(false);
  const navigatedRequestRef = useRef<string | undefined>(undefined);
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const [showReturnToLatest, setShowReturnToLatest] = useState(false);

  function rememberReadingAnchor() {
    const node = messageListRef.current;
    if (!node || scrollModeRef.current !== "reading") return;
    const top = node.getBoundingClientRect().top;
    const blocks = [
      ...node.querySelectorAll<HTMLElement>(
        "p,h1,h2,h3,h4,li,pre,[data-timeline-anchor]",
      ),
    ];
    const element = blocks.find((block) => {
      const rect = block.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > top + 12;
    });
    if (!element) return;
    const article = element.closest<HTMLElement>(
      "[data-generation-target],[data-timeline-anchor]",
    );
    const key =
      article?.dataset.generationTarget ?? article?.dataset.timelineAnchor;
    readingAnchorRef.current = {
      element,
      top: element.getBoundingClientRect().top,
      key,
      index: article
        ? [...article.querySelectorAll("p,h1,h2,h3,h4,li,pre")].indexOf(element)
        : 0,
    };
  }
  function preserveReadingPosition() {
    const node = messageListRef.current;
    if (!node) return;
    if (scrollModeRef.current === "latest") {
      node.scrollTop = node.scrollHeight;
      if (quickPanel && view) scrollPositionsRef.current[view.id] = node.scrollTop;
      return;
    }
    if (scrollModeRef.current === "question") {
      const questions = [...node.querySelectorAll<HTMLElement>("[data-quick-panel-question]")];
      const question = questions.find(
        (item) => item.dataset.timelineAnchor === quickPanelQuestionIdRef.current,
      ) ?? questions.at(-1);
      const start = question
        ? node.scrollTop + question.getBoundingClientRect().top - node.getBoundingClientRect().top - 12
        : 0;
      // A short panel can grow while tokens arrive. Keep the beginning of the
      // turn in view even if the answer briefly overflows before the resize.
      node.scrollTop = Math.max(0, Math.min(start, node.scrollHeight - node.clientHeight));
      if (view) scrollPositionsRef.current[view.id] = node.scrollTop;
      setShowReturnToLatest(distanceFromLatest(node) > latestThreshold);
      return;
    }
    // A native gesture can move the viewport before its scroll event arrives.
    const userMovedViewport = quickPanel && view && performance.now() < userIntentRef.current &&
      node.scrollTop !== scrollPositionsRef.current[view.id];
    const anchor = userMovedViewport ? undefined : readingAnchorRef.current;
    if (anchor) {
      let element = anchor.element;
      if (!element.isConnected && anchor.key) {
        const article = [
          ...node.querySelectorAll<HTMLElement>(
            "[data-generation-target],[data-timeline-anchor]",
          ),
        ].find(
          (item) =>
            (item.dataset.generationTarget ?? item.dataset.timelineAnchor) ===
            anchor.key,
        );
        element =
          article?.querySelectorAll<HTMLElement>("p,h1,h2,h3,h4,li,pre")[
            anchor.index
          ] ??
          article ??
          element;
      }
      if (element.isConnected && element.getBoundingClientRect().height > 0)
        node.scrollTop += element.getBoundingClientRect().top - anchor.top;
    }
    if (quickPanel && view) {
      scrollPositionsRef.current[view.id] = node.scrollTop;
      setShowReturnToLatest(distanceFromLatest(node) > latestThreshold);
    }
    rememberReadingAnchor();
  }
  function clearUpdatedReplies() {
    updatedRepliesRef.current.clear();
    setUpdatedReplies(0);
  }

  useEffect(() => {
    const node = footerRef.current;
    if (!node) return;
    const measure = () => setFooterHeight(node.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [view?.id, isLoading, hasContent]);

  useLayoutEffect(() => {
    const node = messageListRef.current;
    if (!node || !view) return;
    const saved = scrollPositionsRef.current[view.id];
    explicitNavigationRef.current = false;
    readingAnchorRef.current = undefined;
    quickPanelQuestionIdRef.current = undefined;
    lengthsRef.current.clear();
    clearUpdatedReplies();
    if (saved !== undefined) {
      node.scrollTop = saved;
      scrollModeRef.current = distanceFromLatest(node) > latestThreshold
        ? "reading"
        : "latest";
      setShowReturnToLatest(scrollModeRef.current === "reading");
    } else {
      scrollModeRef.current = initialScrollMode;
      if (quickPanel) preserveReadingPosition();
      else node.scrollTop = view.messages.length === 0 ? 0 : node.scrollHeight;
    }
  }, [view?.id, isLoading]);

  useEffect(() => {
    if (!liveTurn || liveTurn.restored) return;
    const node = messageListRef.current;
    scrollModeRef.current = initialScrollMode;
    explicitNavigationRef.current = false;
    readingAnchorRef.current = undefined;
    userIntentRef.current = 0;
    setShowReturnToLatest(false);
    clearUpdatedReplies();
    if (quickPanel) preserveReadingPosition();
    else if (node) node.scrollTop = node.scrollHeight;
    if (active) composerRef.current?.focus({ preventScroll: quickPanel });
  }, [liveTurn?.clientRequestId, liveTurn?.restored]);

  const savedSizes = useMemo(() => {
    const sizes = new Map<string, number>();
    const messages = new Map(
      (view?.messages ?? []).map((message) => [message.id, message]),
    );
    for (const batch of view?.generation_batches ?? [])
      for (const target of batch.targets) {
        const message = messages.get(
          target.generation.assistant_message_id ?? "",
        );
        if (message)
          sizes.set(
            target.generation.id,
            message.body.length + (message.reasoning?.length ?? 0),
          );
      }
    return sizes;
  }, [view?.messages, view?.generation_batches]);
  function recordSizes(sizes: Map<string, number>) {
    for (const [id, size] of sizes) {
      const previous = lengthsRef.current.get(id);
      if (
        scrollModeRef.current === "reading" &&
        size > (previous ?? size) &&
        !updatedRepliesRef.current.has(id)
      )
        updatedRepliesRef.current.add(id);
      lengthsRef.current.set(id, size);
    }
    setUpdatedReplies(updatedRepliesRef.current.size);
  }
  useLayoutEffect(() => recordSizes(savedSizes), [savedSizes]);
  useLayoutEffect(() => {
    if (quickPanel && liveTurn) {
      quickPanelQuestionIdRef.current = liveTurn.userMessageId;
    }
    recordSizes(
      new Map(
        (liveTurn?.targets ?? []).map((target) => [
          target.generationId ?? target.key,
          target.assistantBody.length + (target.reasoningBody?.length ?? 0),
        ]),
      ),
    );
    preserveReadingPosition();
  }, [view?.messages, liveTurn, generationBatch?.state, generation?.state]);

  function handleMessageScroll() {
    const node = messageListRef.current;
    if (!node || !view) return;
    const previousTop = scrollPositionsRef.current[view.id];
    const nearLatest = distanceFromLatest(node) <= latestThreshold;
    scrollPositionsRef.current[view.id] = node.scrollTop;
    if (explicitNavigationRef.current) {
      scrollModeRef.current = "reading";
      setShowReturnToLatest(true);
      return;
    }
    if (performance.now() < userIntentRef.current) {
      if (!quickPanel) {
        scrollModeRef.current = nearLatest ? "latest" : "reading";
      } else if (previousTop !== undefined && node.scrollTop !== previousTop) {
        scrollModeRef.current = nearLatest && node.scrollTop > previousTop
          ? "latest"
          : "reading";
      }
    }
    setShowReturnToLatest(
      quickPanel
        ? !nearLatest && scrollModeRef.current !== "latest"
        : scrollModeRef.current === "reading" && Boolean(view.messages.length || liveTurn),
    );
    if (scrollModeRef.current === "latest") clearUpdatedReplies();
    else if (scrollModeRef.current === "reading") rememberReadingAnchor();
  }

  function returnToLatest() {
    const node = messageListRef.current;
    if (!node) return;
    userIntentRef.current = 0;
    scrollModeRef.current = "latest";
    explicitNavigationRef.current = false;
    setShowReturnToLatest(false);
    clearUpdatedReplies();
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
    const anchor =
      node &&
      [...node.querySelectorAll<HTMLElement>("[data-timeline-anchor]")].find(
        (item) => item.dataset.timelineAnchor === id,
      );
    if (!node || !anchor || !view) return false;
    // Stop following a stream before navigating to an earlier turn.
    explicitNavigationRef.current = true;
    scrollModeRef.current = "reading";
    node.scrollTo({
      top:
        node.scrollTop +
        anchor.getBoundingClientRect().top -
        node.getBoundingClientRect().top -
        12,
      behavior: "instant",
    });
    handleMessageScroll();
    rememberReadingAnchor();
    return true;
  }

  useEffect(() => {
    const node = messageListRef.current;
    if (!node) return;
    const resumeUserScroll = (event: Event) => {
      if (
        event instanceof KeyboardEvent &&
        (![
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key) ||
          (event.target as HTMLElement)?.closest(
            "input,textarea,[contenteditable=true]",
          ))
      )
        return;
      explicitNavigationRef.current = false;
      userIntentRef.current = performance.now() + 1200;
      if (quickPanel && view) scrollPositionsRef.current[view.id] = node.scrollTop;
      const scrollsUp = (event instanceof WheelEvent && event.deltaY < 0) || (
        quickPanel && event instanceof KeyboardEvent && (
          ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
          (event.key === " " && event.shiftKey)
        )
      );
      if (scrollsUp && (!quickPanel || node.scrollHeight > node.clientHeight)) {
        scrollModeRef.current = "reading";
        setShowReturnToLatest(!quickPanel || distanceFromLatest(node) > latestThreshold);
        rememberReadingAnchor();
      }
    };
    const events = ["wheel", "touchmove", "pointerdown", "keydown"] as const;
    for (const event of events)
      node.addEventListener(event, resumeUserScroll, { passive: true });
    return () => {
      for (const event of events)
        node.removeEventListener(event, resumeUserScroll);
    };
  }, [view?.id, isLoading, hasContent]);

  useEffect(() => {
    const node = messageListRef.current;
    if (!node || !hasContent) return;
    let active = true;
    const followResize = () => {
      if (active) preserveReadingPosition();
    };
    const observer = new ResizeObserver(followResize);
    observer.observe(node);
    if (contentRef.current) observer.observe(contentRef.current);
    const previous = node.style.overflowAnchor;
    node.style.overflowAnchor = "none";
    void document.fonts?.ready.then(followResize);
    return () => {
      active = false;
      node.style.overflowAnchor = previous;
      observer.disconnect();
    };
  }, [view?.id, isLoading, hasContent]);
  useEffect(() => {
    if (
      !navigation ||
      !view ||
      isLoading ||
      navigation.conversationId !== view.id ||
      navigatedRequestRef.current === navigation.requestId
    )
      return;
    // Wait for the measured composer space to be committed before positioning.
    if (
      footerRef.current &&
      footerRef.current.getBoundingClientRect().height !== footerHeight
    )
      return;
    const index = view.messages.findIndex(
      (message) => message.id === navigation.messageId,
    );
    if (index < 0) return;
    const batch = view.generation_batches?.find(
      (item) =>
        item.selected_answer?.assistant_message_id === navigation.messageId ||
        item.targets.some(
          (target) =>
            target.generation.assistant_message_id === navigation.messageId,
        ),
    );
    const anchor =
      batch?.user_message_id ??
      view.messages
        .slice(0, index + 1)
        .reverse()
        .find((message) => message.role === "user")?.id;
    if (anchor && scrollToMessage(anchor))
      navigatedRequestRef.current = navigation.requestId;
  }, [
    navigation?.requestId,
    view?.id,
    view?.messages,
    view?.generation_batches,
    isLoading,
    footerHeight,
  ]);

  return {
    messageListRef,
    contentRef,
    updatedReplies,
    composerRef,
    footerRef,
    footerHeight,
    showReturnToLatest,
    handleMessageScroll,
    returnToLatest,
    scrollToMessage,
  };
}
