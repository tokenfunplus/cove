// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import * as api from "@/api/web-search";
import { useWebSearch } from "./use-web-search";
import type { WebSearchSettings } from "@cove/api-contract";
vi.mock("@/api/web-search", () => ({ getWebSearchSettings: vi.fn() }));
afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); });
const settings: WebSearchSettings = { policy: { provider: "tavily", max_searches: 3, max_pages: 5, max_rounds: 8, max_results: 5, timeout_seconds: 90, depth: "standard" }, providers: [{ provider: "tavily", configured: false }] };

test("unconfigured toggle opens setup and enables only the original conversation after save", async () => {
  vi.mocked(api.getWebSearchSettings).mockResolvedValue(settings);
  const open = vi.fn(), feedback = vi.fn();
  const { result, rerender } = renderHook(({ id }) => useWebSearch(id, open, feedback), { initialProps: { id: "chat-1" } });
  await act(() => result.current.toggle());
  expect(open).toHaveBeenCalledWith("web-search");
  expect(result.current.enabled).toBe(false);
  const configured: WebSearchSettings = { ...settings, providers: [{ provider: "tavily", configured: true }] };
  act(() => result.current.configured(configured));
  expect(result.current.enabled).toBe(true);
  expect(result.current.budgetLabel(4)).toContain("12 search requests");
  rerender({ id: "chat-2" }); expect(result.current.enabled).toBe(false);
  rerender({ id: "chat-1" }); expect(result.current.enabled).toBe(true);
  await act(() => result.current.toggle()); expect(result.current.enabled).toBe(false);
});
