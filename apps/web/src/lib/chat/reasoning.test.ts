import { expect, test } from "vitest";
import { splitReasoning } from "@/lib/chat/reasoning";

test.each(["think", "reasoning", "analysis"])(
  "separates a leading %s block from the answer",
  (tag) => {
    expect(
      splitReasoning(
        `\n<${tag}>Consider **both** options.</${tag}>\n\nThe answer.`,
      ),
    ).toEqual({
      reasoning: "Consider **both** options.",
      answer: "\n\nThe answer.",
    });
  },
);

test("successive reasoning blocks share one disclosure without swallowing the answer", () => {
  expect(
    splitReasoning("<think>First.</think>\n<THINK>Second.</THINK>\nAnswer."),
  ).toEqual({
    reasoning: "First.\n\nSecond.",
    answer: "\nAnswer.",
  });
});

test("fragmented stream tags stay out of visible text until their meaning is known", () => {
  expect(splitReasoning("<thi", true)).toEqual({
    reasoning: undefined,
    answer: "",
  });
  expect(splitReasoning("<think>Partial thought.</thi", true)).toEqual({
    reasoning: "Partial thought.",
    answer: "",
  });
  expect(splitReasoning("<think>Thought.</think>\nFinal", true)).toEqual({
    reasoning: "Thought.",
    answer: "\nFinal",
  });
});

test("an unfinished final response retains all text, including an incomplete closing tag", () => {
  expect(splitReasoning("<thi")).toEqual({
    reasoning: undefined,
    answer: "<thi",
  });
  expect(splitReasoning("<think>Unfinished.</thi")).toEqual({
    reasoning: "Unfinished.</thi",
    answer: "",
  });
});

test.each([
  "Ordinary answer.",
  "Use `<think>` to mark a section.",
  "```xml\n<think>Example, not model reasoning.</think>\n```",
  "An example follows:\n<think>Literal example.</think>",
])("preserves ordinary Markdown and tag examples: %s", (content) => {
  expect(splitReasoning(content, true)).toEqual({
    reasoning: undefined,
    answer: content,
  });
});
