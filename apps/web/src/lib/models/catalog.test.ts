import { expect, test } from "vitest";
import { browseModels, defaultCatalogFilter } from "./catalog";
import { parseModelPreferences } from "@/hooks/providers/use-model-preferences";
const preferences = {
  favorites: [{ providerId: "p", modelId: "free" }],
  recent: [{ providerId: "p", modelId: "paid" }],
  presets: [],
};
const metadata = {
  free: {
    id: "free",
    privacy_mode: "incognito" as const,
    verifiable: false,
    context_length: 128000,
    input_price_per_million: 0,
    output_price_per_million: 0,
    capabilities: ["reasoning" as const],
  },
  paid: {
    id: "paid",
    privacy_mode: "incognito" as const,
    verifiable: false,
    context_length: 1000000,
    input_price_per_million: 1,
    output_price_per_million: 2,
  },
};
test("favorites and recent models lead without duplicate rows", () => {
  const rows = browseModels(
    ["unknown", "paid", "free"],
    metadata,
    "p",
    preferences,
    defaultCatalogFilter,
  );
  expect(rows.map((row) => row.id)).toEqual(["free", "paid", "unknown"]);
  expect(
    browseModels(["free", "paid"], metadata, "other", preferences, {
      ...defaultCatalogFilter,
      view: "favorites",
    }),
  ).toEqual([]);
});
test("filters exclude missing metadata and keep reported zero prices", () => {
  expect(
    browseModels(["unknown", "paid", "free"], metadata, "p", preferences, {
      ...defaultCatalogFilter,
      maximumPrice: "0",
    }).map((row) => row.id),
  ).toEqual(["free"]);
  expect(
    browseModels(["unknown", "paid", "free"], metadata, "p", preferences, {
      ...defaultCatalogFilter,
      minimumContext: 200000,
    }).map((row) => row.id),
  ).toEqual(["paid"]);
  expect(
    browseModels(["unknown", "paid", "free"], metadata, "p", preferences, {
      ...defaultCatalogFilter,
      capability: "reasoning",
    }).map((row) => row.id),
  ).toEqual(["free"]);
});
test("stored preferences retain only bounded model identities and named combinations", () => {
  const parsed = parseModelPreferences(
    JSON.stringify({
      ...preferences,
      secret: "must be discarded",
      favorites: [
        ...preferences.favorites,
        ...preferences.favorites,
        { providerId: 42, modelId: "invalid" },
      ],
      presets: [
        {
          id: "preset",
          name: "Pair",
          targets: preferences.favorites,
          secret: "discarded",
        },
      ],
    }),
  );
  expect(parsed.favorites).toHaveLength(1);
  expect(JSON.stringify(parsed)).not.toContain("secret");
  expect(parsed.presets[0]?.name).toBe("Pair");
  expect(parseModelPreferences("invalid").favorites).toEqual([]);
});
