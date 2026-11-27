import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ChatPage } from "@/pages/ChatPage";
import { QuickPanelPage } from "@/pages/QuickPanelPage";
import { createConversation } from "@/api/conversations";
import {
  ensureWorkspaceEntry,
  isWorkspaceNavigation,
  navigateWorkspace,
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
  const attempt = useRef(0);
  useEffect(() => {
    if (!current.current) {
      ensureWorkspaceEntry();
    }
    current.current = currentLocation();
    const navigate = (event: Event) => {
      const next = window.location.pathname + window.location.search;
      const target = currentLocation();
      if (restoring.current) {
        if (target.entry?.key === restoring.current.key) {
          const { done } = restoring.current;
          restoring.current = undefined;
          current.current = target;
          done();
        }
        return;
      }
      const commit = () => {
        attempt.current++;
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
      if (next === address) {
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
      // Native hash entries can copy history.state without incrementing our index.
      // Rebase rather than treating those duplicate positions as known distances.
      attempt.current++;
      ensureWorkspaceEntry(true);
      current.current = currentLocation();
    };
    window.addEventListener("popstate", navigate);
    window.addEventListener("hashchange", hashChanged);
    return () => {
      window.removeEventListener("popstate", navigate);
      window.removeEventListener("hashchange", hashChanged);
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
            const chat = await createConversation();
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
