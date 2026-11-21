import type { AttachmentSnapshot } from "@cove/api-contract";
import { fromMarkdown } from "mdast-util-from-markdown";
import { protectMarkdownMath } from "./markdown-math";

type MarkdownNode = ReturnType<typeof fromMarkdown> | ReturnType<typeof fromMarkdown>["children"][number];

export function citedSources(content: string, sources: AttachmentSnapshot[]) {
  const references: { source: AttachmentSnapshot; section: string }[] = [];
  if (!sources.length) return references;
  const markdown = protectMarkdownMath(content).text;
  const pending: MarkdownNode[] = [fromMarkdown(markdown)];
  const found = new Set<string>();
  while (pending.length) {
    const node = pending.pop()!;
    // Only explicit Markdown links are citations; code, images, and autolinks
    // must not turn examples or labels into reference entries.
    if (node.type === "link" && markdown[node.position?.start.offset ?? -1] === "[") {
      const match = /^cove:([a-f0-9]{64}):([LP][1-9]\d*)$/.exec(node.url);
      if (match) {
        const source = sources.find(item => item.id === match[1] && item.sections.some(section => section.id === match[2]));
        if (source && !found.has(source.id)) {
          found.add(source.id);
          references.push({ source, section: match[2] });
        }
      }
    }
    if ("children" in node) {
      for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
    }
  }
  return references;
}
