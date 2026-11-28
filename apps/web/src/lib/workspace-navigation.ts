const entryKey = "cove.workspace-history.v1";
export const workspaceFragmentStamped = "cove-workspace-fragment-stamped";

export interface WorkspaceEntry {
  lineage: string;
  index: number;
  key: string;
}

export function workspaceEntry(state: unknown = window.history.state) {
  const entry =
    state && typeof state === "object"
      ? ((state as Record<string, unknown>)[entryKey] as
          | Partial<WorkspaceEntry>
          | undefined)
      : undefined;
  return entry &&
    typeof entry.lineage === "string" &&
    typeof entry.key === "string" &&
    Number.isSafeInteger(entry.index) &&
    entry.index! >= 0
    ? (entry as WorkspaceEntry)
    : undefined;
}

function withEntry(state: unknown, entry: WorkspaceEntry) {
  return {
    ...(state && typeof state === "object" ? state : {}),
    [entryKey]: entry,
  };
}

export function ensureWorkspaceEntry(rebase = false) {
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
export function trackWorkspaceFragment(previous: WorkspaceEntry) {
  const entry = {
    ...previous,
    index: previous.index + 1,
    key: crypto.randomUUID(),
  };
  window.history.replaceState(withEntry(window.history.state, entry), "");
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
