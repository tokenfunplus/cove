import { useEffect, useRef } from "react";
import { isWorkspaceNavigation } from "@/lib/workspace-navigation";

// Per-URL presentation offsets only; no traversal indexes or history rewriting.
const positions = new Map<string, number>();
const maxPositions = 128;
function remember(key: string, top: number) {
  positions.delete(key);
  positions.set(key, top);
  if (positions.size > maxPositions) positions.delete(positions.keys().next().value!);
}
function currentKey() {
  if (!/^\/apps(?:\/|$)/.test(window.location.pathname)) return;
  return window.location.pathname + window.location.search + window.location.hash;
}

export function useMiniAppScroll() {
  const main = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = main.current;
    const body = content.current;
    if (!node || !body) return;
    let key = currentKey();
    let target: number | undefined;
    let frame: number | undefined;
    let observer: ResizeObserver | undefined;
    const save = () => {
      // A destination can render before its popstate listener runs. Never save
      // the shortened destination's clamped offset under the previous URL.
      if (key && currentKey() === key) remember(key, target ?? node.scrollTop);
    };
    const cancel = () => {
      target = undefined;
      observer?.disconnect();
      observer = undefined;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    };
    const schedule = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (target === undefined || !key) return;
        node.scrollTop = target;
        if (Math.abs(node.scrollTop - target) < 1) cancel();
      });
    };
    const restore = (top: number) => {
      cancel();
      if (key) remember(key, top);
      target = top;
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(schedule);
        observer.observe(body);
      }
      schedule();
    };
    const navigate = (event: Event) => {
      const nextKey = currentKey();
      if (nextKey === key) return;
      cancel();
      key = nextKey;
      if (key) restore(isWorkspaceNavigation(event) ? 0 : positions.get(key) ?? 0);
    };
    const scrolled = () => {
      if (target === undefined) save();
    };
    const userScroll = () => {
      cancel();
      save();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
        userScroll();
    };
    node.addEventListener("scroll", scrolled, { passive: true });
    node.addEventListener("wheel", userScroll, { passive: true });
    node.addEventListener("touchstart", userScroll, { passive: true });
    node.addEventListener("pointerdown", userScroll, { passive: true });
    node.addEventListener("keydown", keyDown);
    window.addEventListener("popstate", navigate);
    window.addEventListener("hashchange", navigate);
    restore(key ? positions.get(key) ?? 0 : 0);
    return () => {
      save();
      cancel();
      node.removeEventListener("scroll", scrolled);
      node.removeEventListener("wheel", userScroll);
      node.removeEventListener("touchstart", userScroll);
      node.removeEventListener("pointerdown", userScroll);
      node.removeEventListener("keydown", keyDown);
      window.removeEventListener("popstate", navigate);
      window.removeEventListener("hashchange", navigate);
    };
  }, []);
  return { main, content };
}
