import { describe, it, expect } from "vitest";
import fixtures from "../fixtures/interactive-cards.json";
import {
  parseCard,
  validateCardValues,
  cardAllocations,
  type CardValues,
} from "./interactive";
describe("interactive card contract", () => {
  for (const f of fixtures.valid)
    it(`accepts ${f.name}`, () =>
      expect(parseCard(f.source).version).toBe(JSON.parse(f.source).version));
  for (const f of fixtures.invalid)
    it(`rejects ${f.name}`, () => expect(() => parseCard(f.source)).toThrow());
  it("checks required, multi-choice and stale feedback values", () => {
    const d = parseCard(fixtures.valid[0].source);
    expect(() =>
      validateCardValues(d, { next_action: "" }, {}, true),
    ).toThrow();
    expect(() =>
      validateCardValues(d, { next_action: "radio" }, {}, true),
    ).not.toThrow();
    const q = parseCard(fixtures.valid[1].source);
    expect(() =>
      validateCardValues(
        q,
        { next_action: "radio" },
        { feedback: "footprints" },
      ),
    ).toThrow();
    const m = parseCard(fixtures.valid[3].source);
    expect(() =>
      validateCardValues(m, { next_action: ["radio", "radio"] }),
    ).toThrow();
  });
});

for (const fixture of fixtures.values)
  it(`validates rich values: ${fixture.name}`, () => {
    const d = parseCard(
      fixtures.valid.find((f) => f.name === fixture.definition)!.source,
    );
    const check = () => validateCardValues(d, fixture.values as CardValues);
    if (fixture.valid) expect(check).not.toThrow();
    else expect(check).toThrow();
  });
it("recomputes bounded allocations and requires nonblank submitted text", () => {
  const d = parseCard(
    fixtures.valid.find((f) => f.name === "playground")!.source,
  );
  expect(
    cardAllocations(d, { ...d.spec.state, food: 100, travel: 20 }).budget,
  ).toMatchObject({
    calculation: "allocation-sum-v1",
    sum: 120,
    remaining: -20,
  });
  expect(() =>
    validateCardValues(d, { ...d.spec.state, draft: "   " }, {}, true),
  ).toThrow();
});
