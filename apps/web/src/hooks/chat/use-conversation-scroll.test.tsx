// @vitest-environment jsdom

import { useConversationScroll } from "./use-conversation-scroll";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const originalScrollTo = HTMLElement.prototype.scrollTo;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); HTMLElement.prototype.scrollTo = originalScrollTo; });

test.each(["loading", "cached"])("a later answer reaches its own turn after %s detail is refreshed", (initial) => {
  const resized: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized.push(callback); }
    observe() {} disconnect() {}
  });
  const scrollTo = vi.fn(function (this: HTMLElement, options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0;
  });
  HTMLElement.prototype.scrollTo = scrollTo;
  const fixture = createWorkspaceFixture(2);
  const first = fixture.completedBatch;
  const later = {
    ...first, id: "later-batch", user_message_id: "later-user",
    targets: first.targets.map((target, index) => ({ ...target, generation: {
      ...target.generation, assistant_message_id: "later-answer-" + index,
    } })),
  };
  const messages = [...fixture.completedView.messages,
    { ...fixture.completedView.messages[0]!, id: later.user_message_id },
    { ...fixture.completedView.messages[1]!, id: "later-answer-1" },
  ];
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: this.dataset.top ? Number(this.dataset.top) - (this.parentElement?.scrollTop ?? 0) : 0, height: 30 } as DOMRect;
  });
  function Surface({ ready, extra = false }: { ready: boolean; extra?: boolean }) {
    const displayed = ready ? messages : messages.map((message) => message.id === "later-answer-1" ? { ...message, id: "stale-answer" } : message);
    const view = { ...fixture.completedView, generation_batches: [first, later], messages: extra ? [...displayed, { ...messages[0]!, id: "extra-user" }] : displayed };
    const scroll = useConversationScroll({
      view, isLoading: initial === "loading" && !ready,
      navigation: { conversationId: view.id, messageId: "later-answer-1", requestId: "search-selection" },
    });
    return <div ref={scroll.messageListRef} onScroll={scroll.handleMessageScroll}>
      <div data-timeline-anchor={first.user_message_id} data-top="120" />
      <div data-timeline-anchor={later.user_message_id} data-top="480" />
    </div>;
  }
  const { rerender, container } = render(<Surface ready={false} />);
  expect(scrollTo).not.toHaveBeenCalled();
  rerender(<Surface ready />);
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 468, behavior: "instant" });
  const list = container.firstElementChild as HTMLDivElement;
  Object.defineProperty(list, "scrollHeight", { value: 500 });
  fireEvent.scroll(list);
  for (const callback of resized) callback();
  expect(list.scrollTop).toBe(468);
  // A real user scroll can resume following the latest answer.
  fireEvent.wheel(list);
  list.scrollTop = 490;
  fireEvent.scroll(list);
  for (const callback of resized) callback();
  expect(list.scrollTop).toBe(500);
  scrollTo.mockClear();
  rerender(<Surface ready extra />);
  expect(scrollTo).not.toHaveBeenCalled();
});
