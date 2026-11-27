import { webcrypto } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { proposalOperationId } from "./mini-app-proposal";

afterEach(() => vi.unstubAllGlobals());

test("a proposal keeps its operation across reloads, midnight and record revision changes", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const command = {
    action: "review.mark",
    surface: "chat" as const,
    operation_id: "unused",
    inputs: { date: "2026-11-27" },
    records: [{ id: "record", revision: 1 }],
  };
  const original = await proposalOperationId(
    "generation",
    "book",
    "release",
    { date: "2026-11-27" },
    command,
  );
  const reopened = await proposalOperationId(
    "generation",
    "book",
    "release",
    { date: "2026-11-28" },
    {
      ...command,
      inputs: { date: "2026-11-28" },
      records: [{ id: "record", revision: 2 }],
    },
  );
  expect(reopened).toBe(original);
  expect(
    await proposalOperationId(
      "new-generation",
      "book",
      "release",
      { date: "2026-11-27" },
      command,
    ),
  ).not.toBe(original);
  expect(
    await proposalOperationId(
      "generation",
      "book",
      "release",
      { date: "2026-11-27" },
      { ...command, inputs: { date: "2026-12-01" } },
    ),
  ).not.toBe(original);
});

test("changing the target or candidate content creates a distinct reviewed operation", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const command = {
    action: "notes.add",
    surface: "chat" as const,
    operation_id: "unused",
    inputs: {},
    items: [{ title: "Original" }],
  };
  const original = await proposalOperationId(
    "generation",
    "book",
    "release",
    {},
    command,
  );
  expect(
    await proposalOperationId(
      "generation",
      "book",
      "release",
      {},
      { ...command, items: [{ title: "Changed" }] },
    ),
  ).not.toBe(original);
  expect(
    await proposalOperationId(
      "generation",
      "other-book",
      "release",
      {},
      command,
    ),
  ).not.toBe(original);
});
