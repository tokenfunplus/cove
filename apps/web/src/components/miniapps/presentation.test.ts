import { expect, test } from "vitest";
import type { MiniAppPackage } from "@cove/api-contract";
import { canUpgrade } from "./presentation";

test("catalog updates preserve the independent publisher of a bundled app and isolate local packages", () => {
  const before: MiniAppPackage = {
    format: 1,
    publisher: "bookshelf",
    app: "reading-inbox",
    name: "Inbox",
    version: "1.0.0",
    schema_version: 1,
    capabilities: [],
    collections: {},
    pages: [],
    actions: {},
  };
  const after = { ...before, version: "1.1.0" };
  expect(
    canUpgrade(
      before,
      after,
      "builtin",
      "catalog",
      {},
      { official_catalog: true },
    ),
  ).toBe(true);
  expect(canUpgrade(before, after, "builtin", "catalog")).toBe(false);
  expect(canUpgrade(before, after, "builtin", "local")).toBe(false);
  expect(canUpgrade(before, after, "local", "catalog")).toBe(false);
  expect(
    canUpgrade(
      before,
      { ...after, publisher: "another" },
      "builtin",
      "catalog",
    ),
  ).toBe(false);
});

test("catalog upgrade choices bind the original signing authority, including legacy unknown authorities", () => {
  const before = {
    publisher: "author",
    app: "notes",
    version: "1.0.0",
    schema_version: 1,
  } as MiniAppPackage;
  const after = { ...before, version: "1.1.0" };
  expect(
    canUpgrade(
      before,
      after,
      "catalog",
      "catalog",
      { catalog_authority: "key-a" },
      { catalog_authority: "key-a" },
    ),
  ).toBe(true);
  expect(
    canUpgrade(
      before,
      after,
      "catalog",
      "catalog",
      { catalog_authority: "key-a" },
      { catalog_authority: "key-b" },
    ),
  ).toBe(false);
  expect(
    canUpgrade(
      before,
      after,
      "catalog",
      "catalog",
      {},
      { catalog_authority: "key-a" },
    ),
  ).toBe(false);
  expect(
    canUpgrade(before, after, "catalog", "builtin", {
      official_catalog: true,
    }),
  ).toBe(true);
  expect(canUpgrade(before, after, "catalog", "builtin")).toBe(false);
});
