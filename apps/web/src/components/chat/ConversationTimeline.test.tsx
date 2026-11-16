// @vitest-environment jsdom

import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ConversationTimeline } from "./ConversationTimeline";

const entries = [
  { id: "user-a", title: "Architecture choices", excerpt: "Start with a small, focused module." },
  { id: "user-b", title: "Shipping the first version", excerpt: "Validate the main path before release." },
];

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount(conversationId = "chat-a", onNavigate = vi.fn()) {
  const scrollRef = createRef<HTMLDivElement>();
  return {
    onNavigate,
    ...render(<div>
      <div ref={scrollRef}>
        {entries.map((entry) => <article key={entry.id} data-timeline-anchor={entry.id}>{entry.title}</article>)}
      </div>
      <ConversationTimeline conversationId={conversationId} entries={entries} scrollRef={scrollRef} onNavigate={onNavigate} />
    </div>),
  };
}

test("a preview remains interactive across the marker-to-card gap and bookmarks survive remount", async () => {
  const user = userEvent.setup();
  const { unmount } = mount();
  const marker = screen.getByRole("button", { name: "Turn 1: Architecture choices" });
  await user.hover(marker);
  const preview = await screen.findByRole("dialog", { name: "Turn preview 1" });
  await user.unhover(marker);
  await user.hover(preview);
  await act(() => new Promise((resolve) => setTimeout(resolve, 220)));
  expect(screen.getByText(entries[0].excerpt)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save bookmark" }));
  expect(screen.getByRole("button", { name: "Remove bookmark" }).getAttribute("aria-pressed")).toBe("true");
  expect(window.localStorage.getItem("cove.timeline.bookmarks.chat-a")).toBe('["user-a"]');
  expect(Object.values(window.localStorage).join("")).not.toContain("Architecture");
  unmount();
  const second = mount();
  expect(screen.getByRole("button", { name: /Turn 1: Architecture choices \(Bookmarked\)/ })).toBeTruthy();
  await user.hover(screen.getByRole("button", { name: /Turn 1:/ }));
  await user.click(await screen.findByRole("button", { name: "Remove bookmark" }));
  expect(window.localStorage.getItem("cove.timeline.bookmarks.chat-a")).toBeNull();
  second.unmount();
  mount("chat-b");
  expect(screen.queryByRole("button", { name: /Bookmarked/ })).toBeNull();
});

test("clicking a marker navigates, keyboard focus opens a preview, and Escape dismisses it", async () => {
  const user = userEvent.setup();
  const { onNavigate } = mount();
  const marker = screen.getByRole("button", { name: "Turn 2: Shipping the first version" });
  await user.click(marker);
  expect(onNavigate).toHaveBeenCalledWith("user-b");
  await user.tab();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(marker);
  fireEvent.focus(marker);
  expect(await screen.findByRole("dialog", { name: "Turn preview 2" })).toBeTruthy();
});

test("the active marker follows the reading position", async () => {
  const { container } = mount();
  const anchors = container.querySelectorAll<HTMLElement>("[data-timeline-anchor]");
  let secondTop = 300;
  vi.spyOn(anchors[0], "getBoundingClientRect").mockImplementation(() => ({ top: -100 } as DOMRect));
  vi.spyOn(anchors[1], "getBoundingClientRect").mockImplementation(() => ({ top: secondTop } as DOMRect));
  fireEvent.scroll(anchors[0].parentElement!);
  await waitFor(() => expect(screen.getByRole("button", { name: /Turn 1:/ }).getAttribute("aria-current")).toBe("location"));
  secondTop = -20;
  fireEvent.scroll(anchors[0].parentElement!);
  await waitFor(() => expect(screen.getByRole("button", { name: /Turn 2:/ }).getAttribute("aria-current")).toBe("location"));
  // Reconciliation replaces a Live Turn's DOM while retaining its message id.
  const replacement = anchors[1].cloneNode(true) as HTMLElement;
  vi.spyOn(replacement, "getBoundingClientRect").mockImplementation(() => ({ top: 300 } as DOMRect));
  act(() => anchors[1].replaceWith(replacement));
  fireEvent.scroll(anchors[0].parentElement!);
  await waitFor(() => expect(screen.getByRole("button", { name: /Turn 1:/ }).getAttribute("aria-current")).toBe("location"));
});

test("unavailable browser storage keeps bookmarks usable for the current session", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  const user = userEvent.setup();
  mount();
  await user.hover(screen.getByRole("button", { name: /Turn 1:/ }));
  await user.click(await screen.findByRole("button", { name: "Save bookmark" }));
  expect(screen.getByRole("status").textContent).toBe("Saved for this session only");
  expect(screen.getByRole("button", { name: "Remove bookmark" }).getAttribute("aria-pressed")).toBe("true");
});
