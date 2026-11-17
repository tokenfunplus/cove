const openingTags = ["<think>", "<reasoning>", "<analysis>"];

/** Project leading model reasoning blocks without changing the saved response. */
export function splitReasoning(
  content: string,
  streaming = false,
): {
  reasoning?: string;
  answer: string;
} {
  const sections: string[] = [];
  let remaining = content;
  while (true) {
    const opening = /^\s*<(think|reasoning|analysis)>/i.exec(remaining);
    if (!opening) {
      const prefix = remaining.trim().toLowerCase();
      const partialOpening =
        streaming &&
        prefix &&
        openingTags.some((tag) => tag.startsWith(prefix));
      return {
        reasoning: sections.length ? sections.join("\n\n") : undefined,
        answer: partialOpening ? "" : remaining,
      };
    }
    const tag = opening[1].toLowerCase();
    const body = remaining.slice(opening[0].length);
    const closing = new RegExp(`</${tag}>`, "i").exec(body);
    if (!closing) {
      const suffixStart = body.lastIndexOf("<");
      const partialClosing =
        streaming &&
        suffixStart !== -1 &&
        `</${tag}>`.startsWith(body.slice(suffixStart).toLowerCase());
      sections.push(partialClosing ? body.slice(0, suffixStart) : body);
      return { reasoning: sections.join("\n\n"), answer: "" };
    }
    sections.push(body.slice(0, closing.index));
    remaining = body.slice(closing.index + closing[0].length);
  }
}
