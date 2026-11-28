import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ChatPage } from "@/pages/ChatPage";
import { QuickPanelPage } from "@/pages/QuickPanelPage";
import { createConversation } from "@/api/conversations";
import {
  ensureWorkspaceEntry,
  isWorkspaceNavigation,
  navigateWorkspace,
  trackWorkspaceFragment,
  workspaceEntry,
} from "@/lib/workspace-navigation";

const MiniAppsPage = lazy(() => import("@/pages/MiniAppsPage"));
const currentLocation = () => ({
  entry: workspaceEntry(),
  state: window.history.state as unknown,
  href: window.location.href,
});

export function App() {
  const [address, setAddress] = useState(
    () => window.location.pathname + window.location.search,
  );
  const current = useRef<ReturnType<typeof currentLocation> | undefined>(
    undefined,
  );
  const restoring = useRef<{ key: string; done: () => void } | undefined>(
    undefined,
  );
  const allowed = useRef<{ key: string; href: string } | undefined>(undefined);
  const fragmentOrigin = useRef<
    { previous: ReturnType<typeof currentLocation>; href: string } | undefined
  >(undefined);
  const attempt = useRef(0);
  useEffect(() => {
    if (!current.current) {
      ensureWorkspaceEntry();
    }
    current.current = currentLocation();
    const navigation = (window as Window & { navigation?: EventTarget })
      .navigation;
    const entryChanged = (event: Event) => {
      const change = event as Event & {
        navigationType?: string | null;
        from?: { url?: string | null };
      };
      const previous = current.current!;
      if (
        change.navigationType !== "push" ||
        !change.from?.url ||
        !previous.entry ||
        restoring.current
      )
        return;
      const from = new URL(change.from.url);
      const destination = new URL(window.location.href);
      if (
        from.href !== previous.href ||
        from.pathname + from.search !==
          destination.pathname + destination.search ||
        from.hash === destination.hash
      )
        return;
      const entry = workspaceEntry();
      if (entry && entry.key !== previous.entry.key) return;
      // Native fragment pushes commit synchronously. Stamp every entry here,
      // before queued popstate/hashchange events can observe a later fragment.
      trackWorkspaceFragment(previous.entry);
      attempt.current++;
      allowed.current = undefined;
      fragmentOrigin.current = undefined;
      current.current = currentLocation();
    };
    const navigate = (event: Event) => {
      const next = window.location.pathname + window.location.search;
      const target = currentLocation();
      if (restoring.current) {
        const { key, done } = restoring.current;
        restoring.current = undefined;
        if (target.entry?.key === key) {
          current.current = target;
          done();
          return;
        }
        // Another traversal can supersede the corrective move. Release its
        // waiter and invalidate the old approval, then reconcile this entry.
        attempt.current++;
        allowed.current = undefined;
        fragmentOrigin.current = undefined;
        done();
      }
      const commit = () => {
        attempt.current++;
        fragmentOrigin.current = undefined;
        current.current = currentLocation();
        setAddress(next);
      };
      if (
        isWorkspaceNavigation(event) ||
        (allowed.current?.key === target.entry?.key &&
          allowed.current?.href === target.href)
      ) {
        allowed.current = undefined;
        commit();
        return;
      }
      // A queued approval belongs only to the traversal that consumes it.
      // Another browser destination must not leave that target authorized.
      allowed.current = undefined;
      if (next === address) {
        const previous = current.current!;
        if (
          !target.entry ||
          target.entry.key !== previous.entry?.key ||
          target.href !== previous.href
        ) {
          attempt.current++;
          allowed.current = undefined;
        }
        fragmentOrigin.current =
          target.href !== previous.href
            ? { previous, href: target.href }
            : undefined;
        current.current = target;
        return;
      }
      if (!address.startsWith("/apps") && next.startsWith("/apps")) {
        const previous = current.current!;
        const delta =
          previous.entry && target.entry?.lineage === previous.entry.lineage
            ? target.entry.index - previous.entry.index
            : 0;
        const token = ++attempt.current;
        let restored = Promise.resolve();
        const proceed = async () => {
          await restored;
          if (attempt.current !== token) return;
          if (delta && target.entry) {
            allowed.current = { key: target.entry.key, href: target.href };
            window.history.go(delta);
          } else {
            window.history.replaceState(target.state, "", target.href);
            ensureWorkspaceEntry(true);
            commit();
          }
        };
        const intent = new CustomEvent("cove-workspace-navigation", {
          cancelable: true,
          detail: { proceed },
        });
        if (!window.dispatchEvent(intent)) {
          if (delta && previous.entry) {
            restored = new Promise<void>((done) => {
              restoring.current = { key: previous.entry!.key, done };
            });
            window.history.go(-delta);
          } else {
            // External/legacy entries have no safe traversal delta. Preserve Chat
            // and its full URL rather than guessing a direction into unrelated history.
            window.history.replaceState(previous.state, "", previous.href);
            ensureWorkspaceEntry(true);
            current.current = currentLocation();
          }
          return;
        }
      }
      commit();
    };
    const hashChanged = (event: HashChangeEvent) => {
      if (!event.oldURL || !event.newURL) return;
      let before: URL, after: URL;
      try {
        before = new URL(event.oldURL);
        after = new URL(event.newURL);
      } catch {
        return;
      }
      if (
        before.pathname + before.search !== after.pathname + after.search ||
        restoring.current
      )
        return;
      const pending = fragmentOrigin.current;
      if (pending && pending.href !== event.newURL) return;
      fragmentOrigin.current = undefined;
      const previous = pending?.previous ?? current.current!;
      const target = currentLocation();
      // A native fragment creates a successor with empty or copied state. A
      // traversal to an already stamped entry must retain that entry's position.
      if (
        !navigation &&
        previous.entry &&
        (!target.entry || target.entry.key === previous.entry.key)
      ) {
        trackWorkspaceFragment(previous.entry);
      }
      attempt.current++;
      current.current = currentLocation();
    };
    window.addEventListener("popstate", navigate);
    window.addEventListener("hashchange", hashChanged);
    navigation?.addEventListener("currententrychange", entryChanged);
    return () => {
      window.removeEventListener("popstate", navigate);
      window.removeEventListener("hashchange", hashChanged);
      navigation?.removeEventListener("currententrychange", entryChanged);
    };
  }, [address]);
  const [incoming, setIncoming] = useState<{
    conversation: string;
    body: string;
  }>();
  if (/^\/apps(?:\/|$)/.test(address.split("?")[0]!)) {
    return (
      <Suspense fallback={<p role="status">Opening apps…</p>}>
        <MiniAppsPage
          attach={async (body) => {
            const token = attempt.current;
            const origin = currentLocation();
            const chat = await createConversation();
            if (
              attempt.current !== token ||
              window.location.href !== origin.href ||
              workspaceEntry()?.key !== origin.entry?.key
            )
              return;
            setIncoming({ conversation: chat.id, body });
            navigateWorkspace(
              "/#conversation=" + encodeURIComponent(chat.id),
              true,
            );
          }}
        />
      </Suspense>
    );
  }
  if (
    new URLSearchParams(window.location.search).get("surface") === "quick-panel"
  ) {
    return <QuickPanelPage />;
  }
  return (
    <ChatPage
      incomingAppDraft={incoming}
      consumedAppDraft={() => setIncoming(undefined)}
    />
  );
}
