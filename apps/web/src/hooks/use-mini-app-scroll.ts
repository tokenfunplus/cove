import { useEffect, useRef } from "react";
import { isWorkspaceNavigation, workspaceEntry, workspaceFragmentStamped } from "@/lib/workspace-navigation";

// Window-local presentation metadata only. Entries and offsets expire on reload.
const positions = new Map<string, number>();
const maxPositions = 128;
function remember(key: string, top: number) {
  positions.delete(key);
  positions.set(key, top);
  if (positions.size > maxPositions) positions.delete(positions.keys().next().value!);
}
function currentKey() {
  if (!/^\/apps(?:\/|$)/.test(window.location.pathname)) return;
  const entry = workspaceEntry();
  return entry ? entry.lineage + "/" + entry.key : undefined;
}

export function useMiniAppScroll() {
  const main = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = main.current;
    const body = content.current;
    if (!node || !body) return;
    let key = currentKey();
    let href = window.location.href;
    let target: number | undefined;
    let frame: number | undefined;
    let observer: ResizeObserver | undefined;
    const save = () => {
      if (key) remember(key, target ?? node.scrollTop);
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
        // App stamps the initial entry in its parent effect after this mount.
        key ??= currentKey();
        if (target === undefined || !key) return;
        node.scrollTop = target;
        if (Math.abs(node.scrollTop - target) < 1) cancel();
      });
    };
    const restore = (top: number) => {
      cancel();
      target = top;
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(schedule);
        observer.observe(body);
      }
      schedule();
    };
    const navigate = (event: Event) => {
      const nextKey = currentKey();
      const nextHref = window.location.href;
      if (isWorkspaceNavigation(event) && nextKey === key && nextHref === href) return;
      // Capture the old surface before React replaces or shortens its content.
      save();
      cancel();
      key = nextKey;
      href = nextHref;
      if (key) restore(isWorkspaceNavigation(event) ? 0 : positions.get(key) ?? 0);
    };
    const stamped = () => {
      // Native fragment fallback stamps after popstate. Adopt that identity at
      // the existing offset without treating metadata as another navigation.
      save();
      key = currentKey();
      href = window.location.href;
      save();
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
    window.addEventListener(workspaceFragmentStamped, stamped);
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
      window.removeEventListener(workspaceFragmentStamped, stamped);
    };
  }, []);
  return { main, content };
}
