import { parseCardJSON } from "./interactive";
export interface CardBlock {
  version: string;
  source: string;
  json: string;
  prose: string;
  complete: boolean;
}
function marked(json: string, partial = false): boolean {
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
    return (
      partial &&
      /^\s*\{\s*"(?:cove_ui"\s*:\s*1|version"\s*:\s*"cove-card-v)/.test(json)
    );
  }
}
/** Same top-level framing rules as the Local Service; ordinary JSON remains prose. */
export function cardBlock(content: string): CardBlock | undefined {
  let offset = 0;
  for (;;) {
    const rest = content.slice(offset),
      leading = rest.length - rest.trimStart().length,
      tag = /^<(think|reasoning|analysis)>/.exec(rest.trimStart());
    if (!tag) break;
    const end = content.indexOf(
      `</${tag[1]}>`,
      offset + leading + tag[0].length,
    );
    if (end < 0) return;
    offset = end + tag[1].length + 3;
  }
  const scanningStart = offset;
  let fence = "",
    label = "",
    start = 0,
    jsonStart = 0,
    count = 0;
  let block: CardBlock | undefined;
  for (const raw of content.slice(offset).split("\n")) {
    const line = raw.replace(/[ \t\r]+$/, "");
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
        const tag = open[2].trim().toLowerCase();
        if (
          fence === "```" &&
          (tag === "json" || tag === "cove-ui" || tag.startsWith("cove-card-"))
        ) {
          label = tag;
          start = offset;
          jsonStart = offset + raw.length + 1;
        }
      }
    }
    offset += raw.length + 1;
  }
  if (label) {
    const json = content.slice(jsonStart);
    if (label !== "json" || marked(json, true)) {
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
    const starts = [
      ...content.matchAll(/^[ \t]*\{[ \t]*"cove_ui"[ \t]*:[ \t]*1/gm),
    ];
    if (
      starts.length === 1 &&
      !content.slice(scanningStart, starts[0].index).trim()
    ) {
      const start = starts[0].index!;
      let depth = 0,
        quoted = false,
        escaped = false,
        end = -1;
      for (let i = start; i < content.length; i++) {
        const c = content[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') quoted = false;
        } else if (c === '"') quoted = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) {
          end = i + 1;
          break;
        }
      }
      if (end < 0) {
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
        complete: depth === 0,
      };
    }
  }
  return count === 1 ? block : undefined;
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
