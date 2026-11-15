import { providerCatalogQueryOptions } from "@/api/hooks/useProviders";
import * as api from "@/api";
import {
  QueryClient,
  QueryObserver,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { expect, test, vi } from "vitest";

test("Provider catalog query options identify one cached catalog per Provider", () => {
  const options = providerCatalogQueryOptions("provider/one");

  expect(options.queryKey).toEqual(["providers", "catalog", "provider/one"]);
  expect(options.enabled).toBe(true);
});

test("denied catalog access is not repeated on timers, window focus, or reconnect; explicit retry still works", async () => {
  vi.useFakeTimers();
  const request = vi
    .spyOn(api, "getProviderCatalog")
    .mockRejectedValue(new Error("Keychain access was denied"));
  const client = new QueryClient();
  client.mount();
  const observer = new QueryObserver(
    client,
    providerCatalogQueryOptions("provider"),
  );
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    await vi.advanceTimersByTimeAsync(10000);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValue({ models: ["model"] });
    await observer.refetch();
    expect(request).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data?.models).toEqual(["model"]);
  } finally {
    unsubscribe();
    client.unmount();
    client.clear();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});
