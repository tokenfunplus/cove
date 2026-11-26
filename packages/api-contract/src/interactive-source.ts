import { parseCardJSON } from "./interactive";
export interface CardBlock {
  version: string;
  source: string;
  json: string;
  prose: string;
  complete: boolean;
}
function marked(json: string): boolean {
  try {
    const m = parseCardJSON(json);
    return Boolean(
      m &&
        typeof m === "object" &&
        (("cove_ui" in m && m.cove_ui === 1) ||
          ("version" in m &&
            typeof m.version === "string" &&
            m.version.startsWith("cove-card-v"))),
    );
  } catch {
    return /^[ \t\r\n]*\{[ \t\r\n]*"(?:cove_ui"[ \t\r\n]*:[ \t\r\n]*1(?:[,} \t\r\n]|$)|version"[ \t\r\n]*:[ \t\r\n]*"cove-card-v)/.test(
      json,
    );
  }
}

function modelFenceLabel(raw: string): string {
  const tag = raw.trim().toLowerCase();
  if (/^cove-ui(?:[ \t]|$)/.test(tag)) return "cove-ui";
  return ["json", "cove-card-v1", "cove-card-v2", "cove-card-v3"].includes(tag)
    ? tag
    : "";
}

// Locate the same bounded root as the service's model-input adapter. This only
// frames source for presentation; the service must normalize and validate it.
function modelObjectEnd(content: string, start: number): number | undefined {
  const stack: string[] = [];
  let quoted = false,
    escaped = false,
    edits = 0;
  for (let i = start; i < content.length && i - start < 32768; i++) {
    const c = content[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "{" || c === "[") {
      stack.push(c);
      if (stack.length > 32) return;
    } else if (c === "}" || c === "]") {
      if (c === "]") {
        while (stack.at(-1) === "{") {
          stack.pop();
          edits++;
        }
      }
      if (edits > 8 || stack.at(-1) !== (c === "}" ? "{" : "[")) return;
      stack.pop();
      if (!stack.length) {
        let end = i + 1;
        for (let j = end; j < content.length && j - start < 32768; j++) {
          if (/[ \t\r\n]/.test(content[j])) continue;
          if (content[j] !== "}" && content[j] !== "]") break;
          if (++edits > 8) return;
          end = j + 1;
        }
        return new TextEncoder().encode(content.slice(start, end)).length <=
          32768
          ? end
          : undefined;
      }
    }
  }
}
/** Same top-level framing rules as the Local Service; ordinary JSON remains prose. */
export function cardBlock(content: string): CardBlock | undefined {
  let offset = 0;
  for (;;) {
    const rest = content.slice(offset),
      leading = /^[ \t\r\n]*/.exec(rest)![0].length,
      tag = /^<(think|reasoning|analysis)>/.exec(rest.slice(leading));
    if (!tag) break;
    const end = content.indexOf(
      `</${tag[1]}>`,
      offset + leading + tag[0].length,
    );
    if (end < 0) return;
    offset = end + tag[1].length + 3;
  }
  const bareStarts: number[] = [];
  let fence = "",
    label = "",
    start = 0,
    jsonStart = 0,
    count = 0;
  let block: CardBlock | undefined;
  for (const raw of content.slice(offset).split("\n")) {
    let end = raw.length;
    while (
      end > 0 &&
      (raw[end - 1] === " " || raw[end - 1] === "\t" || raw[end - 1] === "\r")
    )
      end--;
    const line = raw.slice(0, end);
    if (fence) {
      if (
        line.length >= fence.length &&
        [...line].every((c) => c === fence[0])
      ) {
        if (label) {
          const json = content.slice(jsonStart, offset);
          if (label !== "json" || marked(json)) {
            count++;
            const end = offset + raw.length;
            block = {
              version: label,
              source: content.slice(start, end),
              json,
              prose: content.slice(0, start) + content.slice(end),
              complete: true,
            };
          }
        }
        fence = "";
        label = "";
      }
    } else {
      const open = /^(`{3,}|~{3,})(.*)$/.exec(line);
      if (open) {
        fence = open[1];
        const tag = modelFenceLabel(open[2]);
        if (fence === "```" && tag) {
          label = tag;
          start = offset;
          jsonStart = offset + raw.length + 1;
        }
      } else if (
        /^[ \t]*\{[ \t\r\n]*"cove_ui"[ \t\r\n]*:[ \t\r\n]*1(?:[,} \t\r\n]|$)/.test(
          content.slice(offset),
        )
      ) {
        bareStarts.push(offset);
      }
    }
    offset += raw.length + 1;
  }
  if (label) {
    const json = content.slice(jsonStart);
    if (label !== "json" || marked(json)) {
      count++;
      block = {
        version: label,
        source: content.slice(start),
        json,
        prose: content.slice(0, start),
        complete: false,
      };
    }
  }
  if (count === 0 && !fence) {
    if (bareStarts.length === 1) {
      const start = bareStarts[0];
      const rootEnd = modelObjectEnd(content, start);
      let end = rootEnd;
      if (end === undefined) {
        const boundary = /\n[ \t]*\n(?=[A-Za-z\u3400-\u9fff])/.exec(
          content.slice(start),
        );
        end = boundary ? start + boundary.index : content.length;
      }
      const json = content.slice(start, end);
      return {
        version: "cove-ui",
        source: json,
        json,
        prose: content.slice(0, start) + content.slice(end),
        complete: rootEnd !== undefined,
      };
    }
  }
  return count === 1 && bareStarts.length === 0 ? block : undefined;
}
export function cardFallback(json: string): string | undefined {
  try {
    const m = parseCardJSON(json);
    if (
      m &&
      typeof m === "object" &&
      "fallback" in m &&
      typeof m.fallback === "string" &&
      m.fallback.trim() &&
      [...m.fallback].length <= 2000
    )
      return m.fallback;
    if (
      m &&
      typeof m === "object" &&
      "title" in m &&
      typeof m.title === "string" &&
      [...m.title].length <= 2000
    )
      return m.title;
  } catch {
    if (json.length <= 32768) {
      if ([...json.matchAll(/"(?:fallback|title)"\s*:/g)].length > 1) return;
      const match = /"(?:fallback|title)"\s*:\s*("(?:\\.|[^"\\])*")/.exec(json);
      if (match)
        try {
          const title = JSON.parse(match[1]);
          if (typeof title === "string" && [...title].length <= 2000)
            return title;
        } catch {}
    }
  }
}
