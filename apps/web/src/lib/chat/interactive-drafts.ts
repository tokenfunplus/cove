import { useSyncExternalStore } from "react";
// Identifiers only. Values stay in the mounted card controller or SQLite.
const dirty = new Set<string>();
const listeners = new Set<() => void>();
export function setInteractiveDraftDirty(id: string, value: boolean) {
  const before = dirty.has(id);
  if (value) dirty.add(id);
  else dirty.delete(id);
  if (before !== value) for (const listener of listeners) listener();
}
export function useInteractiveDraftWarning() {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    () => dirty.size > 0,
    () => false,
  );
}
