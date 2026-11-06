import { useSyncExternalStore } from "react";

export const skins = [
  {
    id: "continuum",
    name: "Continuum",
    detail: "Neutral canvas, blue accents",
  },
  {
    id: "blueprint",
    name: "Blueprint",
    detail: "Technical grid, compact controls",
  },
  { id: "studio", name: "Studio", detail: "Soft violet, open surfaces" },
  { id: "grove", name: "Grove", detail: "Original forest palette" },
] as const;

export type Skin = (typeof skins)[number]["id"];
const defaultSkin: Skin = "continuum";
const storageKey = "cove.appearance.skin";

function readSkin(): Skin {
  try {
    const saved = window.localStorage.getItem(storageKey);
    return skins.find((skin) => skin.id === saved)?.id ?? defaultSkin;
  } catch {
    return defaultSkin;
  }
}

function applySkin(skin: Skin) {
  document.documentElement.dataset.skin = skin;
  window.dispatchEvent(new Event("cove-skin"));
}

export function initializeSkin() {
  applySkin(readSkin());
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null) applySkin(readSkin());
  });
}

export function selectSkin(skin: Skin) {
  applySkin(skin);
  try {
    window.localStorage.setItem(storageKey, skin);
  } catch {
    // Keep the selected skin for this session when browser storage is unavailable.
  }
}

function subscribe(listener: () => void) {
  window.addEventListener("cove-skin", listener);
  return () => window.removeEventListener("cove-skin", listener);
}

export function useSkin(): Skin {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.skin as Skin) ?? defaultSkin,
    () => defaultSkin,
  );
}
