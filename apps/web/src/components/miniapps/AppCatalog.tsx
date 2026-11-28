import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MiniAppPackage } from "@cove/api-contract";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Layers3,
  LockKeyhole,
  Monitor,
} from "lucide-react";
import { miniApps, type CatalogEntry } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { catalogSourceLabel, ErrorMessage, selectStyle } from "./presentation";
import { recordPrimaryField } from "./AppRecordFields";

export function groupCatalog(entries: CatalogEntry[]) {
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const key = entry.publisher + "/" + entry.app;
    const versions = groups.get(key) ?? [];
    if (!versions.some((item) => item.version === entry.version))
      versions.push(entry);
    groups.set(key, versions);
  }
  return [...groups.values()]
    .map((versions) =>
      versions.sort((a, b) =>
        b.version.localeCompare(a.version, "en", { numeric: true }),
      ),
    )
    .sort((a, b) => a[0].name.localeCompare(b[0].name));
}

export function catalogPreviewOptions(entry: CatalogEntry) {
  return {
    queryKey: [
      "mini-app-catalog-preview",
      entry.publisher,
      entry.app,
      entry.version,
      entry.digest,
    ],
    queryFn: () => miniApps.catalogPreview(entry),
    retry: false,
    staleTime: 5 * 60_000,
  };
}

