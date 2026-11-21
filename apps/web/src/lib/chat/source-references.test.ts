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
] as const)("references distinguish %s from citations", (_name, prefix, cited) => {
  const source: AttachmentSnapshot = { id: "a".repeat(64), name: "Evidence", media_type: "text/plain", extraction_version: "v1", characters: 8, size: 8, sections: [{ id: "L1", text: "Evidence" }] };
  const result = citedSources(`${prefix}[Evidence](cove:${source.id}:L1)`, [source]);
  expect(result).toEqual(cited ? [{ source, section: "L1" }] : []);
});
