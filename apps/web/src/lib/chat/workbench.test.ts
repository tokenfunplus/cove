import { expect, test } from "vitest";
import {
  reduceWorkbench,
  revisionPrompt,
  workbenchDiff,
  workbenchHistory,
} from "@/lib/chat/workbench";

test("editing coalesces typing and preserves undo/redo across applied revisions", () => {
  let state = workbenchHistory("original");
  state = reduceWorkbench(state, { type: "edit", content: "a" });
  state = reduceWorkbench(state, { type: "edit", content: "ab" });
  state = reduceWorkbench(state, { type: "checkpoint" });
  state = reduceWorkbench(state, { type: "replace", content: "revised" });
  state = reduceWorkbench(state, { type: "undo" });
  expect(state.content).toBe("ab");
  state = reduceWorkbench(state, { type: "undo" });
  expect(state.content).toBe("original");
  state = reduceWorkbench(state, { type: "redo" });
  expect(state.content).toBe("ab");
  state = reduceWorkbench(state, { type: "edit", content: "another" });
  expect(state.future).toEqual([]);
});

test("diff includes additions and deletions while retaining shared boundary lines", () => {
  expect(workbenchDiff("first\nold\nlast", "first\nnew\nlast")).toEqual([
    { kind: "same", text: "first" },
    { kind: "removed", text: "old" },
    { kind: "added", text: "new" },
    { kind: "same", text: "last" },
  ]);
  expect(
    workbenchDiff("a", "").filter((line) => line.kind === "removed"),
  ).toEqual([{ kind: "removed", text: "a" }]);
});

test("a selection rewrite carries the full reference but requests only a replacement passage", () => {
  const prompt = revisionPrompt("start quoted end", "Simplify", {
    start: 6,
    end: 12,
  });
  expect(prompt).toContain('"passage":"quoted"');
  expect(prompt).toContain('"document":"start quoted end"');
  expect(prompt).toContain("only the selected passage");
});
