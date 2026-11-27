const channelName = "cove.mini-app-inventory.v1";
const localEvent = "cove-mini-app-inventory-changed";
const storageKey = "cove.mini-app-inventory.v1";
const source = Math.random().toString(36).slice(2);
let revision = 0;

export const miniAppInventoryRevision = () => revision;

function closeChannel(channel?: BroadcastChannel) {
  try {
    channel?.close();
  } catch {
    /* Notification failures cannot undo a saved change. */
  }
}

type Notice = { version: 1; source: string };
function isForeignNotice(value: unknown): value is Notice {
  if (!value || typeof value !== "object") return false;
  const notice = value as Partial<Notice>;
  return (
    notice.version === 1 &&
    typeof notice.source === "string" &&
    notice.source !== source
  );
}

/** Share invalidation only; app identities, records and grants stay out of notices. */
export function announceMiniAppInventoryChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(localEvent));
  let delivered = false;
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof window.BroadcastChannel === "function") {
      channel = new window.BroadcastChannel(channelName);
      channel.postMessage({ version: 1, source } satisfies Notice);
      delivered = true;
    }
  } catch {
    // Storage events support browsers where BroadcastChannel is unavailable.
  } finally {
    closeChannel(channel);
  }
  if (!delivered) {
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ version: 1, source, change: Math.random() }),
      );
    } catch {
      // A browser storage restriction must not turn a successful write into failure.
    }
  }
}

export function observeMiniAppInventoryChanges(changed: () => void) {
  if (typeof window === "undefined") return () => {};
  const local = () => {
    revision++;
    changed();
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== storageKey || !event.newValue) return;
    try {
      if (isForeignNotice(JSON.parse(event.newValue))) local();
    } catch {
      // Ignore unrelated or older browser state.
    }
  };
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof window.BroadcastChannel === "function") {
      channel = new window.BroadcastChannel(channelName);
      channel.onmessage = (event: MessageEvent) => {
        if (isForeignNotice(event.data)) local();
      };
    }
  } catch {
    // The storage listener remains available as a fallback.
  }
  window.addEventListener(localEvent, local);
  window.addEventListener("storage", storage);
  return () => {
    closeChannel(channel);
    window.removeEventListener(localEvent, local);
    window.removeEventListener("storage", storage);
  };
}