export function AppMark({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  return (
    <span
      className={"mini-app-mark " + (small ? "mini-app-mark--small" : "")}
      aria-hidden="true"
    >
      {name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase() || <Layers3 />}
    </span>
  );
}

export function PublicAppPreview({
  pkg,
  name,
}: {
  pkg?: MiniAppPackage;
  name: string;
}) {
  const page = pkg?.pages[0];
  const query = page?.actions
    .map((id) => pkg?.actions[id])
    .find((action) => action?.op === "query");
  const collection = query?.collection;
  const fields = collection ? pkg?.collections[collection]?.fields : undefined;
  const textFields = Object.entries(fields ?? {})
    .filter(([, type]) => type === "text")
    .map(([key]) => key);
  const front =
    page?.practice?.front ??
    (pkg ? recordPrimaryField(pkg, collection) : undefined) ??
    textFields.find((key) => key !== query?.reveal_field);
  const rows = collection ? (pkg?.seed?.[collection]?.slice(0, 3) ?? []) : [];
  const asset = page?.image ? pkg?.assets?.[page.image] : undefined;
  const practice = Boolean(page?.practice || query?.reveal_field);
  return (
    <div
      className={
        "mini-app-preview " +
        (practice ? "mini-app-preview--practice" : "mini-app-preview--list")
      }
    >
      {asset ? (
        <img
          src={"data:" + asset.mime + ";base64," + asset.data}
          alt={asset.alt}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className="mini-app-preview-window"
          aria-label={name + " example preview"}
        >
          <div className="mini-app-preview-toolbar">
            <span className="mini-app-window-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>{name}</span>
            <LockKeyhole size={10} aria-hidden="true" />
          </div>
          <div className="mini-app-preview-body">
            <div className="mb-4 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold tracking-wide">
                {page?.title ?? "Your workspace"}
              </span>
              <span className="mini-app-example-tag">Example</span>
            </div>
            {practice && rows[0] && front ? (
              <div className="mini-app-sample-card">
                <span className="text-[9px] uppercase tracking-[0.17em] opacity-50">
                  A moment to practise
                </span>
                <p className="mini-app-sample-question">
                  {String(rows[0][front])}
                </p>
                <span className="mini-app-sample-answer">
                  Reveal answer <ArrowRight size={10} />
                </span>
              </div>
            ) : rows.length ? (
              <div className="grid gap-2">
                {rows.map((row, index) => (
                  <div key={index} className="mini-app-sample-row">
                    <span
                      className="mini-app-sample-bullet"
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <strong className="block truncate text-[11px] font-medium">
                        {front ? String(row[front]) : "Saved item"}
                      </strong>
                      {textFields.find((key) => key !== front) && (
                        <span className="mt-1 block truncate text-[9px] opacity-55">
                          {String(
                            row[textFields.find((key) => key !== front)!],
                          )}
                        </span>
                      )}
                    </span>
                    <Check
                      size={11}
                      className="ml-auto opacity-30"
                      aria-hidden="true"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="mini-app-preview-empty">
                <AppMark name={name} />
                <span>{pkg ? "A fresh space for your ideas." : ""}</span>
              </div>
            )}
            <div className="mini-app-preview-tabs">
              {(pkg?.pages ?? []).slice(0, 3).map((item) => (
                <span key={item.id}>{item.title}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function CatalogArtwork({
  pkg,
  name,
}: {
  pkg?: MiniAppPackage;
  name: string;
}) {
  const page = pkg?.pages.find((p) => p.image);
  const asset = page?.image && pkg?.assets?.[page.image];
  if (asset)
    return (
      <div className="catalog-art" data-ready="true">
        <img
          src={"data:" + asset.mime + ";base64," + asset.data}
          alt={asset.alt}
        />
      </div>
    );
  const study = pkg?.pages.some((p) => p.practice);
  return (
    <div
      className={
        "catalog-art " + (study ? "catalog-art--book" : "catalog-art--folder")
      }
      data-ready={!!pkg}
      aria-label={name + " cover"}
      role="img"
    >
      <span className="catalog-object">
        <i />
        <b />
      </span>
    </div>
  );
}

export function CatalogCard({
  versions,
  view,
  installed,
  openInstalled,
  install,
  installPending = false,
}: {
  versions: CatalogEntry[];
  view: (entry: CatalogEntry) => void;
  installed: boolean;
  openInstalled?: () => void;
  install?: (entry: CatalogEntry) => void;
  installPending?: boolean;
}) {
  const entry = versions[0];
  const card = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!card.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([item]) => {
        if (item.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  const preview = useQuery({
    ...catalogPreviewOptions(entry),
    enabled: visible,
  });
  return (
    <article
      ref={card}
      className="mini-app-market-card"
      data-app={entry.publisher + "/" + entry.app}
    >
      <button
        className="mini-app-card-cover"
        aria-label={"View " + entry.name}
        onClick={() => view(entry)}
      >
        <CatalogArtwork pkg={preview.data} name={entry.name} />
      </button>
      <div className="px-6 pb-6 pt-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[19px] font-semibold tracking-tight">
            {entry.name}
          </h3>
          {installed && (
            <span className="mini-app-installed">
              <Check size={12} />
              Installed
            </span>
          )}
        </div>
        <p className="mt-2 line-clamp-3 min-h-16 text-[13px] leading-relaxed text-muted-foreground">
          {entry.description ??
            preview.data?.description ??
            "A small workspace to make your own."}
        </p>
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
          <span className="text-xs text-muted-foreground">
            Publisher ID: {entry.publisher}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 rounded-full"
            disabled={!installed && installPending}
            onClick={() =>
              installed && openInstalled
                ? openInstalled()
                : install
                  ? install(entry)
                  : view(entry)
            }
          >
            {installed && openInstalled
              ? "Open app"
              : install
                ? "Install"
                : "View app"}{" "}
            <ArrowRight />
          </Button>
        </div>
      </div>
    </article>
  );
}

export function CatalogDetail({
  versions,
  selected,
  select,
  install,
  back,
  copies = [],
  openCopy,
}: {
  versions: CatalogEntry[];
  selected: CatalogEntry;
  select: (entry: CatalogEntry) => void;
  install: (
    pkg: MiniAppPackage,
    entry: CatalogEntry,
    separate?: boolean,
  ) => void;
  back: () => void;
  copies?: { id: string; name: string }[];
  openCopy?: (id: string) => void;
}) {
  const preview = useQuery(catalogPreviewOptions(selected));
  const pkg = preview.data;
  const [choosingCopy, setChoosingCopy] = useState(false);
  const canOpen = !!openCopy && copies.length > 0;
  return (
    <section className="space-y-7">
      <Button variant="ghost" size="sm" onClick={back} className="-ml-3">
        <ArrowLeft />
        Back to Discover
      </Button>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:gap-12">
        <div className="space-y-4">
          <div className="mini-app-detail-cover">
            <PublicAppPreview pkg={pkg} name={selected.name} />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Example content from the app. Your copy has its own data.
          </p>
        </div>
        <div className="flex flex-col items-start justify-center py-2">
          <span className="mini-app-eyebrow">
            {catalogSourceLabel(selected)}
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {selected.name}
          </h2>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            {pkg?.description ?? selected.description}
          </p>
          <p className="mt-5 text-xs text-muted-foreground">
            Publisher ID: {selected.publisher}
          </p>
          <div className="my-7 w-full border-t border-border" />
          <div className="grid gap-3 text-sm">
            <p className="flex gap-3">
              <Monitor size={17} className="text-primary" />
              Saved on your Mac
            </p>
            <p className="flex gap-3">
              <LockKeyhole size={17} className="text-primary" />
              You choose its permissions
            </p>
          </div>
          <div className="mt-7 flex w-full flex-wrap items-center gap-3">
            <Button
              className="min-w-40 rounded-full"
              disabled={!pkg && !canOpen}
              onClick={() => {
                if (canOpen && copies.length === 1) openCopy!(copies[0].id);
                else if (canOpen) setChoosingCopy((value) => !value);
                else if (pkg) install(pkg, selected);
              }}
            >
              {canOpen
                ? copies.length === 1
                  ? "Open app"
                  : "Choose a copy"
                : "Get app"}{" "}
              <ArrowRight />
            </Button>
            {versions.length > 1 ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="sr-only">App version</span>
                <select
                  className={selectStyle + " !w-auto !rounded-full !text-xs"}
                  aria-label="App version"
                  value={selected.version}
                  onChange={(event) => {
                    const next = versions.find(
                      (item) => item.version === event.target.value,
                    );
                    if (next) select(next);
                  }}
                >
                  {versions.map((entry, index) => (
                    <option key={entry.version} value={entry.version}>
                      {entry.version}
                      {index === 0 ? " · Latest" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="text-xs text-muted-foreground">
                Version {selected.version}
              </span>
            )}
          </div>
          {canOpen && pkg && (
            <Button
              size="sm"
              variant="link"
              className="mt-2 px-0 !text-xs"
              onClick={() => install(pkg, selected, true)}
            >
              Create another copy
            </Button>
          )}
          {choosingCopy && canOpen && copies.length > 1 && (
            <div
              className="mt-4 grid w-full gap-1 rounded-xl border border-border bg-card p-2"
              aria-label="Your app copies"
            >
              {copies.map((copy) => (
                <Button
                  key={copy.id}
                  size="sm"
                  variant="ghost"
                  className="justify-start"
                  onClick={() => openCopy!(copy.id)}
                >
                  {copy.name}
                  <ArrowRight className="ml-auto" />
                </Button>
              ))}
            </div>
          )}
          {preview.isPending && (
            <p role="status" className="mt-4 text-sm text-muted-foreground">
              Loading app details…
            </p>
          )}
          <ErrorMessage error={preview.error} />
        </div>
      </div>
      {pkg && (
        <div className="grid gap-5 border-t border-border pt-7 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">
              Make it part of your routine
            </h3>
            <ul className="mt-4 grid gap-3">
              {pkg.pages.map((page) => (
                <li
                  key={page.id}
                  className="flex items-center gap-3 text-sm text-muted-foreground"
                >
                  <span className="size-1.5 rounded-full bg-primary/40" />
                  {page.title}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-muted/60 p-5">
            <h3 className="text-sm font-semibold">
              A copy that belongs to you
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Your saved items stay separate from other copies. Updating the app
              keeps them in place. Optional model access is yours to enable.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
