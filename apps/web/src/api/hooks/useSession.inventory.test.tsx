// @vitest-environment jsdom
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { getSession } from "@/api";
import { miniApps, appKeys } from "@/api/mini-apps";
import { useChatApps } from "@/components/chat/AppDiscovery";
import { useLocalSession } from "./useSession";
import type { MiniAppInstance, MiniAppRelease } from "@cove/api-contract";

vi.mock("@/api", () => ({ getSession: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
});
function Inventory() {
  useLocalSession();
  const apps = useChatApps();
  return <p>{apps.map((app) => app.instance.name).join(", ") || "No apps"}</p>;
}

test("a cross-tab install wakes a previously empty Chat without startup or focus polling", async () => {
  const instance: MiniAppInstance = {
    id: "book",
    name: "New notebook",
    release_id: "release",
    enabled: true,
    revision: 1,
    grants: ["records.query"],
  };
  const release: MiniAppRelease = {
    id: "release",
    origin: "local",
    digest: "digest",
    package: {
      format: 1,
      publisher: "author",
      app: "notes",
      name: "Notes",
      version: "1.0.0",
      schema_version: 1,
      capabilities: ["records.query"],
      collections: {},
      pages: [],
      actions: { list: { title: "List", op: "query", surfaces: ["chat"] } },
    },
  };
  vi.mocked(getSession).mockResolvedValue({
    csrf_token: "test-proof",
    has_mini_apps: false,
  });
  let installed = false;
  const instances = vi
    .spyOn(miniApps, "instances")
    .mockImplementation(async () => ({
      instances: installed ? [instance] : [],
    }));
  const releases = vi
    .spyOn(miniApps, "releases")
    .mockImplementation(async () => ({ packages: installed ? [release] : [] }));
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  render(
    <QueryClientProvider client={cache}>
      <Inventory />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(cache.getQueryData(appKeys.presence)).toBe(false));
  expect(instances).not.toHaveBeenCalled();
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(instances).not.toHaveBeenCalled();
  let completeFirst!: (value: { instances: MiniAppInstance[] }) => void;
  const staleInventory = new Promise<{ instances: MiniAppInstance[] }>(
    (resolve) => {
      completeFirst = resolve;
    },
  );
  instances.mockImplementationOnce(() => staleInventory);
  await act(async () =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "cove.mini-app-inventory.v1",
        newValue: '{"version":1,"source":"package-tab"}',
      }),
    ),
  );
  await waitFor(() => expect(instances).toHaveBeenCalledTimes(1));
  installed = true;
  await act(async () =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "cove.mini-app-inventory.v1",
        newValue: '{"version":1,"source":"new-tab"}',
      }),
    ),
  );
  await act(async () => completeFirst({ instances: [] }));
  await screen.findByText("New notebook");
  expect(instances).toHaveBeenCalled();
  expect(instances.mock.calls.length).toBeGreaterThan(1);
  expect(releases).toHaveBeenCalled();
  expect(getSession).toHaveBeenCalledTimes(1);
  installed = false;
  await act(async () =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "cove.mini-app-inventory.v1",
        newValue: '{"version":1,"source":"another-tab"}',
      }),
    ),
  );
  await screen.findByText("No apps");
  await waitFor(() => expect(cache.getQueryData(appKeys.presence)).toBe(false));
  const calls = instances.mock.calls.length;
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(instances).toHaveBeenCalledTimes(calls);
});

test("an install notice received during session startup survives a stale empty presence response", async () => {
  let finish!: (value: { csrf_token: string; has_mini_apps: boolean }) => void;
  vi.mocked(getSession).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const instances = vi
    .spyOn(miniApps, "instances")
    .mockResolvedValue({ instances: [] });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  function Session({ showInventory }: { showInventory: boolean }) {
    useLocalSession();
    return showInventory ? <Apps /> : null;
  }
  function Apps() {
    useChatApps();
    return null;
  }
  const view = render(
    <QueryClientProvider client={cache}>
      <Session showInventory={false} />
    </QueryClientProvider>,
  );
  await act(async () =>
    window.dispatchEvent(new Event("cove-mini-app-inventory-changed")),
  );
  await act(async () => finish({ csrf_token: "proof", has_mini_apps: false }));
  expect(cache.getQueryData(appKeys.presence)).toBe(true);
  view.rerender(
    <QueryClientProvider client={cache}>
      <Session showInventory />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(instances).toHaveBeenCalledOnce());
});

test("unknown inventory presence retries the read after session startup", async () => {
  vi.mocked(getSession).mockResolvedValue({ csrf_token: "proof" });
  const instances = vi
    .spyOn(miniApps, "instances")
    .mockResolvedValue({ instances: [] });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={cache}>
      <Inventory />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(instances).toHaveBeenCalledOnce());
  await waitFor(() => expect(cache.getQueryData(appKeys.presence)).not.toBe(null));
});
