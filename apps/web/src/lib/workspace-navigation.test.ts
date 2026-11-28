import { expect, test } from "vitest";
import { isWorkspaceNavigation } from "./workspace-navigation";

test("navigation helper can be imported without browser globals", () => {
  expect(typeof PopStateEvent).toBe("undefined");
  expect(isWorkspaceNavigation(new Event("popstate"))).toBe(false);
});
