const entryKey = "cove.workspace-history.v1";
export const workspaceFragmentStamped = "cove-workspace-fragment-stamped";

interface WorkspaceIdentity {
  lineage: string;
  index: number;
  key: string;
}

export interface WorkspaceChatOrigin {
  entry: WorkspaceIdentity;
  href: string;
}

export interface WorkspaceEntry extends WorkspaceIdentity {
  chatOrigin?: WorkspaceChatOrigin;
}

function identity(value: unknown): WorkspaceIdentity | undefined {
  const entry = value && typeof value === "object" ? value as Partial<WorkspaceIdentity> : undefined;
  return entry && typeof entry.lineage === "string" && typeof entry.key === "string" &&
    Number.isSafeInteger(entry.index) && entry.index! >= 0
    ? { lineage: entry.lineage, index: entry.index!, key: entry.key }
    : undefined;
}

function readChatOrigin(value: unknown): WorkspaceChatOrigin | undefined {
  if (!value || typeof value !== "object") return;
  const hint = value as Partial<WorkspaceChatOrigin>;
  const entry = identity(hint.entry);
  if (!entry || !entry.lineage || entry.lineage.length > 128 || !entry.key || entry.key.length > 128 ||
    typeof hint.href !== "string" || hint.href.length > 4096) return;
  try {
    const url = new URL(hint.href);
    const fragments = new URLSearchParams(url.hash.slice(1));
    if (url.origin !== window.location.origin || url.pathname !== "/" || url.username || url.password ||
      [...fragments.keys(), ...url.searchParams.keys()].some((key) => key.toLowerCase() === "cove-session")) return;
    return { entry, href: url.href };
  } catch { return; }
}

/** Copy only a known Chat URL and scalar identity, never its history state. */
export function chatOriginFor(entry: WorkspaceEntry | undefined, href: string | undefined) {
  return readChatOrigin({ entry, href });
}

export function workspaceEntry(state: unknown = window.history.state): WorkspaceEntry | undefined {
  const entry =
    state && typeof state === "object"
      ? ((state as Record<string, unknown>)[entryKey] as
          | Partial<WorkspaceEntry>
          | undefined)
      : undefined;
  const core = identity(entry);
  if (!core) return;
  const hint = readChatOrigin(entry?.chatOrigin);
  return hint && hint.entry.key !== core.key &&
    (hint.entry.lineage !== core.lineage || hint.entry.index < core.index)
    ? { ...core, chatOrigin: hint }
    : core;
}

function withEntry(state: unknown, entry: WorkspaceEntry) {
  return {
    ...(state && typeof state === "object" ? state : {}),
    [entryKey]: entry,
  };
}

export function ensureWorkspaceEntry(rebase = false): WorkspaceEntry {
  const existing = workspaceEntry();
  if (existing && !rebase) return existing;
  const entry = {
    lineage: crypto.randomUUID(),
    index: 0,
    key: crypto.randomUUID(),
  };
  window.history.replaceState(withEntry(window.history.state, entry), "");
  return entry;
}

/** Stamp a newly created native fragment entry without breaking its lineage. */
export function trackWorkspaceFragment(previous: WorkspaceEntry, distance = 1, origin = previous.chatOrigin) {
  const hint = readChatOrigin(origin);
  const entry = {
    lineage: previous.lineage,
    index: previous.index + distance,
    key: crypto.randomUUID(),
    ...(hint ? { chatOrigin: hint } : {}),
  };
  window.history.replaceState(withEntry(window.history.state, entry), "");
  window.dispatchEvent(new Event(workspaceFragmentStamped));
  return entry;
}

/** Give an unproven fragment its own identity without claiming a distance. */
export function rebaseWorkspaceFragment(origin?: WorkspaceChatOrigin) {
  const entry = ensureWorkspaceEntry(true);
  const hint = readChatOrigin(origin);
  if (hint) {
    entry.chatOrigin = hint;
    window.history.replaceState(withEntry(window.history.state, entry), "");
  }
  window.dispatchEvent(new Event(workspaceFragmentStamped));
  return entry;
}

const workspaceEvents = new WeakSet<Event>();
export const isWorkspaceNavigation = (event: Event) =>
  workspaceEvents.has(event);

/** Request Chat's existing draft/generation protection before changing history. */
export function navigateWorkspace(path: string, replace = false) {
  const proceed = async () => {
    const previous = ensureWorkspaceEntry();
    const destination = new URL(path, window.location.href);
    if (destination.href !== window.location.href) {
      const entry = replace
        ? previous
        : { ...previous, index: previous.index + 1, key: crypto.randomUUID() };
      const state = withEntry(replace ? window.history.state : null, entry);
      if (replace) window.history.replaceState(state, "", destination.href);
      else window.history.pushState(state, "", destination.href);
    }
    const event = new PopStateEvent("popstate", {
      state: window.history.state,
    });
    workspaceEvents.add(event);
    window.dispatchEvent(event);
  };
  const destination = new URL(path, window.location.href);
  if (
    !/^\/apps(?:\/|$)/.test(window.location.pathname) &&
    /^\/apps(?:\/|$)/.test(destination.pathname)
  ) {
    const intent = new CustomEvent("cove-workspace-navigation", {
      cancelable: true,
      detail: { proceed },
    });
    if (!window.dispatchEvent(intent)) return;
  }
  void proceed();
}
