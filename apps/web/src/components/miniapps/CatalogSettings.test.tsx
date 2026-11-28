// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { miniApps } from "@/api/mini-apps";
import { CatalogSettings } from "./CatalogSettings";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function show(expanded = true) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <CatalogSettings expanded={expanded} />
  </QueryClientProvider>);
}

test.each([
  { mode: "default", url: "", public_key: "", label: "No signed source configured" },
  { mode: "default", url: "https://official.example/catalog.json", public_key: "official-key", label: "Cove defaults" },
  { mode: "custom", url: "https://development.example/catalog.json", public_key: "development-key", label: "Configured signed source" },
] as const)("v1 displays $label without directory editing", async ({ label, ...config }) => {
  vi.spyOn(miniApps, "catalogSettings").mockResolvedValue(config);
  const save = vi.spyOn(miniApps, "saveCatalogSettings");
  const defaults = vi.spyOn(miniApps, "useCatalogDefaults");
  show();
  await screen.findByText(label);
  if (config.url) expect(screen.getByText(config.url)).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByText(config.public_key || "no key")).toBeNull();
  expect(save).not.toHaveBeenCalled();
  expect(defaults).not.toHaveBeenCalled();
});

test("collapsed source information loads only when opened", async () => {
  const read = vi.spyOn(miniApps, "catalogSettings").mockResolvedValue({ url: "", public_key: "" });
  show(false);
  expect(read).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText("Release source"));
  await screen.findByText("No signed source configured");
  expect(read).toHaveBeenCalledOnce();
});

test("a source read failure remains visible without offering authority changes", async () => {
  vi.spyOn(miniApps, "catalogSettings").mockRejectedValue(new Error("Source unavailable"));
  show();
  expect((await screen.findByRole("alert")).textContent).toBe("Source unavailable");
  expect(screen.queryByRole("textbox")).toBeNull();
});
