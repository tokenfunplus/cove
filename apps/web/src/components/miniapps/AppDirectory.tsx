import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import type {
  MiniAppInstance,
  MiniAppPackage,
  MiniAppRelease,
} from "@cove/api-contract";
import {
  ArrowRight,
  ArrowUpRight,
  FolderOpen,
  HardDrive,
  MoreHorizontal,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { appKeys, miniApps } from "@/api/mini-apps";
import { COVEWEB_APPS_URL, coveWebAppURL } from "@/lib/coveweb-apps";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/file-input";
import { Input } from "@/components/ui/input";
import { ErrorMessage, canUpgrade, sectionStyle } from "./presentation";
import { PackagePreview, type PackageSource } from "./AppInstallPreview";
import { AppMark } from "./AppPackagePreview";
import { HostActivity } from "./HostActivity";
import { PackageEditor } from "./PackageEditor";
import { CatalogSettings } from "./CatalogSettings";
import "./mini-apps.css";

export { PackagePreview } from "./AppInstallPreview";
export type InstallTarget = {
  publisher: string;
  app: string;
  version?: string;
};
export type DirectorySection =
  | "mine"
  | "catalog"
  | "activity"
  | "agent"
  | "packages"
  | "restore"
  | "settings";
interface Props {
  open: (id: string, view?: string, replace?: boolean) => void;
  target?: InstallTarget;
  section?: DirectorySection;
  navigate?: (path: string, replace?: boolean) => void;
}
function matches(
  pkg: Pick<MiniAppPackage, "publisher" | "app" | "version">,
  target?: InstallTarget,
) {
  return (
    !target ||
    (pkg.app === target.app &&
      pkg.publisher === target.publisher &&
      (!target.version || pkg.version === target.version))
  );
}

export function AppDirectory({
  open,
  target,
  section: requestedSection,
  navigate,
}: Props) {
  const standalone = Boolean(navigate) && !target;
  const [localSection, setLocalSection] = useState<DirectorySection>("mine");
  const section =
    requestedSection === "catalog" ? "mine" : (requestedSection ?? localSection);
  const file = useRef<HTMLInputElement>(null);
  const backupFile = useRef<HTMLInputElement>(null);
  const previewRequest = useRef(0);
  const cache = useQueryClient();
  const [backup, setBackup] = useState<File>();
  const [search, setSearch] = useState("");
  const [packageDraft, setPackageDraft] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [preview, setPreview] = useState<{
    pkg: MiniAppPackage;
    source: PackageSource;
    createNewCopy?: boolean;
  }>();
  const term = search.trim().toLocaleLowerCase();
  const contains = (...values: (string | undefined)[]) =>
    !term || values.some((value) => value?.toLocaleLowerCase().includes(term));
  function changeSection(next: DirectorySection) {
    previewRequest.current++;
    setPreview(undefined);
    setSearch("");
    if (navigate) navigate(next === "mine" ? "/apps" : "/apps?section=" + next);
    else setLocalSection(next);
  }
  const instances = useQuery({
    queryKey: appKeys.instances,
    queryFn: miniApps.instances,
    retry: false,
  });
  const releases = useQuery({
    queryKey: appKeys.releases,
    queryFn: miniApps.releases,
    retry: false,
  });
  const installed = releases.data?.packages ?? [];
  const allBooks = instances.data?.instances ?? [];
  function upgradableCopies(pkg: MiniAppPackage, source: Pick<MiniAppRelease, "origin" | "catalog_authority" | "official_catalog">) {
    return allBooks.filter((book) => {
      const before = installed.find((release) => release.id === book.release_id);
      return before && canUpgrade(before.package, pkg, before.origin, source.origin, before, source);
    });
  }
  const books = allBooks.filter(
    (book) =>
      !target ||
      installed.some(
        (release) =>
          release.id === book.release_id &&
          release.origin !== "local" &&
          matches(release.package, target),
      ),
  );
  const ready = instances.isSuccess && releases.isSuccess;
  const matchingInstalled = target
    ? installed.filter(
        (release) =>
          release.origin !== "local" && matches(release.package, target),
      )
    : [];
  const showInstallRelease = !!target && ready && matchingInstalled.length === 0;
  const catalog = useQuery({
    queryKey: appKeys.catalog,
    queryFn: miniApps.catalog,
    retry: false,
    enabled: showInstallRelease,
  });
  const entries = (catalog.data?.packages ?? []).filter((entry) =>
    matches(entry, target),
  );
  const targetRelease = [...entries].sort((a, b) =>
    b.version.localeCompare(a.version, "en", { numeric: true }),
  )[0];
  useEffect(() => {
    previewRequest.current++;
    setPreview(undefined);
  }, [requestedSection, target?.publisher, target?.app, target?.version]);
  useEffect(() => {
    if (!navigate) return;
    const leaveReview = () => {
      previewRequest.current++;
      setPreview(undefined);
    };
    window.addEventListener("popstate", leaveReview);
    return () => window.removeEventListener("popstate", leaveReview);
  }, [navigate]);
  // A catalog handoff opens an existing copy without requesting the directory.
  const onlyBook =
    ready && target && books.length === 1 ? books[0].id : undefined;
  useEffect(() => {
    if (onlyBook) open(onlyBook, undefined, true);
  }, [onlyBook, open]);
  const restore = useMutation({
    retry: false,
    mutationFn: async (selected: File) => {
      if (selected.size > 42 * 1024 * 1024)
        throw new Error("Choose a backup of at most 42 MiB.");
      return miniApps.restore(await selected.text());
    },
    onSuccess: async (book) => {
      await cache.invalidateQueries({ queryKey: appKeys.instances });
      open(book.id);
    },
  });
  const remove = useMutation({
    mutationFn: miniApps.removeRelease,
    onSuccess: async () => {
      setRemoveId("");
      await cache.invalidateQueries({ queryKey: appKeys.releases });
    },
  });
  const inspect = useMutation({
    retry: false,
    mutationFn: async (source: PackageSource | File) => {
      if (source instanceof File) {
        if (source.size > 1024 * 1024)
          throw new Error("Choose an app file of at most 1 MiB.");
        const raw = await source.text();
        const release = await miniApps.localPackage(raw, "preview");
        return {
          pkg: release.package,
          source: {
            kind: "local",
            raw,
            release_id: release.id,
            digest: release.digest,
            origin: release.origin,
            catalog_authority: release.catalog_authority,
            official_catalog: release.official_catalog,
          } as PackageSource,
        };
      }
      const pkg =
        source.kind === "catalog"
          ? await miniApps.catalogPreview(source.entry)
          : source.kind === "installed"
            ? source.release.package
            : (await miniApps.localPackage(source.raw, "preview")).package;
      return { pkg, source };
    },
  });
  function inspectPackage(source: PackageSource | File) {
    const token = ++previewRequest.current;
    inspect.mutate(source, {
      onSuccess: (result) => {
        if (previewRequest.current === token) setPreview(result);
      },
    });
  }
  const error = instances.error ?? releases.error;
  const navigation = !target && (
    <div className="flex items-center justify-between gap-4 border-b border-border">
      <nav aria-label="Mini Apps navigation" className="mini-app-nav !border-0">
        <button
          aria-current={section === "mine" ? "page" : undefined}
          onClick={() => changeSection("mine")}
        >
          My apps
          {books.length > 0 && (
            <span className="ml-2 text-[10px] opacity-50">{books.length}</span>
          )}
        </button>
        <a
          href={COVEWEB_APPS_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Browse apps on CoveWeb"
          className="inline-flex items-center gap-1 py-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <span className="sm:hidden">CoveWeb apps</span>
          <span className="hidden sm:inline">Browse apps on CoveWeb</span>
          <ArrowUpRight size={13} />
        </a>
      </nav>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => file.current?.click()}
          disabled={inspect.isPending}
        >
          <Upload />
          <span className="hidden sm:inline">Import app</span>
          <span className="sr-only sm:hidden">Import app</span>
        </Button>
        {standalone && (
          <Menu>
            <MenuButton
              as={Button}
              variant="ghost"
              size="icon-sm"
              aria-label="More app options"
            >
              <MoreHorizontal />
            </MenuButton>
            <MenuItems
              anchor="bottom end"
              className="z-[120] mt-2 w-56 rounded-xl border border-border bg-popover p-1.5 text-sm shadow-popover focus:outline-none"
            >
              {(
                [
                  ["activity", "Activity"],
                  ["agent", "Developer tools"],
                  ["packages", "Manage installed versions"],
                  ["restore", "Restore a backup"],
                  ["settings", "Release source"],
                ] as const
              ).map(([value, label]) => (
                <MenuItem key={value}>
                  <button
                    className="w-full rounded-lg px-3 py-2.5 text-left data-focus:bg-muted"
                    onClick={() => changeSection(value)}
                  >
                    {label}
                  </button>
                </MenuItem>
              ))}
            </MenuItems>
          </Menu>
        )}
      </div>
    </div>
  );
  let installation;
  if (preview && ready) {
    const origin =
      preview.source.kind === "installed"
        ? preview.source.release.origin
        : preview.source.kind === "catalog"
          ? preview.source.entry.origin
          : (preview.source.origin ?? "local");
    installation = (
      <PackagePreview
        dialog
        key={
          preview.pkg.publisher +
          "/" +
          preview.pkg.app +
          "/" +
          preview.pkg.version
        }
        {...preview}
        versions={Object.fromEntries(
          installed.map((release) => [release.id, release.package.version]),
        )}
        previous={upgradableCopies(preview.pkg, {
          ...(preview.source.kind === "catalog"
            ? preview.source.entry
            : preview.source.kind === "installed"
              ? preview.source.release
              : preview.source),
          origin,
        })}
        close={() => setPreview(undefined)}
        open={open}
      />
    );
  }
  return (
    <div className="space-y-8">
      {installation}
      <FileInput
        ref={file}
        accept=".coveapp,.json"
        aria-label="Choose a Mini App package"
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = "";
          if (chosen) inspectPackage(chosen);
        }}
      />
      <FileInput
        ref={backupFile}
        accept=".covedata"
        aria-label="Choose an instance backup"
        onChange={(event) => {
          setBackup(event.target.files?.[0]);
          event.target.value = "";
          restore.reset();
        }}
      />
      {navigation}
      <ErrorMessage error={error ?? inspect.error} />
      {!ready && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading your apps…
        </p>
      )}
      {(section === "mine" || target) && (
        <section className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mini-app-eyebrow">Your own little workspace</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                {target ? "Choose an instance" : "Your apps, your space."}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {target
                  ? "Open one of your copies, or install the app below."
                  : "Your notebooks, collections and everyday tools. All in one place."}
              </p>
            </div>
            {books.length > 3 && (
              <SearchField
                value={search}
                change={setSearch}
                placeholder="Find an app"
              />
            )}
          </div>
          {ready && books.length === 0 && !target && (
            <div className="grid gap-8 rounded-3xl border border-border/70 bg-card px-7 py-10 sm:grid-cols-[180px_1fr] sm:items-center sm:px-10 sm:py-12">
              <div className="mini-app-empty-art mx-auto" aria-hidden="true">
                <AppMark name="C" />
              </div>
              <div className="max-w-md text-center sm:text-left">
                <h3 className="text-xl font-semibold tracking-tight">
                  Start with something useful.
                </h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                  A place to practise, keep a reading list, or collect ideas.
                  Pick an app to start your own copy.
                </p>
                <Button asChild className="mt-6 rounded-full px-5">
                  <a href={COVEWEB_APPS_URL} target="_blank" rel="noreferrer">
                    Browse apps on CoveWeb <ArrowRight />
                  </a>
                </Button>
                <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground sm:justify-start">
                  <HardDrive size={13} />
                  Your saved items stay on this Mac.
                </p>
              </div>
            </div>
          )}
          {target && ready && books.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {target.version
                ? "No installed instance uses version " + target.version + "."
                : "No copy of this app is installed yet."}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {books
              .filter((book) =>
                contains(
                  book.name,
                  installed.find((release) => release.id === book.release_id)
                    ?.package.name,
                ),
              )
              .map((book) => (
                <InstanceCard
                  key={book.id}
                  book={book}
                  release={installed.find(
                    (release) => release.id === book.release_id,
                  )}
                  open={() => open(book.id)}
                />
              ))}
          </div>
          {books.length > 0 && !target && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-muted/50 px-5 py-4 text-sm">
              <p className="text-muted-foreground">
                Room for another little helper?
              </p>
              <Button asChild size="sm" variant="ghost">
                <a href={COVEWEB_APPS_URL} target="_blank" rel="noreferrer">
                  Browse apps on CoveWeb <ArrowRight />
                </a>
              </Button>
            </div>
          )}
          {target && matchingInstalled.map((release) => (
            <div key={release.id} className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">Version {release.package.version}</span>
              {upgradableCopies(release.package, release).length > 0 && (
                <Button onClick={() => {
                  ++previewRequest.current;
                  setPreview({ pkg: release.package, source: { kind: "installed", release } });
                }}>
                  Review update
                </Button>
              )}
              <Button variant="outline" onClick={() => {
                ++previewRequest.current;
                setPreview({ pkg: release.package, source: { kind: "installed", release }, createNewCopy: true });
              }}>
                <Plus /> New instance
              </Button>
            </div>
          ))}
        </section>
      )}
      {showInstallRelease && (
        <section className={sectionStyle} aria-label="Install from CoveWeb">
          <p className="mini-app-eyebrow">Installation</p>
          <h2 className="text-xl font-semibold">Install an app on this Mac</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Cove checks this release before you choose access and create or
            update a copy.
          </p>
          <ErrorMessage error={catalog.error} />
          {catalog.data?.warning && (
            <p role="status" className="text-sm text-muted-foreground">
              {catalog.data.warning}
            </p>
          )}
          {catalog.isPending && (
            <p role="status">Finding the requested release…</p>
          )}
          {catalog.isSuccess && !targetRelease && (
            <p role="alert">No matching release in the catalog.</p>
          )}
          {targetRelease && (
            <div className="space-y-3">
              <h3 className="font-semibold">{targetRelease.name}</h3>
              <p className="text-sm text-muted-foreground">
                {targetRelease.description}
              </p>
              <p className="text-xs text-muted-foreground">
                Version {targetRelease.version} · {targetRelease.publisher}
              </p>
              <Button
                disabled={inspect.isPending}
                onClick={() =>
                  inspectPackage({ kind: "catalog", entry: targetRelease })
                }
              >
                Preview release
              </Button>
            </div>
          )}
          <a
            className="inline-flex items-center gap-1 text-sm text-primary underline"
            href={coveWebAppURL(target!.publisher, target!.app, target!.version)}
            target="_blank"
            rel="noreferrer"
          >
            View app on CoveWeb <ArrowRight size={14} />
          </a>
        </section>
      )}
      {standalone && section === "activity" && (
        <div className="space-y-6">
          <SectionHeading
            title="Activity"
            description="Changes and model tasks across your apps."
          />
          <HostActivity instances={allBooks} expanded />
        </div>
      )}
      {standalone && section === "agent" && (
        <div className="space-y-6">
          <SectionHeading
            title="Build something of your own."
            description="Start with an example or open an app file from your agent."
          />
          <PackageEditor
            source={packageDraft}
            onChange={setPackageDraft}
            examples={[]}
            preview={async (raw) => {
              const token = ++previewRequest.current;
              const release = await miniApps.localPackage(raw, "preview");
              if (previewRequest.current !== token) return;
              setPreview({
                pkg: release.package,
                source: {
                  kind: "local",
                  raw,
                  release_id: release.id,
                  digest: release.digest,
                  origin: release.origin,
                  catalog_authority: release.catalog_authority,
                  official_catalog: release.official_catalog,
                },
              });
            }}
            expanded
          />
        </div>
      )}
      {standalone && section === "settings" && (
        <div className="space-y-6">
          <SectionHeading
            title="Release source"
            description="View the source Cove uses to verify installs and updates."
          />
          <CatalogSettings expanded />
        </div>
      )}
      {standalone && section === "restore" && (
        <section className="space-y-6">
          <SectionHeading
            title="Restore a backup"
            description="Restore a saved app backup on this Mac."
          />
          <div className={sectionStyle}>
            <p className="max-w-lg text-sm leading-7 text-muted-foreground">
              Choose a .covedata backup. Cove creates a separate copy with
              access turned off, so you can review permissions before using it.
              The original app version must be installed.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={() => backupFile.current?.click()}
              >
                <FolderOpen />
                Choose backup
              </Button>
              {backup && (
                <Button
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(backup)}
                >
                  Restore {backup.name}
                </Button>
              )}
            </div>
            <ErrorMessage error={restore.error} />
          </div>
        </section>
      )}
      {standalone && section === "packages" && (
        <section className="space-y-6">
          <SectionHeading
            title="Installed app files"
            description="Create another copy, or remove a version you no longer use."
          />
          <SearchField
            value={search}
            change={setSearch}
            placeholder="Apps, instances or publishers"
          />
          <ErrorMessage error={remove.error} />
          <div className="divide-y divide-border rounded-2xl border border-border bg-card px-5">
            {installed
              .filter((release) =>
                contains(
                  release.package.name,
                  release.package.publisher,
                  release.package.app,
                ),
              )
              .map((release) => {
                const used = allBooks.some(
                  (book) => book.release_id === release.id,
                );
                return (
                  <div
                    key={release.id}
                    data-release={release.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-5"
                  >
                    <div className="flex items-center gap-3">
                      <AppMark name={release.package.name} small />
                      <div>
                        <strong className="text-sm">
                          {release.package.name}
                        </strong>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {release.package.version} ·{" "}
                          {release.package.publisher}
                          {used ? " · In use" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          ++previewRequest.current;
                          setPreview({
                            pkg: release.package,
                            source: { kind: "installed", release },
                            createNewCopy: true,
                          });
                        }}
                      >
                        <Plus />
                        New instance
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={used || remove.isPending}
                        onClick={() => setRemoveId(release.id)}
                      >
                        Remove package
                      </Button>
                    </div>
                    {removeId === release.id && (
                      <div className="flex w-full flex-wrap items-center gap-3 rounded-xl bg-muted p-3 text-sm">
                        Remove this unused app version?
                        <Button
                          size="sm"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(release.id)}
                        >
                          Confirm package removal
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRemoveId("")}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            {installed.length === 0 && (
              <p className="py-6 text-sm text-muted-foreground">
                No app files installed yet.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function SearchField({
  value,
  change,
  placeholder,
}: {
  value: string;
  change: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="relative block w-full sm:w-60">
      <Search
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <span className="sr-only">{placeholder}</span>
      <Input
        type="search"
        value={value}
        onChange={(event) => change(event.target.value)}
        placeholder={placeholder}
        className="!h-10 !rounded-full !pl-9 !text-xs"
      />
    </label>
  );
}
function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
function InstanceCard({
  book,
  release,
  open,
}: {
  book: MiniAppInstance;
  release?: MiniAppRelease;
  open: () => void;
}) {
  return (
    <button
      className="group flex min-h-40 w-full flex-col items-start rounded-2xl border border-border/80 bg-card p-5 text-left transition hover:-translate-y-0.5 hover:border-primary/30 focus-visible:outline-2 focus-visible:outline-ring"
      onClick={open}
    >
      <div className="mb-5 flex w-full items-start justify-between gap-3">
        <AppMark name={release?.package.name ?? book.name} small />
        <ArrowRight
          size={16}
          className="text-muted-foreground opacity-40 transition group-hover:translate-x-1 group-hover:text-primary group-hover:opacity-100"
        />
      </div>
      <strong className="text-base font-semibold tracking-tight">
        {book.name}
      </strong>
      <span className="mt-1 text-xs text-muted-foreground">
        {release?.package.name}
        {book.enabled ? "" : " · Access paused"}
      </span>
    </button>
  );
}
