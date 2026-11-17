// @vitest-environment jsdom

import { useConversationScroll } from "./use-conversation-scroll";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const originalScrollTo = HTMLElement.prototype.scrollTo;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); HTMLElement.prototype.scrollTo = originalScrollTo; });

test("a matching comparison answer navigates to its originating user turn after loading", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const scrollTo = vi.fn(function (this: HTMLElement, options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0;
  });
  HTMLElement.prototype.scrollTo = scrollTo;
  const fixture = createWorkspaceFixture(2);
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: this.dataset.timelineAnchor ? 120 : 0, height: 30 } as DOMRect;
  });
  function Surface({ loading, extra = false }: { loading: boolean; extra?: boolean }) {
    const view = { ...fixture.completedView, messages: extra ? [...fixture.completedView.messages, { ...fixture.completedView.messages[0]!, id: "later-message" }] : fixture.completedView.messages };
    const scroll = useConversationScroll({
      view, isLoading: loading,
      navigation: {
        conversationId: fixture.completedView.id,
        messageId: fixture.completedBatch.targets[1]!.generation.assistant_message_id!,
        requestId: "search-selection",
      },
    });
    return <div ref={scroll.messageListRef}><div data-timeline-anchor={fixture.completedBatch.user_message_id} /></div>;
  }
  const { rerender } = render(<Surface loading />);
  expect(scrollTo).not.toHaveBeenCalled();
  rerender(<Surface loading={false} />);
  expect(scrollTo).toHaveBeenCalledWith({ top: 108, behavior: "instant" });
  expect(rect).toHaveBeenCalled();
  scrollTo.mockClear();
  rerender(<Surface loading={false} extra />);
  expect(scrollTo).not.toHaveBeenCalled();
});
