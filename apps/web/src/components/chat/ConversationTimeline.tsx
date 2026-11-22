import { useEffect, useRef, useState, type RefObject } from "react";
import { Popover } from "radix-ui";
import { ArrowUpRight, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTimelineBookmarks } from "@/hooks/chat/use-timeline-bookmarks";
import type { TimelineEntry } from "@/lib/chat/timeline";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";
import { timelineStyles as styles } from "@/styles/timeline";

export function ConversationTimeline({
  conversationId,
  entries,
  scrollRef,
  onNavigate,
  copy = englishConversationCopy,
}: {
  conversationId: string;
  entries: TimelineEntry[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onNavigate: (id: string) => void;
  copy?: ApplicationCopy;
}) {
  const [activeId, setActiveId] = useState<string>();
  const [previewId, setPreviewId] = useState<string>();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const railRef = useRef<HTMLElement>(null);
  const { bookmarkedIds, toggleBookmark, sessionOnly } =
    useTimelineBookmarks(conversationId);
  // Content changes refresh positions, without attaching a new scroll listener per streamed token.
  const anchorIds = entries.map((entry) => entry.id).join("\n");

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const anchors = [
        ...container.querySelectorAll<HTMLElement>("[data-timeline-anchor]"),
      ];
      const readingLine = container.getBoundingClientRect().top +
        Math.min(100, container.clientHeight * 0.2);
      let current = anchors[0];
      for (const anchor of anchors) {
        if (anchor.getBoundingClientRect().top > readingLine) break;
        current = anchor;
      }
      setActiveId(current?.dataset.timelineAnchor);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    container.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    const observeContent = () => {
      observer.disconnect();
      observer.observe(container);
      for (const child of container.children) observer.observe(child);
      schedule();
    };
    // A Live Turn can become a saved message without changing its timeline id.
    const mutations = new MutationObserver(observeContent);
    mutations.observe(container, { childList: true });
    observeContent();
    schedule();
    return () => {
      container.removeEventListener("scroll", schedule);
      observer.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [conversationId, anchorIds, scrollRef]);

  useEffect(() => {
    const marker = railRef.current?.querySelector<HTMLElement>('[aria-current="location"]');
    const list = marker?.parentElement;
    if (marker && list) {
      // Only move the rail's own scrollport; never scroll the conversation on a hover.
      if (marker.offsetTop < list.scrollTop) list.scrollTop = marker.offsetTop;
      else if (marker.offsetTop + marker.offsetHeight > list.scrollTop + list.clientHeight)
        list.scrollTop = marker.offsetTop + marker.offsetHeight - list.clientHeight;
    }
  }, [activeId]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);
  function keepPreview() {
    clearTimeout(closeTimer.current);
  }
  function closePreview() {
    keepPreview();
    closeTimer.current = setTimeout(() => setPreviewId(undefined), 180);
  }

  if (!entries.length) return null;
  return (
    <nav
      ref={railRef}
      className={styles.rail}
      aria-label={copy.conversationTimeline}
      data-timeline-conversation={conversationId}
      onPointerEnter={keepPreview}
      onPointerLeave={closePreview}
    >
      <div className={styles.markers}>
        {entries.map((entry, index) => {
          const saved = bookmarkedIds.has(entry.id);
          return (
            <Popover.Root
              key={entry.id}
              open={previewId === entry.id}
              onOpenChange={(open) => setPreviewId(open ? entry.id : undefined)}
            >
              <Popover.Trigger asChild>
                <Button variant="plain" size="none"
                  type="button"
                  className={styles.marker}
                  data-timeline-marker={entry.id}
                  aria-label={`${copy.timelineTurn} ${index + 1}: ${entry.title || copy.you}${saved ? ` (${copy.bookmarked})` : ""}`}
                  aria-current={activeId === entry.id ? "location" : undefined}
                  onPointerEnter={() => { keepPreview(); setPreviewId(entry.id); }}
                  onFocus={() => { keepPreview(); setPreviewId(entry.id); }}
                  onBlur={closePreview}
                  onClick={(event) => {
                    event.preventDefault();
                    keepPreview();
                    setPreviewId(entry.id);
                    onNavigate(entry.id);
                  }}
                >
                  <span aria-hidden="true" className={styles.line} data-active={activeId === entry.id} data-bookmarked={saved} />
                  {saved && <span aria-hidden="true" className={styles.saved} />}
                </Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  className={styles.preview}
                  side="left"
                  sideOffset={6}
                  collisionPadding={12}
                  aria-label={`${copy.timelinePreview} ${index + 1}`}
                  data-timeline-preview={entry.id}
                  onPointerEnter={keepPreview}
                  onPointerLeave={closePreview}
                  onFocusCapture={keepPreview}
                  onBlur={closePreview}
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                  onEscapeKeyDown={(event) => {
                    event.preventDefault();
                    const marker = railRef.current?.querySelector<HTMLButtonElement>(`[data-timeline-marker][aria-expanded="true"]`);
                    marker?.focus({ preventScroll: true });
                    keepPreview();
                    setPreviewId(undefined);
                  }}
                >
                  <div className={styles.previewHeader}>
                    <h3 className={styles.title}>{entry.title || copy.you}</h3>
                    <Button
                      type="button" variant="ghost" className={styles.bookmark}
                      aria-label={saved ? copy.removeBookmark : copy.saveBookmark}
                      aria-pressed={saved}
                      onClick={() => toggleBookmark(entry.id)}
                    >
                      <Bookmark aria-hidden="true" fill={saved ? "currentColor" : "none"} />
                    </Button>
                  </div>
                  <p className={styles.excerpt}>{entry.excerpt || copy.timelineNoResponse}</p>
                  <div className={styles.foot}>
                    <span role="status">{sessionOnly ? copy.bookmarkSessionOnly : saved ? copy.bookmarked : `${copy.timelineTurn} ${index + 1}`}</span>
                    <Button type="button" variant="ghost" className={styles.jump} onClick={() => onNavigate(entry.id)}>
                      {copy.timelineJump}<ArrowUpRight aria-hidden="true" />
                    </Button>
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          );
        })}
      </div>
    </nav>
  );
}
