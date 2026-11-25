import { expect, test } from "vitest";
import sources from "../fixtures/interactive-sources.json";
import examples from "../examples/interactive-v2.json";
import { cardBlock, cardFallback } from "./interactive-source";
import { parseCard } from "./interactive";
for (const fixture of sources)
  test(`card framing: ${fixture.name}`, () => {
    const block = cardBlock(fixture.body);
    expect(Boolean(block?.complete)).toBe(fixture.valid);
    if ("prose" in fixture) expect(block?.prose).toBe(fixture.prose);
  });
for (const example of examples)
  test(`legacy canonical example: ${example.name}`, () =>
    expect(() => parseCard(JSON.stringify(example.definition))).not.toThrow());
test("bounded fallback is readable without enabling unsupported definitions", () => {
  expect(
    cardFallback(
      '{"fallback":"Keep this useful explanation","version":"unknown"}',
    ),
  ).toBe("Keep this useful explanation");
  expect(cardFallback('{"fallback":"x","fallback":"y"}')).toBeUndefined();
  expect(
    cardFallback('{"fallback":"' + "x".repeat(2001) + '"}'),
  ).toBeUndefined();
});

test("large trailing whitespace keeps fence rules without backtracking", () => {
  const tabs = "\t".repeat(100000);
  const block = cardBlock(
    "Prose" +
      tabs +
      "\n```cove-ui\n" +
      '{"cove_ui":1,"title":"Recall","continue":false,"children":[{"type":"Text","content":"A word"}]}' +
      "\n```" +
      tabs,
  );
  expect(block?.complete).toBe(true);
  expect(block?.prose).toBe("Prose" + tabs + "\n");
});
