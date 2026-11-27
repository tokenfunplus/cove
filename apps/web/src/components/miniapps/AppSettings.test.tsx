// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { MiniAppInstance, MiniAppPackage } from "@cove/api-contract";
import { miniApps } from "@/api/mini-apps";
import { AppSettings } from "./AppSettings";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("reviews the latest catalog update and applies it only to the chosen instance", async () => {
  const pkg: MiniAppPackage = {
    publisher: "cove",
    app: "book",
    name: "Book",
    version: "1.0.0",
    format: 1,
    schema_version: 1,
    capabilities: ["records.query"],
    actions: {},
    pages: [],
    collections: {},
  };
  const current = {
    id: "old",
    digest: "old-digest",
    origin: "builtin",
    package: pkg,
  };
  const book: MiniAppInstance = {
    id: "first-book",
    name: "My Japanese",
    release_id: current.id,
    revision: 4,
    enabled: true,
    grants: ["records.query"],
  };
  const entry = {
    publisher: pkg.publisher,
    app: pkg.app,
    name: pkg.name,
    schema_version: 1,
    version: "1.10.0",
    digest: "next-digest",
    origin: "catalog",
    catalog_authority: "official-key",
    official_catalog: true,
  };
  const candidate = {
    ...pkg,
    version: entry.version,
    capabilities: ["records.query", "ai.generate"],
  };
  vi.spyOn(miniApps, "releases").mockResolvedValue({ packages: [current] });
  const catalog = vi
    .spyOn(miniApps, "catalog")
    .mockResolvedValue({ packages: [{ ...entry, version: "1.2.0" }, entry] });
  const preview = vi
    .spyOn(miniApps, "catalogPreview")
    .mockResolvedValue(candidate);
  const install = vi.spyOn(miniApps, "catalogInstall").mockResolvedValue({
    id: "new",
    digest: entry.digest,
    origin: entry.origin,
    package: candidate,
  });
  const upgrade = vi
    .spyOn(miniApps, "upgrade")
    .mockResolvedValue({ ...book, release_id: "new", revision: 5 });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppSettings instance={book} pkg={pkg} removed={vi.fn()} />
    </QueryClientProvider>,
  );
  const check = await screen.findByRole("button", {
    name: "Check for updates",
  });
  expect(catalog).not.toHaveBeenCalled();
  await user.click(check);
  const apply = await screen.findByRole("button", { name: "Update to 1.10.0" });
  expect(preview).toHaveBeenCalledWith(entry);
  expect(install).not.toHaveBeenCalled();
  await user.click(screen.getByText("More access"));
  expect(
    (screen.getByRole("checkbox", { name: "Use AI tools" }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  await user.click(apply);
  await waitFor(() =>
    expect(upgrade).toHaveBeenCalledWith(book, "new", ["records.query"], false),
  );
  expect(install).toHaveBeenCalledWith(entry);
});

test("cloud permission starts off and can be changed independently of local generation", async () => {
  const pkg: MiniAppPackage = {
    publisher: "author",
    app: "notes",
    name: "Notes",
    version: "1.0.0",
    format: 1,
    schema_version: 1,
    capabilities: ["records.query", "ai.generate"],
    actions: {},
    pages: [],
    collections: {},
  };
  const instance: MiniAppInstance = {
    id: "i",
    name: "Book",
    release_id: "r",
    enabled: true,
    revision: 1,
    grants: pkg.capabilities,
    cloud_enabled: false,
  };
  vi.spyOn(miniApps, "releases").mockResolvedValue({
    packages: [{ id: "r", digest: "d", origin: "local", package: pkg }],
  });
  const save = vi.spyOn(miniApps, "settings").mockResolvedValue(instance);
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <AppSettings instance={instance} pkg={pkg} removed={vi.fn()} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const permission = screen.getByRole("checkbox", {
    name: "Allow this app to send selected input to cloud models",
  }) as HTMLInputElement;
  expect(permission.checked).toBe(false);
  await user.click(permission);
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(instance, true, pkg.capabilities, true),
  );
  await user.click(permission);
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith(
      instance,
      true,
      pkg.capabilities,
      false,
    ),
  );
});
