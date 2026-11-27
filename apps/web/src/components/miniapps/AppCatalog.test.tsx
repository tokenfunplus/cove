// @vitest-environment jsdom

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { MiniAppPackage } from "@cove/api-contract";
import type { CatalogEntry } from "@/api/mini-apps";
import {
  groupCatalog,
  PublicAppPreview,
  CatalogDetail,
  catalogPreviewOptions,
} from "./AppCatalog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

afterEach(cleanup);

function entry(
  app: string,
  version: string,
  publisher = "studio",
): CatalogEntry {
  return {
    app,
    version,
    publisher,
    name: app,
    schema_version: 1,
    digest: version,
    origin: "builtin",
  };
}

test("five releases become two app listings with the newest numeric version first", () => {
  const groups = groupCatalog([
    entry("review", "1.2.0"),
    entry("inbox", "1.0.0"),
    entry("review", "1.10.0"),
    entry("inbox", "1.1.0"),
    entry("review", "1.0.0"),
  ]);
  expect(
    groups.map((versions) => versions.map((item) => item.version)),
  ).toEqual([
    ["1.1.0", "1.0.0"],
    ["1.10.0", "1.2.0", "1.0.0"],
  ]);
});

test("publishers keep separate listings even when an app and version have the same name", () => {
  const first = entry("notes", "1.0.0", "first");
  const second = entry("notes", "1.0.0", "second");
  expect(groupCatalog([first, second, first])).toEqual([[first], [second]]);
});

test("the market preview illustrates declared sample content instead of rendering raw fields", () => {
  const pkg: MiniAppPackage = {
    format: 1,
    publisher: "studio",
    app: "review",
    name: "Review book",
    version: "1.0.0",
    schema_version: 1,
    capabilities: ["records.query"],
    collections: {
      cards: {
        fields: {
          prompt: "text",
          answer: "text",
          due: "date",
          archived: "bool",
        },
      },
    },
    actions: {
      due: {
        title: "Due cards",
        op: "query",
        collection: "cards",
        surfaces: ["page"],
        reveal_field: "answer",
      },
    },
    pages: [{ id: "daily", title: "Daily practice", actions: ["due"] }],
    seed: {
      cards: [
        {
          prompt: "A sample question",
          answer: "A sample answer",
          due: "2026-11-27",
          archived: false,
        },
      ],
    },
  };
  render(<PublicAppPreview pkg={pkg} name={pkg.name} />);
  expect(screen.getByText("A sample question")).toBeTruthy();
  expect(screen.getByText("Example")).toBeTruthy();
  expect(screen.getByText("Reveal answer")).toBeTruthy();
  expect(screen.queryByText("A sample answer")).toBeNull();
  expect(screen.queryByText("archived")).toBeNull();
  expect(screen.queryByText("false")).toBeNull();
  expect(screen.queryByText("2026-11-27")).toBeNull();
});

function showInstalledCopies(copies: { id: string; name: string }[]) {
  const selected = entry("notes", "1.0.0");
  const pkg: MiniAppPackage = {
    format: 1,
    publisher: "studio",
    app: "notes",
    name: "Notes",
    description: "Keep your notes.",
    version: "1.0.0",
    schema_version: 1,
    capabilities: [],
    collections: {},
    pages: [],
    actions: {},
  };
  const client = new QueryClient();
  client.setQueryData(catalogPreviewOptions(selected).queryKey, pkg);
  const openCopy = vi.fn(),
    install = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <CatalogDetail
        versions={[selected]}
        selected={selected}
        select={vi.fn()}
        back={vi.fn()}
        copies={copies}
        openCopy={openCopy}
        install={install}
      />
    </QueryClientProvider>,
  );
  return { openCopy, install, selected, pkg };
}

test("an installed release opens its existing data instead of creating another copy", async () => {
  const { openCopy, install, selected, pkg } = showInstalledCopies([
    { id: "saved-book", name: "My notebook" },
  ]);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open app" }));
  expect(openCopy).toHaveBeenCalledWith("saved-book");
  expect(install).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Create another copy" }));
  expect(install).toHaveBeenCalledWith(pkg, selected, true);
});

test("multiple installed copies require an explicit choice without installing anything", async () => {
  const { openCopy, install } = showInstalledCopies([
    { id: "one", name: "First notebook" },
    { id: "two", name: "Second notebook" },
  ]);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Choose a copy" }));
  expect(openCopy).not.toHaveBeenCalled();
  expect(install).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Second notebook" }));
  expect(openCopy).toHaveBeenCalledWith("two");
  expect(install).not.toHaveBeenCalled();
});
