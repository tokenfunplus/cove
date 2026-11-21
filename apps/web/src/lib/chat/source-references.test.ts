import { expect, test } from "vitest";
import { citedSources } from "./source-references";
import type { AttachmentSnapshot } from "@cove/api-contract";

test("references retain valid citation order and exclude unknown sources, sections, and code examples", () => {
  const source: AttachmentSnapshot = { id: "a".repeat(64), name: "Evidence", media_type: "text/plain", extraction_version: "v1", characters: 8, size: 8, sections: [{ id: "L1", text: "Evidence" }] };
  const valid = `[Evidence](cove:${source.id}:L1)`;
  expect(citedSources(`${valid} ${valid} [invalid](cove:${source.id}:L2) [invented](cove:${"b".repeat(64)}:L1)`, [source])).toEqual([{ source, section: "L1" }]);
  expect(citedSources(`\`${valid}\`\n\n\`\`\`\n${valid}\n\`\`\``, [source])).toEqual([]);
  expect(citedSources(`    ${valid}\n\n\t${valid}\n\n~~~markdown\n${valid}\n~~~~\n`, [source])).toEqual([]);
  expect(citedSources(`\`\`\`\`markdown\n${valid}\n\`\`\`\n${valid}\n\`\`\`\`\n${valid}`, [source])).toEqual([{ source, section: "L1" }]);
});

test.each([
  ["paragraph continuation", "Evidence:\n    ", true],
  ["tabbed paragraph continuation", "Evidence:\n \t", true],
  ["standalone indented code", "    ", false],
  ["tabbed indented code", " \t", false],
  ["code after a blank line", "Evidence:\n\n    ", false],
  ["code after a heading", "# Evidence\n    ", false],
  ["code after a setext heading", "Evidence\n===\n    ", false],
  ["code after a thematic break", "Evidence\n---\n    ", false],
  ["code after a fence", "```text\nExample\n```\n    ", false],
  ["ordered-list paragraph", "1. Evidence:\n\n    ", true],
  ["unordered-list paragraph", "- Evidence:\n\n    ", true],
  ["nested-list paragraph", "- Evidence:\n  - More evidence:\n\n    ", true],
  ["list-contained code", "1. Evidence:\n\n       ", false],
  ["quoted paragraph", "> Evidence:\n>\n> ", true],
  ["quoted code", "> Evidence:\n>\n>     ", false],
] as const)("references distinguish %s from citations", (_name, prefix, cited) => {
  const source: AttachmentSnapshot = { id: "a".repeat(64), name: "Evidence", media_type: "text/plain", extraction_version: "v1", characters: 8, size: 8, sections: [{ id: "L1", text: "Evidence" }] };
  const result = citedSources(`${prefix}[Evidence](cove:${source.id}:L1)`, [source]);
  expect(result).toEqual(cited ? [{ source, section: "L1" }] : []);
});

test("code, math, escaped examples, and image labels do not create references", () => {
  const source: AttachmentSnapshot = { id: "a".repeat(64), name: "Evidence", media_type: "text/plain", extraction_version: "v1", characters: 8, size: 8, sections: [{ id: "L1", text: "Evidence" }] };
  const citation = `[Evidence](cove:${source.id}:L1)`;
  for (const content of [`\\${citation}`, `!${citation}`, `<cove:${source.id}:L1>`, `$${citation}$`, `> \`\`\`markdown\n> ${citation}\n> \`\`\``, `- Example:\n\n      ${citation}`]) {
    expect(citedSources(content, [source])).toEqual([]);
  }
});

test("nested citations retain first-reference order and deduplicate saved sources", () => {
  const first: AttachmentSnapshot = { id: "a".repeat(64), name: "First", media_type: "text/plain", extraction_version: "v1", characters: 8, size: 8, sections: [{ id: "L1", text: "Evidence" }, { id: "L2", text: "More" }] };
  const second = { ...first, id: "b".repeat(64), name: "Second" };
  expect(citedSources(`1. Evidence:\n\n    [Second](cove:${second.id}:L2)\n\n> [First](cove:${first.id}:L1)\n\n[Duplicate](cove:${second.id}:L1)`, [first, second])).toEqual([{ source: second, section: "L2" }, { source: first, section: "L1" }]);
});
