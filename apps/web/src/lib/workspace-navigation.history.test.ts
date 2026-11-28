// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { chatOriginFor, ensureWorkspaceEntry, navigateWorkspace, rebaseWorkspaceFragment, trackWorkspaceFragment, workspaceEntry, type WorkspaceEntry } from "./workspace-navigation";

const entryKey = "cove.workspace-history.v1";
const origin = { lineage: "original-lineage", index: 1, key: "known-chat" };
const fresh = { lineage: "fresh-lineage", index: 0, key: "fragment" };
beforeEach(() => window.history.replaceState(null, "", "/"));

test("a compact Chat origin survives derived entries without nested state or extra fields", () => {
  const source = { ...origin, state: { secret: "must-not-copy" }, chatOrigin: { secret: "must-not-nest" } };
  const hint = chatOriginFor(source as unknown as WorkspaceEntry, window.location.href)!;
  expect(hint).toEqual({ entry: origin, href: window.location.href });
  const rebased = rebaseWorkspaceFragment(hint);
  expect(workspaceEntry()?.chatOrigin).toEqual(hint);
  expect(trackWorkspaceFragment(rebased).chatOrigin).toEqual(hint);
  navigateWorkspace("/apps");
  expect(workspaceEntry()?.chatOrigin).toEqual(hint);
  expect(JSON.stringify(window.history.state)).not.toContain("secret");
  expect(JSON.stringify(window.history.state)).not.toContain("must-not");
});

test.each([
  { name: "foreign origin", href: "https://foreign.invalid/", entry: origin },
  { name: "Apps route", href: () => window.location.origin + "/apps", entry: origin },
  { name: "launch auth fragment", href: () => window.location.origin + "/#cove-session=secret&intent=settings", entry: origin },
  { name: "encoded auth fragment", href: () => window.location.origin + "/#%63ove-session=secret", entry: origin },
  { name: "auth query", href: () => window.location.origin + "/?cove-session=secret", entry: origin },
  { name: "negative position", href: () => window.location.origin + "/", entry: { ...origin, index: -1 } },
  { name: "invalid identity", href: () => window.location.origin + "/", entry: { ...origin, key: null } },
  { name: "self reference", href: () => window.location.origin + "/", entry: fresh },
  { name: "unproven forward origin", href: () => window.location.origin + "/", entry: { ...origin, lineage: fresh.lineage } },
])("ignores $name hints while retaining backward-compatible entry metadata", ({ href, entry }) => {
  const hint = { entry, href: typeof href === "function" ? href() : href };
  expect(workspaceEntry({ [entryKey]: { ...fresh, chatOrigin: hint } })).toEqual(fresh);
});

test("legacy history entries and unrelated browser state remain compatible", () => {
  window.history.replaceState({ [entryKey]: origin, preserved: "other-router" }, "");
  expect(workspaceEntry()).toEqual(origin);
  expect(ensureWorkspaceEntry()).toEqual(origin);
  expect(window.history.state.preserved).toBe("other-router");
});
