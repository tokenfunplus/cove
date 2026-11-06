import { resolvedThemePreference } from "@/theme/theme";
import { expect, test } from "vitest";

test("resolved theme preference maps system to a concrete edition", () => {
  expect(resolvedThemePreference("light")).toBe("light");
  expect(resolvedThemePreference("dark")).toBe("dark");
});
