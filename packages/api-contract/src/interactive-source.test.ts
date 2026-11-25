import { expect, test } from "vitest";
import sources from "../fixtures/interactive-sources.json";
import examples from "../examples/interactive-v2.json";
import { cardBlock, cardFallback } from "./interactive-source";
import { parseCard } from "./interactive";
for (const fixture of sources)
  test(`card framing: ${fixture.name}`, () => {
    const block = cardBlock(fixture.body);
    const valid = () => {
      if (!block || !block.complete) throw new Error("No complete block");
      if(JSON.parse(block.json).cove_ui!==1)parseCard(block.json);
    };
    if (fixture.valid) expect(valid).not.toThrow();
    else expect(valid).toThrow();
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
