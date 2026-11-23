// @vitest-environment jsdom

import { replaceBrowserSession } from "@/api/client";
import { providerKeys, sessionKey, settingsKey } from "@/api/queryKeys";
import { quickPanelFocusEvent, quickPanelSessionEvent } from "@/lib/quick-panel";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { useQuickPanelBridge } from "./use-quick-panel-bridge";

vi.mock("@/api/client", () => ({
  observeBrowserSessionExpiry: () => () => {},
  replaceBrowserSession: vi.fn(),
}));

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("replacing a Quick Panel session refreshes settings and Providers after its session check", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const catalogKey = providerKeys.catalog("fixture");
  const cachedSettings = { theme: "light" };
  const currentSettings = { theme: "dark" };
  const cachedProviders = [{ id: "fixture", configured: true }];
  const currentProviders = [{ id: "fixture", configured: false }];
  cache.setQueryData(sessionKey, true);
  cache.setQueryData(settingsKey, cachedSettings);
  cache.setQueryData(providerKeys.list, cachedProviders);
  cache.setQueryData(catalogKey, { models: ["fixture-model"] });

  const oldSettings = deferred<typeof cachedSettings>();
  const oldProviders = deferred<typeof cachedProviders>();
  const sessionReady = deferred<boolean>();
  const getSettings = vi.fn().mockReturnValueOnce(oldSettings.promise).mockResolvedValueOnce(currentSettings);
  const getProviders = vi.fn().mockReturnValueOnce(oldProviders.promise).mockResolvedValueOnce(currentProviders);
  const getSession = vi.fn(() => sessionReady.promise);
  const getCatalog = vi.fn();
  const { result } = renderHook(() => {
    const bridge = useQuickPanelBridge("composer");
    useQuery({ queryKey: sessionKey, queryFn: getSession });
    useQuery({ queryKey: settingsKey, queryFn: getSettings });
    useQuery({ queryKey: providerKeys.list, queryFn: getProviders });
    useQuery({ queryKey: catalogKey, queryFn: getCatalog });
    return bridge;
  }, {
    wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={cache}>{children}</QueryClientProvider>,
  });

  act(() => {
    void cache.refetchQueries({ queryKey: settingsKey });
    void cache.refetchQueries({ queryKey: providerKeys.list });
  });
  await waitFor(() => {
    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(getProviders).toHaveBeenCalledTimes(1);
  });

  act(() => window.dispatchEvent(new CustomEvent(quickPanelSessionEvent, { detail: { token: "replacement-session" } })));
  await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
  expect(replaceBrowserSession).toHaveBeenCalledWith("replacement-session");
  expect(cache.getQueryState(settingsKey)).toMatchObject({ status: "success", data: cachedSettings, fetchStatus: "idle" });
  expect(cache.getQueryState(providerKeys.list)).toMatchObject({ status: "success", data: cachedProviders, fetchStatus: "idle" });

  act(() => window.dispatchEvent(new Event(quickPanelFocusEvent)));
  expect(getSettings).toHaveBeenCalledTimes(1);
  expect(getProviders).toHaveBeenCalledTimes(1);
  expect(result.current.recovery).toBe("connecting");

  await act(async () => sessionReady.resolve(true));
  await waitFor(() => expect(result.current.recovery).toBeUndefined());
  expect(getSettings).toHaveBeenCalledTimes(2);
  expect(getProviders).toHaveBeenCalledTimes(2);
  expect(getCatalog).not.toHaveBeenCalled();

  await act(async () => {
    oldSettings.resolve(cachedSettings);
    oldProviders.resolve(cachedProviders);
  });
  expect(cache.getQueryData(settingsKey)).toEqual(currentSettings);
  expect(cache.getQueryData(providerKeys.list)).toEqual(currentProviders);
});
