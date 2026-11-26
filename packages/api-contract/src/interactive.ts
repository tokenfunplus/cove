import catalogV1 from "../catalogs/interactive-v1.json";
import catalogV2 from "../catalogs/interactive-v2.json";
import catalogV3 from "../catalogs/interactive-v3.json";

export interface CardAction {
  action: "continue_chat" | "check_answer" | "reset";
  params: Record<string, unknown>;
}
export interface CardElement {
  type: keyof typeof catalogV2.components;
  props: Record<string, unknown>;
  children: string[];
  on?: { press: CardAction };
}
export interface CardDefinition {
  version: "cove-card-v1" | "cove-card-v2" | "cove-card-v3";
  catalogVersion:
    | "cove-interactive-v1"
    | "cove-interactive-v2"
    | "cove-interactive-v3";
  fallback: string;
  stateSchema: Record<
    string,
    {
      type: "string" | "array" | "integer";
      enum?: string[];
      items?: { type: "string"; enum: string[] };
      uniqueItems?: boolean;
      maxItems?: number;
      minimum?: number;
      maximum?: number;
      step?: number;
      maxLength?: number;
    }
  >;
  spec: {
    root: string;
    state: CardValues;
    elements: Record<string, CardElement>;
  };
}
export type CardValues = Record<string, string | string[] | number>;
export interface CardSubmission {
  intent?: "discuss";
  generation_id: string;
  revision: number;
  values: CardValues;
  checks: Record<string, string>;
}
export interface CardRun {
  generation_id: string;
  definition: CardDefinition;
  values: CardValues;
  checks: Record<string, string>;
  revision: number;
  submitted_batch_id?: string;
  can_continue: boolean;
}
export interface CardOption {
  value: string;
  label: string;
  description?: string;
}
export interface CardCase {
  value: string;
  outcome: "correct" | "incorrect";
  text: string;
}
const fail = (): never => {
  throw new Error("Interactive card is invalid or unsupported.");
};
const bytes = (s: string) => new TextEncoder().encode(s).length;
const id = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v) &&
  !["constructor", "prototype"].includes(v);
const text = (v: unknown): v is string =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  [...v].length > 0 &&
  [...v].length <= 2000 &&
  ![...v].some(
    (c) => c === "\ufffd" || (c.length === 1 && /[\ud800-\udfff]/.test(c)),
  );
export const cardField = (v: unknown): string =>
  typeof v === "string" &&
  /^\/[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v) &&
  !["constructor", "prototype"].includes(v.slice(1))
    ? v.slice(1)
    : "";
const object = (v: unknown, keys?: string[]): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  const m = v as Record<string, unknown>;
  if (keys && Object.keys(m).some((k) => !keys.includes(k))) fail();
  return m;
};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : fail());
const unique = (a: unknown[]) => new Set(a).size === a.length;

