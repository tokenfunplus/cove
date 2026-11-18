export type MathExpression = {
  source: string;
  expression: string;
  display: boolean;
  complete: boolean;
};

// Protect math before Markdown sees TeX's underscores, asterisks, or line breaks.
// Placeholders exist only during rendering and cannot collide with message text.
export function protectMarkdownMath(content: string) {
  const text = content.replace(/\r\n?/g, "\n");
  let prefix = "\uE000COVE";
  while (text.includes(prefix)) prefix += ":";
  const expressions = new Map<string, MathExpression>();
  const parts: string[] = [];
  const syntax = /^[ \t]*(`{3,}|~{3,})[^\n]*(?:\n|$)|`+|!\[[^\]\n]*\]\([^\s)]*\)|\]\([^\s)]*\)|\\[\s\S]|\$\$|\$/gm;
  let copied = 0;
  let match: RegExpExecArray | null;
  while ((match = syntax.exec(text))) {
    const opener = match[0];
    if (match[1]) {
      const fence = match[1];
      const close = new RegExp(`^[ \\t]*${fence[0]}{${fence.length},}[ \\t]*(?:\\n|$)`, "gm");
      close.lastIndex = syntax.lastIndex;
      const end = close.exec(text);
      syntax.lastIndex = end ? close.lastIndex : text.length;
      continue;
    }
    if (opener.startsWith("`")) {
      const runs = /`+/g;
      runs.lastIndex = syntax.lastIndex;
      let closing = runs.exec(text);
      while (closing && closing[0] !== opener) closing = runs.exec(text);
      syntax.lastIndex = closing ? runs.lastIndex : text.indexOf("\n", syntax.lastIndex);
      if (syntax.lastIndex < 0) syntax.lastIndex = text.length;
      continue;
    }
    if (!["$", "$$", "\\(", "\\["].includes(opener)) continue;
    const display = opener === "$$" || opener === "\\[";
    const start = syntax.lastIndex;
    // Tight dollar delimiters avoid treating "$5 and $10" as math.
    if (opener === "$" && (!text[start] || /\s/.test(text[start]))) continue;
    const closer = opener === "\\(" ? "\\)" : opener === "\\[" ? "\\]" : opener;
    const end = findClosingDelimiter(text, start, closer, display);
    const fallbackEnd = incompleteEnd(text, start, display);
    // Incomplete TeX commands stay readable while streaming; a prose dollar
    // must leave the rest of the line available to Markdown.
    if (end === undefined && opener === "$" && !/\\[a-zA-Z]/.test(text.slice(start, fallbackEnd))) continue;
    const complete = end !== undefined;
    const expressionEnd = end ?? fallbackEnd;
    const sourceEnd = complete ? expressionEnd + closer.length : expressionEnd;
    const token = `${prefix}${expressions.size}\uE001`;
    expressions.set(token, {
      source: text.slice(match.index, sourceEnd),
      expression: text.slice(start, expressionEnd),
      display,
      complete,
    });
    parts.push(text.slice(copied, match.index), display ? `\n\n${token}\n\n` : token);
    copied = sourceEnd;
    syntax.lastIndex = sourceEnd;
  }
  parts.push(text.slice(copied));
  return { text: parts.join(""), expressions, pattern: new RegExp(`${prefix}\\d+\uE001`, "g") };
}

function findClosingDelimiter(
  text: string,
  start: number,
  closer: string,
  display: boolean,
) {
  for (let index = start; index < text.length; index += 1) {
    if (!display && text[index] === "\n") return undefined;
    // An unfinished formula must not consume a following fenced code block.
    if (text[index] === "\n" && /^[ \t]*(`{3,}|~{3,})/.test(text.slice(index + 1))) return undefined;
    if (text.startsWith(closer, index)) {
      if (closer === "$" && (/\s/.test(text[index - 1] ?? "") || /[\d$]/.test(text[index + 1] ?? ""))) return undefined;
      return index;
    }
    if (text[index] === "\\") index += 1;
    else if (text[index] === "%") {
      const newline = text.indexOf("\n", index);
      if (newline < 0 || !display) return undefined;
      index = newline - 1;
    }
  }
  return undefined;
}

function incompleteEnd(text: string, start: number, display: boolean) {
  const boundary = display ? /\n\s*\n|\n(?=[ \t]*(?:#{1,3}\s|[-*]\s|\d+\.\s|`{3,}|~{3,}))/g : /\n/g;
  boundary.lastIndex = start;
  return boundary.exec(text)?.index ?? text.length;
}
