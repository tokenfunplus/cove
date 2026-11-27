// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { miniApps } from "@/api/mini-apps";
import { CatalogSettings } from "./CatalogSettings";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("a signing authority change previews its key and requires a separate confirmation", async () => {
  const old = {
    url: "https://old.example/catalog.json",
    public_key: "old-key",
  };
  vi.spyOn(miniApps, "catalogSettings").mockResolvedValue(old);
  const save = vi
    .spyOn(miniApps, "saveCatalogSettings")
    .mockResolvedValue(undefined);
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <CatalogSettings />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByText("Catalog settings"));
  const key = await screen.findByRole("textbox", {
    name: "Ed25519 public key",
  });
  await user.clear(key);
  await user.type(key, "next-key");
  await user.click(
    screen.getByRole("button", { name: "Save catalog settings" }),
  );
  await screen.findByText("Trust this catalog signing authority?");
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText(/The new signing key is next-key/)).toBeDefined();
  await user.click(
    screen.getByRole("button", { name: "Keep current authority" }),
  );
  expect(save).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Save catalog settings" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Confirm signing authority" }),
  );
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(old.url, "next-key", old),
  );
});
