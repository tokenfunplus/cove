// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { miniApps } from "@/api/mini-apps";
import { CatalogSettings } from "./CatalogSettings";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("Use Cove defaults restores unsaved edits when defaults are already active", async () => {
  const defaults = {
    url: "https://official.example/catalog.json",
    public_key: "official-key",
  };
  vi.spyOn(miniApps, "catalogSettings").mockResolvedValue({
    ...defaults,
    defaults,
    mode: "default",
  });
  const save = vi.spyOn(miniApps, "useCatalogDefaults");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CatalogSettings expanded />
    </QueryClientProvider>,
  );
  const input = await screen.findByRole("textbox", {
    name: "HTTPS catalog URL",
  });
  await userEvent.clear(input);
  await userEvent.type(input, "https://edited.example/catalog.json");
  await userEvent.click(
    screen.getByRole("button", { name: "Use Cove defaults" }),
  );
  expect((input as HTMLInputElement).value).toBe(defaults.url);
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toBe(
    "Catalog settings saved.",
  );
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

test("restoring Cove defaults reviews the packaged key before removing the custom override", async () => {
  const old = {
    url: "https://custom.example/catalog.json",
    public_key: "custom-key",
  };
  const defaults = {
    url: "https://official.example/catalog.json",
    public_key: "official-key",
  };
  vi.spyOn(miniApps, "catalogSettings").mockResolvedValue({
    ...old,
    defaults,
    mode: "custom" as const,
  });
  const restore = vi
    .spyOn(miniApps, "useCatalogDefaults")
    .mockResolvedValue(undefined);
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <CatalogSettings expanded />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Use Cove defaults" }),
  );
  await screen.findByText(/The new signing key is official-key/);
  expect(restore).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Confirm signing authority" }),
  );
  await waitFor(() => expect(restore).toHaveBeenCalledWith(old));
});

test("saved feedback survives the authority form refreshing and clears when edited", async () => {
  const before = {
    url: "https://old.example/catalog.json",
    public_key: "old-key",
  };
  const after = {
    url: "https://old.example/catalog.json",
    public_key: "new-key",
    mode: "custom" as const,
  };
  vi.spyOn(miniApps, "catalogSettings")
    .mockResolvedValueOnce(before)
    .mockResolvedValue(after);
  vi.spyOn(miniApps, "saveCatalogSettings").mockResolvedValue(undefined);
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <CatalogSettings expanded />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const key = await screen.findByRole("textbox", {
    name: "Ed25519 public key",
  });
  await user.clear(key);
  await user.type(key, "new-key");
  await user.click(
    screen.getByRole("button", { name: "Save catalog settings" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Confirm signing authority" }),
  );
  await screen.findByText("Current source: Custom directory.");
  expect(await screen.findByText("Catalog settings saved.")).toBeTruthy();
  await user.type(
    screen.getByRole("textbox", { name: "Ed25519 public key" }),
    "x",
  );
  expect(screen.queryByText("Catalog settings saved.")).toBeNull();
});

test("saving unchanged empty defaults cannot pin a bundled-only override", async () => {
  vi.spyOn(miniApps, "catalogSettings").mockResolvedValue({
    url: "",
    public_key: "",
    defaults: { url: "", public_key: "" },
    mode: "default",
  });
  const save = vi.spyOn(miniApps, "saveCatalogSettings");
  const restore = vi.spyOn(miniApps, "useCatalogDefaults");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CatalogSettings expanded />
    </QueryClientProvider>,
  );
  const button = (await screen.findByRole("button", {
    name: "Save catalog settings",
  })) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "Use Cove defaults",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.submit(button.closest("form")!);
  expect(save).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Ed25519 public key" }),
    " ",
  );
  expect(button.disabled).toBe(true);
});
