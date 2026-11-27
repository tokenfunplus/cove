// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { request } from "@/api/client";
import { miniApps } from "@/api/mini-apps";
import {
  announceMiniAppInventoryChange,
  observeMiniAppInventoryChanges,
} from "./mini-app-inventory";

vi.mock("@/api/client", () => ({
  request: vi.fn(),
  fetchLocalService: vi.fn(),
}));
class Channel {
  static peers = new Set<Channel>();
  static messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) {
    Channel.peers.add(this);
  }
  postMessage(data: unknown) {
    Channel.messages.push(data);
    for (const peer of Channel.peers) {
      if (peer !== this && peer.name === this.name)
        peer.onmessage?.({ data } as MessageEvent);
    }
  }
  close() {
    Channel.peers.delete(this);
  }
}
afterEach(() => {
  Channel.peers.clear();
  Channel.messages = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("inventory notices contain no app data and wake another tab without echoing locally", async () => {
  vi.stubGlobal("BroadcastChannel", Channel);
  const changed = vi.fn();
  const stop = observeMiniAppInventoryChanges(changed);
  vi.mocked(request).mockResolvedValue({
    id: "private-book",
    name: "Private name",
  });
  await miniApps.create("private-release", "Private name", ["records.query"]);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(Channel.messages).toHaveLength(1);
  expect(Object.keys(Channel.messages[0] as object).sort()).toEqual([
    "source",
    "version",
  ]);
  expect(JSON.stringify(Channel.messages)).not.toContain("private");
  const other = new Channel("cove.mini-app-inventory.v1");
  other.postMessage({ version: 1, source: "other-tab" });
  expect(changed).toHaveBeenCalledTimes(2);
  other.postMessage({ version: 2, source: "other-tab" });
  expect(changed).toHaveBeenCalledTimes(2);
  stop();
  other.postMessage({ version: 1, source: "other-tab" });
  expect(changed).toHaveBeenCalledTimes(2);
  other.close();
});

test("preview, draft validation and failed mutations do not announce inventory changes", async () => {
  vi.stubGlobal("BroadcastChannel", Channel);
  const changed = vi.fn();
  const stop = observeMiniAppInventoryChanges(changed);
  vi.mocked(request).mockResolvedValue({});
  await miniApps.localPackage("{}", "preview");
  await miniApps.validateDraft("{}");
  expect(changed).not.toHaveBeenCalled();
  vi.mocked(request).mockRejectedValueOnce(new Error("Not saved"));
  await expect(miniApps.create("release", "Name", [])).rejects.toThrow(
    "Not saved",
  );
  expect(changed).not.toHaveBeenCalled();
  stop();
});

test("storage fallback accepts only inventory notices and cleans up listeners", () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  const changed = vi.fn();
  const stop = observeMiniAppInventoryChanges(changed);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "unrelated",
      newValue: '{"version":1,"source":"other-tab"}',
    }),
  );
  expect(changed).not.toHaveBeenCalled();
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "cove.mini-app-inventory.v1",
      newValue: '{"version":1,"source":"other-tab"}',
    }),
  );
  expect(changed).toHaveBeenCalledTimes(1);
  announceMiniAppInventoryChange();
  expect(changed).toHaveBeenCalledTimes(2);
  stop();
  announceMiniAppInventoryChange();
  expect(changed).toHaveBeenCalledTimes(2);
});
