import { expect, test } from "vitest";
import { citedSources } from "./source-references";
import type { AttachmentSnapshot } from "@cove/api-contract";

test("references retain valid citation order and exclude unknown sources, sections, and code examples", () => {
  const source: AttachmentSnapshot = { id: "a".repeat(64), name: "Evidence", media_type: "text/plain", extraction_version: "v1", characters: 8, size: 8, sections: [{ id: "L1", text: "Evidence" }] };
  const valid = `[Evidence](cove:${source.id}:L1)`;
  expect(citedSources(`${valid} ${valid} [invalid](cove:${source.id}:L2) [invented](cove:${"b".repeat(64)}:L1)`, [source])).toEqual([{ source, section: "L1" }]);
  expect(citedSources(`\`${valid}\`\n\n\`\`\`\n${valid}\n\`\`\``, [source])).toEqual([]);
});
