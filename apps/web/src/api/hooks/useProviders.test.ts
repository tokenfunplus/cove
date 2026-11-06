import { providerCatalogQueryOptions } from "@/api/hooks/useProviders";
import { expect, test } from "vitest";

test("Provider catalog query options identify one cached catalog per Provider", () => {
  const options = providerCatalogQueryOptions("provider/one");

  expect(options.queryKey).toEqual(["providers", "catalog", "provider/one"]);
  expect(options.enabled).toBe(true);
});
