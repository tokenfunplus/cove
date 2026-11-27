import { expect, test } from "vitest";
import { isWorkspaceNavigation, workspaceEntry } from "./workspace-navigation";

test("navigation metadata can be imported and inspected without browser globals", () => {
  expect(typeof PopStateEvent).toBe("undefined");
  expect(isWorkspaceNavigation(new Event("popstate"))).toBe(false);
  expect(workspaceEntry({ unrelated: "state" })).toBeUndefined();
  expect(
    workspaceEntry({
      "cove.workspace-history.v1": {
        lineage: "lineage",
        index: 2,
        key: "entry",
      },
    }),
  ).toEqual({ lineage: "lineage", index: 2, key: "entry" });
});
