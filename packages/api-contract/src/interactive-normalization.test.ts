import { test, expect } from "vitest";
import fixtures from "../fixtures/interactive-normalization.json";
import { parseCard } from "./interactive";
for (const f of fixtures)
  if (f.valid)
    test(`canonical model normalization: ${f.name}`, () =>
      expect(() => parseCard(JSON.stringify(f.canonical))).not.toThrow());
