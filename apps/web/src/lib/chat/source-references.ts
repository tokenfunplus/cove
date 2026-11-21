import type { AttachmentSnapshot } from "@cove/api-contract";

export function citedSources(content: string, sources: AttachmentSnapshot[]) {
  let fence: { character: string; length: number } | undefined;
  let paragraphOpen = false;
  const text = content.split("\n").filter(line => {
    const match = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (!fence && match) { fence = { character: match[1][0], length: match[1].length }; paragraphOpen = false; return false; }
    if (fence) {
      const closing = line.match(/^[ \t]*(`+|~+)[ \t]*$/)?.[1];
      if (closing && closing.length >= fence.length && closing[0] === fence.character) fence = undefined;
      return false;
    }
    if (line.trim() === "") { paragraphOpen = false; return true; }
    // Indented code cannot interrupt an open paragraph. Headings and rules end
    // a paragraph even without a following blank line.
    if (!paragraphOpen && /^(?: {4}| {0,3}\t)/.test(line)) return false;
    const setextHeading = paragraphOpen && /^ {0,3}(?:=+|-+)[ \t]*$/.test(line);
    paragraphOpen = !setextHeading && !/^ {0,3}(?:#{1,6}(?:[ \t]|$)|(?:\*[ \t]*){3,}$|(?:-[ \t]*){3,}$|(?:_[ \t]*){3,}$)/.test(line);
    return true;
  }).join("\n").replace(/(`+)[\s\S]*?\1/g, "");
  const found = new Set<string>();
  return [...text.matchAll(/\[[^\]\n]+\]\(cove:([a-f0-9]{64}):([LP][1-9]\d*)\)/g)].flatMap(match => {
    const source = sources.find(item => item.id === match[1] && item.sections.some(section => section.id === match[2]));
    if (!source || found.has(source.id)) return [];
    found.add(source.id);
    return [{ source, section: match[2] }];
  });
}