// A small JSON reader preserves duplicate-key/depth checks before JSON.parse
// could discard information. No expression or application code is evaluated.
export function parseCardJSON(source: string): unknown {
  if (bytes(source) > 32768) fail();
  let pos = 0;
  const ws = () => {
    while (pos < source.length && " \t\r\n".includes(source[pos])) pos++;
  };
  const read = (depth: number): unknown => {
    ws();
    if (depth > 16) return fail();
    const c = source[pos++];
    if (c === "{") {
      const m: Record<string, unknown> = Object.create(null);
      ws();
      if (source[pos] === "}") {
        pos++;
        return m;
      }
      do {
        ws();
        if (source[pos] !== '"') fail();
        const k = read(depth + 1) as string;
        ws();
        if (source[pos++] !== ":" || Object.hasOwn(m, k)) fail();
        m[k] = read(depth + 1);
        ws();
        const next = source[pos++];
        if (next === "}") return m;
        if (next !== ",") fail();
      } while (pos < source.length);
      return fail();
    }
    if (c === "[") {
      const a: unknown[] = [];
      ws();
      if (source[pos] === "]") {
        pos++;
        return a;
      }
      do {
        a.push(read(depth + 1));
        ws();
        const next = source[pos++];
        if (next === "]") return a;
        if (next !== ",") fail();
      } while (pos < source.length);
      return fail();
    }
    if (c === '"') {
      const start = pos - 1;
      let escaped = false;
      while (pos < source.length) {
        const ch = source[pos++];
        if (ch === '"' && !escaped) {
          const s = JSON.parse(source.slice(start, pos)) as string;
          if (
            [...s].some(
              (c) =>
                c === "\ufffd" || (c.length === 1 && /[\ud800-\udfff]/.test(c)),
            )
          )
            fail();
          return s;
        }
        if (ch === "\\" && !escaped) escaped = true;
        else escaped = false;
      }
      return fail();
    }
    pos--;
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*))/.exec(
      source.slice(pos),
    );
    if (!match) return fail();
    pos += match[0].length;
    const value = JSON.parse(match[0]);
    if (typeof value === "number" && !Number.isSafeInteger(value)) fail();
    return value;
  };
  const result = read(0);
  ws();
  if (pos !== source.length) fail();
  return result;
}
function rule(value: unknown, kind: string): boolean {
  switch (kind.replace(/!$/, "")) {
    case "text":
      return text(value);
    case "id":
      return id(value);
    case "integer":
      return (
        Number.isSafeInteger(value) && Math.abs(Number(value)) <= 1_000_000
      );
    case "boolean":
      return typeof value === "boolean";
    case "mode":
      return value === "single" || value === "multiple";
    case "binding": {
      const m = object(value, ["$bindState"]);
      return Object.keys(m).length === 1 && Boolean(cardField(m.$bindState));
    }
    case "paths": {
      const a = array(value);
      return (
        a.length > 0 &&
        a.length <= 16 &&
        unique(a) &&
        a.every((v) => Boolean(cardField(v)))
      );
    }
    case "options":
    case "cases": {
      const a = array(value);
      if (!a.length || a.length > 12) return false;
      const cases = kind.startsWith("cases");
      const seen = new Set();
      return a.every((v) => {
        const m = object(
          v,
          cases
            ? ["value", "outcome", "text"]
            : ["value", "label", "description"],
        );
        if (!id(m.value) || seen.has(m.value)) return false;
        seen.add(m.value);
        return cases
          ? text(m.text) &&
              (m.outcome === "correct" || m.outcome === "incorrect")
          : text(m.label) &&
              (m.description === undefined || text(m.description));
      });
    }
  }
  return false;
}
function rules(value: unknown, definitions: Record<string, string>) {
  const m = object(value, Object.keys(definitions));
  for (const [key, r] of Object.entries(definitions)) {
    if (!(key in m)) {
      if (r.endsWith("!")) fail();
    } else if (!rule(m[key], r)) fail();
  }
}
export function validateCardValues(
  d: CardDefinition,
  values: CardValues,
  checks: Record<string, string> = {},
  required = false,
): void {
  if (
    bytes(
      JSON.stringify([values, checks]).replace(
        /[<>&\u2028\u2029]/g,
        (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
      ),
    ) > 16384 ||
    Object.keys(values).length !== Object.keys(d.stateSchema).length
  )
    fail();
  for (const [key, f] of Object.entries(d.stateSchema)) {
    const v = values[key];
    if (f.type === "string") {
      if (typeof v !== "string") fail();
      if (
        f.enum
          ? !f.enum.includes(v as string)
          : !validFreeText(v as string, f.maxLength!)
      )
        fail();
    } else if (f.type === "integer") {
      if (
        typeof v !== "number" ||
        !Number.isSafeInteger(v) ||
        v < f.minimum! ||
        v > f.maximum! ||
        (v - f.minimum!) % f.step! !== 0
      )
        fail();
    } else {
      if (
        !Array.isArray(v) ||
        !unique(v) ||
        v.length > f.maxItems! ||
        v.some((x) => !f.items?.enum.includes(x))
      )
        fail();
    }
  }
  for (const n of Object.values(d.spec.elements)) {
    if (n.type === "Ranking") {
      const value = values[cardField(object(n.props.value).$bindState)];
      if (
        !Array.isArray(value) ||
        value.length !== (n.props.options as CardOption[]).length
      )
        fail();
    }
  }
  for (const [key, v] of Object.entries(checks)) {
    const feedback = d.spec.elements[key];
    if (!feedback || feedback.type !== "Feedback") fail();
    const choice = d.spec.elements[feedback.props.choiceElement as string];
    const field = cardField(object(choice.props.value).$bindState);
    if (!v || values[field] !== v) fail();
  }
  if (required)
    for (const n of Object.values(d.spec.elements))
      if ((n.type === "Choice" || n.type === "TextInput") && n.props.required) {
        const v = values[cardField(object(n.props.value).$bindState)];
        if (typeof v === "string" ? !v.trim() : !Array.isArray(v) || !v.length)
          fail();
      }
}
export function parseCard(source: string): CardDefinition {
  const raw = object(parseCardJSON(source), [
    "version",
    "catalogVersion",
    "fallback",
    "stateSchema",
    "spec",
  ]);
  const catalog =
    raw.version === catalogV1.version
      ? catalogV1
      : raw.version === catalogV3.version
        ? catalogV3
        : catalogV2;
  if (
    Object.keys(raw).length !== 5 ||
    raw.version !== catalog.version ||
    raw.catalogVersion !== catalog.catalogVersion ||
    !text(raw.fallback)
  )
    fail();
  const spec = object(raw.spec, ["root", "state", "elements"]);
  if (Object.keys(spec).length !== 3 || !id(spec.root)) fail();
  const elements = object(spec.elements);
  if (!Object.keys(elements).length || Object.keys(elements).length > 30)
    fail();
  const fields = object(raw.stateSchema);
  if (
    (raw.version !== "cove-card-v3" && !Object.keys(fields).length) ||
    Object.keys(fields).length > 16
  )
    fail();
  for (const [key, v] of Object.entries(fields)) {
    if (!cardField("/" + key)) fail();
    const f = object(v, [
      "type",
      "enum",
      "items",
      "maxItems",
      "uniqueItems",
      "minimum",
      "maximum",
      "step",
      "maxLength",
    ]);
    if (f.type === "string") {
      if (raw.version !== "cove-card-v1" && f.enum === undefined) {
        object(v, ["type", "maxLength"]);
        if (
          !Number.isSafeInteger(f.maxLength) ||
          Number(f.maxLength) < 1 ||
          Number(f.maxLength) > 2000
        )
          fail();
      } else {
        object(v, ["type", "enum"]);
        const a = array(f.enum);
        if (
          !a.length ||
          a.length > 13 ||
          !a.every((x) => typeof x === "string") ||
          !unique(a)
        )
          fail();
      }
    } else if (f.type === "array") {
      object(v, ["type", "items", "maxItems", "uniqueItems"]);
      const item = object(f.items, ["type", "enum"]);
      const a = array(item.enum);
      if (
        item.type !== "string" ||
        !unique(a) ||
        !a.every(id) ||
        f.uniqueItems !== true ||
        !Number.isSafeInteger(f.maxItems) ||
        Number(f.maxItems) < 1 ||
        Number(f.maxItems) > 12
      )
        fail();
    } else if (f.type === "integer" && raw.version !== "cove-card-v1") {
      object(v, ["type", "minimum", "maximum", "step"]);
      const { minimum: min, maximum: max, step } = f;
      if (
        ![min, max, step].every(
          (x) => Number.isSafeInteger(x) && Math.abs(Number(x)) <= 1_000_000,
        ) ||
        Number(min) >= Number(max) ||
        Number(step) <= 0 ||
        (Number(max) - Number(min)) % Number(step) !== 0
      )
        fail();
    } else fail();
  }
  for (const [key, value] of Object.entries(elements)) {
    if (!id(key)) fail();
    const n = object(value, ["type", "props", "children", "on"]);
    if (
      typeof n.type !== "string" ||
      !Object.hasOwn(catalog.components, n.type)
    )
      fail();
    rules(
      n.props,
      (catalog.components as Record<string, Record<string, string>>)[
        n.type as string
      ],
    );
    const children = array(n.children);
    if (
      !children.every(id) ||
      (n.type !== "Card" && n.type !== "Reveal" && children.length)
    )
      fail();
    if (n.type === "Button" && n.on === undefined) fail();
    if (n.on !== undefined) {
      const on = object(n.on, ["press"]);
      if (n.type !== "Button" || Object.keys(on).length !== 1) fail();
      const a = object(on.press, ["action", "params"]);
      if (
        Object.keys(a).length !== 2 ||
        typeof a.action !== "string" ||
        !Object.hasOwn(catalog.actions, a.action)
      )
        fail();
      rules(
        a.params,
        catalog.actions[a.action as keyof typeof catalog.actions],
      );
    }
  }
  const d = raw as unknown as CardDefinition;
  const visited = new Set<string>();
  const writers = new Map<string, CardElement>();
  const submitted = new Set<string>();
  let continuations = 0;
  const visit = (key: string, depth: number) => {
    const n = d.spec.elements[key];
    if (!n || visited.has(key) || depth > 4) fail();
    visited.add(key);
    if (n.type === "Card" && key !== d.spec.root) fail();
    if (["Choice", "Ranking", "Slider", "TextInput"].includes(n.type)) {
      const field = cardField(object(n.props.value).$bindState);
      if (writers.has(field)) fail();
      writers.set(field, n);
      const f = d.stateSchema[field];
      if (!f) fail();
      if (n.type === "Slider") {
        if (f.type !== "integer") fail();
      } else if (n.type === "TextInput") {
        if (
          f.type !== "string" ||
          f.enum !== undefined ||
          f.maxLength === undefined
        )
          fail();
      } else {
        const options = (n.props.options as CardOption[]).map((o) => o.value);
        const single = n.type === "Choice" && n.props.mode === "single";
        const expected = single ? f.enum : f.items?.enum;
        if (
          single
            ? f.type !== "string"
            : f.type !== "array" ||
              f.maxItems! > options.length ||
              (n.type === "Ranking" &&
                (options.length < 2 || f.maxItems !== options.length))
        )
          fail();
        const values = single ? [...options, ""] : options;
        if (
          JSON.stringify([...values].sort()) !==
          JSON.stringify([...(expected ?? [])].sort())
        )
          fail();
      }
    }
    if (n.type === "TextPreview") {
      const field = cardField(object(n.props.value).$bindState);
      const writer = Object.values(d.spec.elements).find(
        (e) =>
          e.type === "TextInput" &&
          cardField(object(e.props.value).$bindState) === field,
      );
      if (!writer) fail();
    }
    if (n.type === "AllocationSummary") {
      if (Number(n.props.total) < 0) fail();
      for (const binding of n.props.paths as string[]) {
        if (
          !Object.values(d.spec.elements).some(
            (e) =>
              e.type === "Slider" &&
              object(e.props.value).$bindState === binding &&
              (e.props.unit ?? "") === (n.props.unit ?? ""),
          )
        )
          fail();
      }
    }
    if (n.type === "Feedback") {
      const choice = d.spec.elements[n.props.choiceElement as string];
      if (choice?.type !== "Choice" || choice.props.mode !== "single") fail();
      const cases = n.props.cases as CardCase[];
      const options = choice.props.options as CardOption[];
      if (
        cases.length !== options.length ||
        cases.some((c) => !options.some((o) => o.value === c.value)) ||
        cases.filter((c) => c.outcome === "correct").length !== 1
      )
        fail();
    }
    const a = n.on?.press;
    if (a?.action === "continue_chat") {
      continuations++;
      for (const p of a.params.paths as string[]) submitted.add(cardField(p));
    }
    if (
      a?.action === "check_answer" &&
      d.spec.elements[a.params.feedbackElement as string]?.type !== "Feedback"
    )
      fail();
    for (const child of n.children) {
      if (n.type === "Reveal" && d.spec.elements[child]?.type !== "Text")
        fail();
      visit(child, depth + 1);
    }
  };
  if (d.spec.elements[d.spec.root]?.type !== "Card") fail();
  visit(d.spec.root, 1);
  if (
    visited.size !== Object.keys(elements).length ||
    (d.version === "cove-card-v3" ? continuations > 1 : continuations !== 1) ||
    writers.size !== Object.keys(fields).length ||
    Object.keys(object(spec.state)).length !== Object.keys(fields).length
  )
    fail();
  for (const [field, n] of writers)
    if (
      (n.props.required ||
        ["Ranking", "Slider", "TextInput"].includes(n.type)) &&
      !submitted.has(field) &&
      continuations > 0
    )
      fail();
  if ([...submitted].some((k) => !writers.has(k))) fail();
  validateCardValues(d, d.spec.state);
  return d;
}

function validFreeText(value: string, maxLength: number): boolean {
  return (
    [...value].length <= maxLength &&
    ![...value].some(
      (c) => c === "\ufffd" || (c.length === 1 && /[\ud800-\udfff]/.test(c)),
    )
  );
}

/** Registered integer-only calculation; no model-authored formulas execute. */
export function cardAllocations(d: CardDefinition, values: CardValues) {
  return Object.fromEntries(
    Object.entries(d.spec.elements).flatMap(([key, element]) => {
      if (element.type !== "AllocationSummary") return [];
      const inputs = Object.fromEntries(
        (element.props.paths as string[]).map((p) => [
          cardField(p),
          values[cardField(p)] as number,
        ]),
      );
      const sum = Object.values(inputs).reduce((a, b) => a + b, 0);
      const total = element.props.total as number;
      return [
        [
          key,
          {
            calculation: "allocation-sum-v1",
            inputs,
            total,
            sum,
            remaining: total - sum,
            unit: (element.props.unit as string) ?? "",
          },
        ],
      ];
    }),
  );
}

/** Immediate user-turn presentation; admission still derives its own authoritative summary. */
export function cardInputSummary(
  d: CardDefinition,
  values: CardValues,
  question = "",
): string {
  if (question.trim()) return question.trim();
  const paths = new Set(
    Object.values(d.spec.elements).flatMap((n) =>
      n.on?.press.action === "continue_chat"
        ? (n.on.press.params.paths as string[])
        : [],
    ),
  );
  const labels: string[] = [];
  for (const field of Object.keys(values).sort()) {
    if (!paths.has("/" + field)) continue;
    const n = Object.values(d.spec.elements).find(
      (n) =>
        ["Choice", "Ranking", "Slider", "TextInput"].includes(n.type) &&
        cardField((n.props.value as { $bindState: string })?.$bindState) ===
          field,
    );
    if (!n) continue;
    const label = (n.props.label as string) || field,
      value = values[field];
    if (n.type === "Slider") {
      labels.push(
        `${label}: ${value} ${(n.props.unit as string) ?? ""}`.trim(),
      );
      continue;
    }
    if (n.type === "TextInput") {
      labels.push(`${label}: ${value}`);
      continue;
    }
    const options = n.props.options as CardOption[];
    const chosen = Array.isArray(value) ? value : [value];
    const selected =
      d.version === "cove-card-v1"
        ? options.filter((o) => chosen.includes(o.value)).map((o) => o.label)
        : chosen.flatMap((v) => {
            const o = options.find((o) => o.value === v);
            return o ? [o.label] : [];
          });
    if (d.version === "cove-card-v1") labels.push(...selected);
    else
      labels.push(
        label + ": " + selected.join(n.type === "Ranking" ? " > " : ", "),
      );
  }
  return (
    (d.version === "cove-card-v1" ? "I chose: " : "My input: ") +
    labels.join("; ") +
    "."
  );
}
