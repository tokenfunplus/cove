const workspaceEvents = new WeakSet<Event>();
export const isWorkspaceNavigation = (event: Event) => workspaceEvents.has(event);

/** Switch local surfaces without unloading the retained Chat workspace. */
export function navigateWorkspace(path: string, replace = false) {
  const destination = new URL(path, window.location.href);
  if (destination.origin !== window.location.origin) throw new Error("Invalid workspace destination");
  if (destination.href !== window.location.href) {
    if (replace) window.history.replaceState(window.history.state, "", destination.href);
    else window.history.pushState(null, "", destination.href);
  }
  const event = new PopStateEvent("popstate", { state: window.history.state });
  workspaceEvents.add(event);
  window.dispatchEvent(event);
}
