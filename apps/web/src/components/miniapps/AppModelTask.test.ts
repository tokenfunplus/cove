import { expect, test } from "vitest";
import type { MiniAppAction } from "@cove/api-contract";
import { candidateRows } from "./AppModelTask";

const action: MiniAppAction = {
  title: "Save question",
  op: "create",
  inputs: { question: "text", answer: "text" },
  surfaces: ["page"],
};
const candidate = { question: "A question?", answer: "An answer." };
const result = JSON.stringify([candidate]);

test("counted candidates accept a single fenced array and reject the entire mismatched response", () => {
  expect(candidateRows(result, action, 1)).toEqual([candidate]);
  expect(
    candidateRows(
      "\u0060\u0060\u0060json\n" + result + "\n\u0060\u0060\u0060",
      action,
      1,
    ),
  ).toEqual([candidate]);
  for (const text of [
    JSON.stringify([candidate, candidate]),
    JSON.stringify([candidate, {}]),
    JSON.stringify([{ ...candidate, source: "forged" }]),
    result + " extra commentary",
    "Here are the results.\n" + result,
  ])
    expect(candidateRows(text, action, 1)).toEqual([]);
});

test("a malformed row does not discard well-typed candidates in the same counted result", () => {
  expect(
    candidateRows(
      JSON.stringify([candidate, { question: "Missing answer" }]),
      action,
      2,
    ),
  ).toEqual([candidate]);
  expect(
    candidateRows(
      JSON.stringify([{ ...candidate, extra: "unknown field" }, candidate]),
      action,
      2,
    ),
  ).toEqual([candidate]);
});
