// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ensureWorkspaceEntry, navigateWorkspace, trackWorkspaceFragment, workspaceEntry } from "@/lib/workspace-navigation";
import { useMiniAppScroll } from "./use-mini-app-scroll";

let frames: Map<number, FrameRequestCallback>;
let resize: (() => void) | undefined;
let disconnected = vi.fn<() => void>();
beforeEach(() => {
  window.history.replaceState(null, "", "/apps");
  ensureWorkspaceEntry();
  frames = new Map();
  let sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  disconnected = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    active = false;
    constructor(callback: () => void) { resize = () => { if (this.active) callback(); }; }
    observe() { this.active = true; }
    disconnect() { this.active = false; disconnected(); }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mount() {
  function Fixture() {
    const scroll = useMiniAppScroll();
    return <main ref={scroll.main}><div ref={scroll.content}>App content</div></main>;
  }
  const view = render(<Fixture />);
  const node = view.container.querySelector("main")!;
  let top = 0, height = 1000;
  Object.defineProperties(node, {
    scrollTop: { get: () => top, set: (value: number) => { top = Math.min(value, height - 100); }, configurable: true },
    scrollHeight: { get: () => height, configurable: true },
    clientHeight: { value: 100, configurable: true },
  });
  const frame = () => act(() => {
    const queued = [...frames.values()];
    frames.clear();
    queued.forEach((callback) => callback(0));
  });
  const scrollTo = (value: number) => act(() => {
    node.scrollTop = value;
    node.dispatchEvent(new Event("scroll"));
  });
  const traverse = (state: unknown, path = "/apps") => act(() => {
    window.history.replaceState(state, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  });
  frame();
  return { ...view, node, frame, scrollTo, traverse, height: (value: number) => { height = value; } };
}

test("new entries start at zero and Back/Forward restore by entry after content grows", () => {
  const first = window.history.state;
  const view = mount();
  view.scrollTo(600);
  act(() => navigateWorkspace("/apps?section=catalog"));
  const second = window.history.state;
  view.frame();
  expect(view.node.scrollTop).toBe(0);
  view.scrollTo(220);
  view.height(200);
  view.traverse(first);
  view.frame();
  expect(view.node.scrollTop).toBe(100);
  view.height(1000);
  act(() => resize?.());
  view.frame();
  expect(view.node.scrollTop).toBe(600);
  view.traverse(second);
  view.frame();
  expect(view.node.scrollTop).toBe(220);
});

test("user scrolling cancels a pending restoration", () => {
  const first = window.history.state;
  const view = mount();
  view.scrollTo(600);
  act(() => navigateWorkspace("/apps?section=catalog"));
  view.frame();
  view.height(200);
  view.traverse(first);
  view.frame();
  act(() => view.node.dispatchEvent(new WheelEvent("wheel")));
  view.scrollTo(50);
  view.height(1000);
  act(() => resize?.());
  view.frame();
  expect(view.node.scrollTop).toBe(50);
  view.unmount();
  expect(disconnected).toHaveBeenCalled();
  expect(frames.size).toBe(0);
});

test("unmount disconnects a fresh pending restoration and cancels its queued frame", () => {
  const first = window.history.state;
  const view = mount();
  view.scrollTo(600);
  act(() => navigateWorkspace("/apps?section=catalog"));
  const second = window.history.state;
  view.frame();
  view.height(200);
  view.traverse(first);
  view.frame();
  expect(view.node.scrollTop).toBe(100);
  act(() => resize?.());
  expect(frames.size).toBe(1);
  const before = disconnected.mock.calls.length;
  view.unmount();
  expect(disconnected.mock.calls.length).toBe(before + 1);
  expect(frames.size).toBe(0);
  view.height(1000);
  act(() => resize?.());
  view.traverse(second);
  expect(frames.size).toBe(0);
  expect(view.node.scrollTop).toBe(100);
});

test("a fragment stamped after popstate adopts its key without resetting either saved offset", () => {
  const original = window.history.state;
  const entry = workspaceEntry()!;
  const view = mount();
  view.scrollTo(600);
  act(() => {
    window.history.pushState(null, "", "/apps#native");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    trackWorkspaceFragment(entry);
  });
  const fragment = window.history.state;
  view.frame();
  expect(view.node.scrollTop).toBe(600);
  view.scrollTo(300);
  act(() => navigateWorkspace("/apps?section=catalog"));
  view.frame();
  view.traverse(fragment, "/apps#native");
  view.frame();
  expect(view.node.scrollTop).toBe(300);
  view.traverse(original);
  view.frame();
  expect(view.node.scrollTop).toBe(600);
});

test.each([false, true])("same-URL navigation preserves position (replace=%s), while a replaced route starts at zero", (replace) => {
  const view = mount();
  view.scrollTo(600);
  act(() => navigateWorkspace("/apps", replace));
  view.frame();
  expect(view.node.scrollTop).toBe(600);
  act(() => navigateWorkspace("/apps?section=catalog", true));
  view.frame();
  expect(view.node.scrollTop).toBe(0);
});

test("untracked destinations keep their native scroll behavior and no global history setting changes", () => {
  const mode = window.history.scrollRestoration;
  const first = window.history.state;
  const view = mount();
  view.scrollTo(600);
  view.traverse(null);
  view.frame();
  expect(view.node.scrollTop).toBe(600);
  view.scrollTo(75);
  view.traverse(first);
  view.frame();
  expect(view.node.scrollTop).toBe(600);
  expect(window.history.scrollRestoration).toBe(mode);
});
