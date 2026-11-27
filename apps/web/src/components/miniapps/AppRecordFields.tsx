import type { MiniAppFields, MiniAppPackage } from "@cove/api-contract";
import { CalendarDays, ChevronDown } from "lucide-react";

export function fieldLabel(value: string) {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Use the package's presentation declarations before choosing a text fallback.
export function recordPrimaryField(pkg: MiniAppPackage, collection?: string) {
  const front = pkg.pages.find(
    (page) =>
      page.practice &&
      pkg.actions[page.practice.query]?.collection === collection,
  )?.practice?.front;
  if (front) return front;
  return Object.values(pkg.actions).find(
    (action) =>
      action.op === "query" &&
      action.collection === collection &&
      !!action.order_by &&
      pkg.collections[collection ?? ""]?.fields[action.order_by] === "text",
  )?.order_by;
}

const isDate = (value: string | number | boolean) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const displayValue = (value: string | number | boolean) =>
  typeof value === "boolean" ? (value ? "Yes" : "No") : String(value) || "—";
const contentStyle =
  "whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]";

/** Keep the content prominent while leaving every saved field inspectable. */
export function AppRecordFields({
  fields,
  primary,
  reveal,
  expanded = false,
  compact = false,
}: {
  fields: MiniAppFields;
  primary?: string;
  reveal?: string;
  expanded?: boolean;
  compact?: boolean;
}) {
  const entries = Object.entries(fields);
  const heading =
    entries.find(
      ([key, value]) =>
        key !== reveal &&
        key === primary &&
        typeof value === "string" &&
        value.trim(),
    ) ??
    entries.find(
      ([key, value]) =>
        key !== reveal &&
        typeof value === "string" &&
        value.trim() &&
        !isDate(value),
    ) ??
    entries.find(([key, value]) => key !== reveal && value !== "");
  const rest = entries.filter(
    ([key]) => key !== heading?.[0] && key !== reveal,
  );
  const text = rest.filter(
    ([, value]) => typeof value === "string" && value.trim() && !isDate(value),
  );
  const dates = rest.filter(([, value]) => isDate(value));
  const flags = rest.filter(([, value]) => value === true);
  const metadata = rest.filter(([key]) => !text.some(([name]) => name === key));
  const details = [...text.slice(compact ? 0 : 1), ...metadata];
  return (
    <div className="min-w-0 space-y-3">
      {heading && (
        <div className="space-y-1">
          {(expanded || typeof heading[1] !== "string") && (
            <p className="text-xs text-muted-foreground">
              {fieldLabel(heading[0])}
            </p>
          )}
          <p className={contentStyle + " text-base font-medium"}>
            {displayValue(heading[1])}
          </p>
        </div>
      )}
      {(compact ? [] : text.slice(0, 1)).map(([key, value]) => (
        <div key={key} className="space-y-1">
          {expanded && (
            <p className="text-xs text-muted-foreground">{fieldLabel(key)}</p>
          )}
          <p className={contentStyle + " text-sm text-muted-foreground"}>
            {displayValue(value)}
          </p>
        </div>
      ))}
      {reveal && Object.hasOwn(fields, reveal) && (
        <dl>
          <div>
            <dt className="sr-only">{fieldLabel(reveal)}</dt>
            <dd>
              <details
                open={expanded || undefined}
                className="group/answer rounded-xl bg-muted/40 px-3 py-2"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
                  Show {fieldLabel(reveal).toLowerCase()}
                  <ChevronDown
                    className="size-3.5 transition-transform group-open/answer:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <p className={contentStyle + " mt-2 text-sm"}>
                  {displayValue(fields[reveal])}
                </p>
              </details>
            </dd>
          </div>
        </dl>
      )}
      {(dates.length > 0 || flags.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {dates.map(([key, value]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <CalendarDays className="size-3" aria-hidden="true" />
              {fieldLabel(key)} {displayValue(value)}
            </span>
          ))}
          {flags.map(([key]) => (
            <span
              key={key}
              className="rounded-md bg-primary/8 px-2 py-0.5 text-xs font-medium text-primary"
            >
              {fieldLabel(key)}
            </span>
          ))}
        </div>
      )}
      {details.length > 0 && (
        <details open={expanded || undefined} className="group/details">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            Record details
            <ChevronDown
              className="size-3 transition-transform group-open/details:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <dl className="mt-2 grid gap-2 border-l-2 border-border pl-3 text-xs">
            {details.map(([key, value]) => (
              <div
                key={key}
                className="grid min-w-0 gap-1 sm:grid-cols-[minmax(5rem,0.25fr)_minmax(0,1fr)]"
              >
                <dt className="text-muted-foreground">{fieldLabel(key)}</dt>
                <dd className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {displayValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
