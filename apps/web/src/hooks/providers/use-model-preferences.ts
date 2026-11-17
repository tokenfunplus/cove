import { useSyncExternalStore } from "react";
import type {
  ActiveModelSet,
  ActiveSelection,
} from "@/components/providers/model-selection";

export type ModelPreset = { id: string; name: string; targets: ActiveModelSet };
export type ModelPreferences = {
  favorites: ActiveModelSet;
  recent: ActiveModelSet;
  presets: ModelPreset[];
};
const key = "cove:model-preferences:v1";
const empty: ModelPreferences = { favorites: [], recent: [], presets: [] };
let snapshot = empty;
let loaded = false;
const listeners = new Set<() => void>();
export const sameModel = (a: ActiveSelection, b: ActiveSelection) =>
  a.providerId === b.providerId && a.modelId === b.modelId;
function targets(value: unknown, limit: number): ActiveModelSet {
  if (!Array.isArray(value)) return [];
  const result: ActiveModelSet = [];
  for (const item of value.slice(0, limit)) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.providerId !== "string" ||
      typeof item.modelId !== "string" ||
      !item.providerId ||
      !item.modelId ||
      item.providerId.length > 240 ||
      item.modelId.length > 500
    )
      continue;
    const target = { providerId: item.providerId, modelId: item.modelId };
    if (!result.some((existing) => sameModel(existing, target)))
      result.push(target);
  }
  return result;
}
export function parseModelPreferences(raw: string | null): ModelPreferences {
  try {
    const data = JSON.parse(raw ?? "null");
    if (!data || typeof data !== "object") return empty;
    return {
      favorites: targets(data.favorites, 100),
      recent: targets(data.recent, 12),
      presets: Array.isArray(data.presets)
        ? data.presets.slice(0, 12).flatMap((preset: unknown) => {
            if (!preset || typeof preset !== "object") return [];
            const value = preset as Record<string, unknown>;
            const selected = targets(value.targets, 4);
            return typeof value.id === "string" &&
              value.id.length <= 100 &&
              typeof value.name === "string" &&
              value.name.trim() &&
              selected.length
              ? [
                  {
                    id: value.id,
                    name: value.name.trim().slice(0, 60),
                    targets: selected,
                  },
                ]
              : [];
          })
        : [],
    };
  } catch {
    return empty;
  }
}
function read() {
  if (!loaded) {
    loaded = true;
    try {
      snapshot = parseModelPreferences(localStorage.getItem(key));
    } catch {
      snapshot = empty;
    }
  }
  return snapshot;
}
function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      snapshot = parseModelPreferences(event.newValue);
      loaded = true;
      notify();
    }
  };
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", storage);
  };
}
function update(change: (current: ModelPreferences) => ModelPreferences) {
  snapshot = change(read());
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    /* Preferences remain usable for this session. */
  }
  notify();
}
export function useModelPreferences() {
  const preferences = useSyncExternalStore(subscribe, read, () => empty);
  return {
    preferences,
    toggleFavorite: (target: ActiveSelection) =>
      update((current) => ({
        ...current,
        favorites: current.favorites.some((item) => sameModel(item, target))
          ? current.favorites.filter((item) => !sameModel(item, target))
          : [...current.favorites, target].slice(-100),
      })),
    remember: (target: ActiveSelection) =>
      update((current) => ({
        ...current,
        recent: [
          target,
          ...current.recent.filter((item) => !sameModel(item, target)),
        ].slice(0, 12),
      })),
    savePreset: (name: string, selected: ActiveModelSet) =>
      update((current) => ({
        ...current,
        presets: [
          ...current.presets.filter((item) => item.name !== name.trim()),
          {
            id: crypto.randomUUID(),
            name: name.trim().slice(0, 60),
            targets: selected.map((target) => ({ ...target })),
          },
        ].slice(-12),
      })),
    removePreset: (id: string) =>
      update((current) => ({
        ...current,
        presets: current.presets.filter((item) => item.id !== id),
      })),
  };
}
