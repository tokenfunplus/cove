import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ChatPage } from "@/pages/ChatPage";
import { QuickPanelPage } from "@/pages/QuickPanelPage";
import { createConversation } from "@/api/conversations";
import {
  ensureWorkspaceEntry,
  isWorkspaceNavigation,
  navigateWorkspace,
  rebaseWorkspaceFragment,
  trackWorkspaceFragment,
  workspaceEntry,
} from "@/lib/workspace-navigation";

const MiniAppsPage = lazy(() => import("@/pages/MiniAppsPage"));
const currentLocation = () => ({
  entry: workspaceEntry(),
  state: window.history.state as unknown,
  href: window.location.href,
  historyLength: window.history.length,
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
    {
      previous: ReturnType<typeof currentLocation>;
      href: string;
      steps?: number;
      lastHref?: string;
    } | undefined
  >(undefined);
  const fragmentFallback = useRef<ReturnType<typeof currentLocation> | undefined>(
    undefined,
  );
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
        fragmentFallback.current = undefined;
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
        if (isWorkspaceNavigation(event)) {
          const fallback = fragmentFallback.current;
          if (
            fallback?.entry && target.entry?.lineage === fallback.entry.lineage &&
            ((target.entry.key !== current.current?.entry?.key && target.entry.index <= fallback.entry.index) ||
              (target.entry.key === fallback.entry.key && target.href !== fallback.href))
          ) fragmentFallback.current = undefined;
        }
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
        if (target.href !== previous.href || (!target.entry && previous.entry))
          fragmentOrigin.current = { previous, href: target.href };
        else if (fragmentOrigin.current?.href !== target.href)
          fragmentOrigin.current = undefined;
        current.current = target;
        return;
      }
      if (!address.startsWith("/apps") && next.startsWith("/apps")) {
        const actualPrevious = current.current!;
        const fallback = fragmentFallback.current;
        const fallbackURL = fallback && new URL(fallback.href);
        const previous =
          actualPrevious.entry?.lineage !== target.entry?.lineage &&
          fallback?.entry && fallbackURL &&
          fallback.entry.lineage === target.entry?.lineage &&
          fallbackURL.pathname + fallbackURL.search === address
            ? fallback
            : actualPrevious;
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
      const previous = pending?.previous ?? current.current!;
      const target = currentLocation();
      if (navigation) {
        if (pending && pending.href !== event.newURL) return;
      } else if (
        previous.entry && (!target.entry || target.entry.key === previous.entry.key)
      ) {
        const chain: NonNullable<typeof fragmentOrigin.current> = pending ?? {
          previous, href: event.newURL,
        };
        if (event.oldURL !== (chain.lastHref ?? previous.href)) return;
        chain.lastHref = event.newURL;
        chain.steps = Math.min(33, (chain.steps ?? 0) + 1);
        fragmentOrigin.current = chain;
        if (chain.href !== event.newURL) return;
        const growth = target.historyLength - previous.historyLength;
        fragmentFallback.current ??= previous;
        if (chain.steps <= 32 && growth === chain.steps && growth > 0) {
          // Only a complete observed push chain with matching history growth
          // proves the distance. Never stamp the current entry for a stale URL.
          trackWorkspaceFragment(previous.entry, growth);
          if (fragmentFallback.current?.entry?.lineage === previous.entry.lineage)
            fragmentFallback.current = previous;
        } else if (!target.entry) {
          rebaseWorkspaceFragment();
        }
        // Unproven positions get scroll identity in a separate lineage. Their
        // guard returns to the retained origin without overwriting older Apps.
      }
      fragmentOrigin.current = undefined;
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
