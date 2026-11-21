import type { AttachmentSnapshot } from "@cove/api-contract";

export function citedSources(content: string, sources: AttachmentSnapshot[]) {
  let fence: { character: string; length: number } | undefined;
  const text = content.split("\n").filter(line => {
    const match = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (!fence && match) { fence = { character: match[1][0], length: match[1].length }; return false; }
    if (fence) {
      const closing = line.match(/^[ \t]*(`+|~+)[ \t]*$/)?.[1];
      if (closing && closing.length >= fence.length && closing[0] === fence.character) fence = undefined;
      return false;
    }
    if (/^( {4}|\t)/.test(line)) return false;
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
