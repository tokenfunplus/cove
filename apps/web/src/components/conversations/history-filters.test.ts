import { expect, test } from "vitest";
import { defaultHistoryFilters, filterHistory, historyQueryFilter, parseHistoryFilters } from "./history-filters";

test("local calendar cutoffs include their boundary and compose with conversation type", () => {
  const now = new Date(2026, 10, 19, 15, 30);
  const filter = historyQueryFilter({ activity: "7d", kind: "debate" }, now);
  const boundary = new Date(2026, 10, 13).toISOString();
  expect(filter).toEqual({ kind: "debate", updatedAfter: boundary });
  const item = { id: "debate", title: "Synthetic debate", created_at: boundary, updated_at: boundary, debate_id: "debate" };
  expect(filterHistory([item, { ...item, id: "chat", debate_id: undefined }, { ...item, id: "old", updated_at: new Date(Date.parse(boundary) - 1).toISOString() }], filter).map(item => item.id)).toEqual(["debate"]);
  expect(historyQueryFilter({ activity: "today", kind: "all" }, now)).toEqual({ updatedAfter: new Date(2026, 10, 19).toISOString() });
  expect(historyQueryFilter({ activity: "30d", kind: "chat" }, now)).toEqual({ kind: "chat", updatedAfter: new Date(2026, 9, 21).toISOString() });
  expect(historyQueryFilter(defaultHistoryFilters, now)).toEqual({});
});

test("stored preferences accept only filter enums and discard extra data", () => {
  expect(parseHistoryFilters('{"activity":"7d","kind":"debate","query":"Do not retain this"}')).toEqual({ activity: "7d", kind: "debate" });
  for (const value of [null, "invalid", '{"kind":["debate"]}', '{"activity":7}', "x".repeat(513)]) expect(parseHistoryFilters(value)).toEqual(defaultHistoryFilters);
});
