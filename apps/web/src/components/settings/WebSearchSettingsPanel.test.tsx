// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "@/api/web-search";
import type { WebSearchSettings } from "@cove/api-contract";
import { WebSearchSettingsPanel } from "./WebSearchSettingsPanel";

vi.mock("@/api/web-search", () => ({ getWebSearchSettings: vi.fn(), saveWebSearchSettings: vi.fn(), deleteWebSearchKey: vi.fn(), testWebSearchConnection: vi.fn() }));
const settings: WebSearchSettings = { policy: { provider: "tavily", max_searches: 3, max_pages: 5, max_rounds: 8, max_results: 5, timeout_seconds: 90, depth: "standard" }, providers: [{ provider: "tavily", configured: true }, { provider: "linkup", configured: false }, { provider: "exa", configured: false }] };
const shimmed: string[] = [];

beforeEach(() => {
  vi.mocked(api.getWebSearchSettings).mockResolvedValue(structuredClone(settings));
  vi.mocked(api.saveWebSearchSettings).mockImplementation(async policy => ({ ...structuredClone(settings), policy }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  for (const name of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture", "scrollIntoView"]) {
    if (Reflect.get(Element.prototype, name) !== undefined) continue;
    Object.defineProperty(Element.prototype, name, { configurable: true, value: name === "hasPointerCapture" ? () => false : () => {} });
    shimmed.push(name);
  }
});
afterEach(() => {
  cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals();
  for (const name of shimmed.splice(0)) Reflect.deleteProperty(Element.prototype, name);
});

test("custom provider and depth controls preserve edited limits and normalized filters", async () => {
  const user = userEvent.setup(), saved = vi.fn();
  render(<WebSearchSettingsPanel onSaved={saved} />);
  const provider = await screen.findByRole("combobox", { name: "Default search provider" });
  expect(provider.tagName).toBe("BUTTON");
  await user.click(provider);
  await user.click(screen.getByRole("option", { name: "Linkup" }));
  await user.click(screen.getByRole("button", { name: "Increase search requests" }));
  expect(screen.getByText(/Four models can use up to/).textContent).toContain("16 searches");
  expect(screen.queryByRole("combobox", { name: "Search depth" })).toBeNull();
  await user.click(screen.getByRole("button", { name: /Advanced settings/ }));
  await user.click(screen.getByRole("combobox", { name: "Search depth" }));
  await user.click(screen.getByRole("option", { name: /Deep/ }));
  await user.type(screen.getByLabelText("Include domains"), "example.com, docs.example.com, ");
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(api.saveWebSearchSettings).toHaveBeenCalledWith(expect.objectContaining({ provider: "linkup", depth: "deep", max_searches: 4, include_domains: ["example.com", "docs.example.com"] }), ""));
  expect(saved).toHaveBeenCalledOnce();
});

test("failed key validation retains the draft and leaves the saved connection untouched", async () => {
  const user = userEvent.setup(), saved = vi.fn();
  vi.mocked(api.saveWebSearchSettings).mockRejectedValue(new Error("Search API key rejected."));
  render(<WebSearchSettingsPanel onSaved={saved} />);
  const field = await screen.findByLabelText("Replace search API key");
  await user.type(field, "synthetic-replacement");
  await user.click(screen.getByRole("button", { name: "Show API key" }));
  expect((field as HTMLInputElement).type).toBe("text");
  await user.click(screen.getByRole("button", { name: "Test and save" }));
  await screen.findByRole("alert");
  expect((field as HTMLInputElement).value).toBe("synthetic-replacement");
  expect(saved).not.toHaveBeenCalled();
  expect(screen.getByText("Key saved in macOS Keychain")).toBeTruthy();
});
