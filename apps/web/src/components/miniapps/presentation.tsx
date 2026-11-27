import { useState, type ReactNode } from "react";
import type {
  MiniAppFields,
  MiniAppInstance,
  MiniAppPackage,
} from "@cove/api-contract";
import { appBookmark } from "@/lib/mini-app-snapshot";
import { copyText } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";

export { appBookmark, snapshot } from "@/lib/mini-app-snapshot";

export function canUpgrade(
  before: MiniAppPackage,
  after: Pick<
    MiniAppPackage,
    "publisher" | "app" | "version" | "schema_version"
  >,
  oldOrigin: string,
  newOrigin: string,
  legacyVerified = false,
  beforeAuthority: {
    catalog_authority?: string;
    official_catalog?: boolean;
  } = {},
  afterAuthority: {
    catalog_authority?: string;
    official_catalog?: boolean;
  } = {},
) {
  const sameOrigin =
    (oldOrigin === "local" && newOrigin === "local") ||
    ((oldOrigin === "builtin" || legacyVerified) &&
      (newOrigin === "builtin" ||
        (newOrigin === "catalog" &&
          afterAuthority.official_catalog === true))) ||
    (oldOrigin === "catalog" &&
      newOrigin === "catalog" &&
      !!beforeAuthority.catalog_authority &&
      beforeAuthority.catalog_authority === afterAuthority.catalog_authority) ||
    (oldOrigin === "catalog" &&
      newOrigin === "builtin" &&
      beforeAuthority.official_catalog === true);
  return (
    sameOrigin &&
    before.publisher === after.publisher &&
    before.app === after.app &&
    after.schema_version >= before.schema_version &&
    after.version.localeCompare(before.version, "en", { numeric: true }) > 0
  );
}
export function catalogSourceLabel(source: {
  origin: string;
  official_catalog?: boolean;
}) {
  if (source.origin === "builtin") return "Included with Cove";
  if (source.origin === "catalog")
    return source.official_catalog ? "Cove catalog" : "Custom signed catalog";
  return "From a local file";
}
export const sectionStyle =
  "space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5";
export const selectStyle =
  "min-h-9 w-full rounded-xl border border-input bg-background px-3 text-sm";
export const labelStyle = "grid gap-1.5 text-sm font-medium";
export function humanize(key: string) {
  const words = key.replace(/[_-]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="break-words text-sm text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </p>
  ) : null;
}
export function Fields({
  fields,
  reveal,
}: {
  fields: MiniAppFields;
  reveal?: string;
}) {
  return (
    <dl className="grid min-w-0 gap-1 text-sm">
      {Object.entries(fields)
        .sort(([a], [b]) => Number(a === reveal) - Number(b === reveal))
        .map(([key, value]) =>
          key === reveal ? (
            <div key={key}>
              <dt className="sr-only">{humanize(key)}</dt>
              <dd>
                <details>
                  <summary className="cursor-pointer font-medium text-primary">
                    Show {humanize(key).toLowerCase()}
                  </summary>
                  <div className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {String(value)}
                  </div>
                </details>
              </dd>
            </div>
          ) : (
            <div
              key={key}
              className="grid gap-0.5 sm:grid-cols-[minmax(6rem,0.35fr)_minmax(0,1fr)]"
            >
              <dt className="text-muted-foreground">{humanize(key)}</dt>
              <dd className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {String(value)}
              </dd>
            </div>
          ),
        )}
    </dl>
  );
}
export function OpenApp({
  instance,
  view,
  children,
}: {
  instance: MiniAppInstance;
  view: string;
  children?: ReactNode;
}) {
  return (
    <Button asChild variant="link" size="sm">
      <a href={appBookmark(instance.id, view)}>
        {children ?? "Open in browser"}
      </a>
    </Button>
  );
}
export function CopyAppLink({
  instance,
  view,
}: {
  instance: MiniAppInstance;
  view: string;
}) {
  const [copied, setCopied] = useState(false);
  const [denied, setDenied] = useState(false);
  const link = appBookmark(instance.id, view);
  return (
    <span className="inline-grid gap-1 text-sm">
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          const ok = await copyText(link);
          setCopied(ok);
          setDenied(!ok);
        }}
      >
        {copied ? "Link copied" : "Copy local app link"}
      </Button>
      {denied && (
        <input
          aria-label="Local app link"
          readOnly
          value={link}
          onFocus={(event) => event.target.select()}
        />
      )}
    </span>
  );
}
const capNames: Record<string, string> = {
  "blobs.import": "Store files in this instance",
  "records.query": "Read this instance’s records",
  "records.commit": "Save changes to this instance",
  "documents.search": "Search documents you select",
  "speech.speak": "Read selected text aloud locally",
  "ai.generate": "Request model generation",
  "mac.files.pick": "Import a file you select",
  "mac.selection.receive": "Use text you send from macOS",
  "chat.attach": "Add selected records to a chat draft",
};
export function Grants({
  capabilities,
  selected,
  onChange,
}: {
  capabilities: string[];
  selected: string[];
  onChange: (caps: string[]) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-semibold">
        Allowed capabilities
      </legend>
      {capabilities.map((cap) => (
        <label key={cap} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(cap)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, cap]
                  : selected.filter((c) => c !== cap),
              )
            }
          />
          {capNames[cap] ?? cap}
        </label>
      ))}
    </fieldset>
  );
}
