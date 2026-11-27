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
  Code2,
  FolderOpen,
  HardDrive,
  MoreHorizontal,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { appKeys, miniApps, type CatalogEntry } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/file-input";
import { Input } from "@/components/ui/input";
import { ErrorMessage, canUpgrade, sectionStyle } from "./presentation";
import { PackagePreview, type PackageSource } from "./AppInstallPreview";
import {
  AppMark,
  CatalogCard,
  CatalogDetail,
  groupCatalog,
} from "./AppCatalog";
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
  navigate?: (path: string) => void;
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
  const section = requestedSection ?? localSection;
  const file = useRef<HTMLInputElement>(null);
  const backupFile = useRef<HTMLInputElement>(null);
  const cache = useQueryClient();
  const [backup, setBackup] = useState<File>();
  const [search, setSearch] = useState("");
  const [packageDraft, setPackageDraft] = useState("");
  const [localDetail, setLocalDetail] = useState<CatalogEntry>();
  const [removeId, setRemoveId] = useState("");
  const [preview, setPreview] = useState<{
    pkg: MiniAppPackage;
    source: PackageSource;
  }>();
  const term = search.trim().toLocaleLowerCase();
  const contains = (...values: (string | undefined)[]) =>
    !term || values.some((value) => value?.toLocaleLowerCase().includes(term));
  function changeSection(next: DirectorySection) {
    setPreview(undefined);
    setSearch("");
    setLocalDetail(undefined);
    if (navigate) navigate(next === "mine" ? "/apps" : "/apps?section=" + next);
    else setLocalSection(next);
  }
  function showDetail(entry: CatalogEntry) {
    if (navigate)
      navigate(
        "/apps?" +
          new URLSearchParams({
            section: "catalog",
            app: entry.publisher + "/" + entry.app,
            version: entry.version,
          }),
      );
    else {
      setLocalSection("catalog");
      setLocalDetail(entry);
    }
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
  const showCatalog = target
    ? ready && books.length !== 1
    : section === "catalog" || section === "agent";
  const catalog = useQuery({
    queryKey: appKeys.catalog,
    queryFn: miniApps.catalog,
    retry: false,
    enabled: showCatalog,
  });
  const entries = (catalog.data?.packages ?? []).filter((entry) =>
    matches(entry, target),
  );
  const groups = groupCatalog(entries);
  const params = new URLSearchParams(window.location.search);
  const detailName = params.get("app");
  const detailVersion = params.get("version");
  useEffect(() => {
    setPreview(undefined);
  }, [requestedSection, detailName, detailVersion]);
  useEffect(() => {
    if (!navigate) return;
    const leaveReview = () => setPreview(undefined);
    window.addEventListener("popstate", leaveReview);
    return () => window.removeEventListener("popstate", leaveReview);
  }, [navigate]);
  const detail = standalone
    ? groups
        .find((group) => group[0].publisher + "/" + group[0].app === detailName)
        ?.find((entry) => !detailVersion || entry.version === detailVersion)
    : localDetail;
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
            origin: release.origin,
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
    onSuccess: setPreview,
  });
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
        <button
          aria-current={section === "catalog" ? "page" : undefined}
          onClick={() => changeSection("catalog")}
        >
          Discover
        </button>
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
                  ["settings", "Catalog settings"],
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
        previous={allBooks.filter((book) => {
          const before = installed.find(
            (release) => release.id === book.release_id,
          );
          return (
            before &&
            canUpgrade(
              before.package,
              preview.pkg,
              before.origin,
              origin,
              before.legacy_verified,
            )
          );
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
          if (chosen) inspect.mutate(chosen);
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
                <Button
                  className="mt-6 rounded-full px-5"
                  onClick={() => changeSection("catalog")}
                >
                  Explore apps <ArrowRight />
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
              <Button
                size="sm"
                variant="ghost"
                onClick={() => changeSection("catalog")}
              >
                Discover apps <ArrowRight />
              </Button>
            </div>
          )}
          {target &&
            installed
              .filter((release) => matches(release.package, target))
              .map((release) => (
                <Button
                  key={release.id}
                  variant="outline"
                  onClick={() => inspect.mutate({ kind: "installed", release })}
                >
                  <Plus />
                  New instance
                </Button>
              ))}
        </section>
      )}
      {showCatalog &&
        (section === "catalog" || target) &&
        (detail && !target ? (
          <CatalogDetail
            versions={
              groups.find((group) =>
                group.some((entry) => entry === detail),
              ) ?? [detail]
            }
            selected={detail}
            select={showDetail}
            back={() => changeSection("catalog")}
            copies={allBooks.filter((book) =>
              installed.some(
                (release) =>
                  release.id === book.release_id &&
                  release.digest === detail.digest &&
                  matches(release.package, detail),
              ),
            )}
            openCopy={(id) => open(id)}
            install={(pkg, entry, separate) => {
              const existing = separate
                ? (installed.find(
                    (release) =>
                      release.origin !== "local" &&
                      release.digest === entry.digest &&
                      matches(release.package, entry),
                  ) ??
                  installed.find(
                    (release) =>
                      release.digest === entry.digest &&
                      matches(release.package, entry),
                  ))
                : undefined;
              setPreview({
                pkg,
                source: existing
                  ? { kind: "installed", release: existing }
                  : { kind: "catalog", entry },
              });
            }}
          />
        ) : (
          <section id="mini-app-catalog" className="space-y-7">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div>
                <p className="mini-app-eyebrow">The app collection</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-[40px]">
                  App catalog
                </h2>
                <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
                  Find an app for your everyday and install a personal copy.
                  Everything you save stays on your Mac.
                </p>
              </div>
              {!target && (
                <SearchField
                  value={search}
                  change={setSearch}
                  placeholder="Find an app"
                />
              )}
            </div>
            <ErrorMessage error={catalog.error} />
            {catalog.data?.warning && (
              <p
                role="status"
                className="rounded-xl bg-muted px-4 py-3 text-xs text-muted-foreground"
              >
                {catalog.data.warning}
              </p>
            )}
            {catalog.isPending && (
              <p role="status" className="text-sm text-muted-foreground">
                Finding apps…
              </p>
            )}
            {catalog.isSuccess && entries.length === 0 && (
              <p>No matching release in the catalog.</p>
            )}
            <div className="grid gap-6 sm:grid-cols-2">
              {groups
                .filter((group) =>
                  contains(
                    group[0].name,
                    group[0].description,
                    group[0].publisher,
                  ),
                )
                .map((versions) =>
                  target ? (
                    <div
                      key={versions[0].publisher + versions[0].app}
                      className={sectionStyle}
                    >
                      <h3 className="font-semibold">{versions[0].name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {versions[0].description}
                      </p>
                      <Button
                        disabled={inspect.isPending}
                        onClick={() =>
                          inspect.mutate({
                            kind: "catalog",
                            entry: versions[0],
                          })
                        }
                      >
                        Preview release
                      </Button>
                    </div>
                  ) : (
                    <CatalogCard
                      key={versions[0].publisher + "/" + versions[0].app}
                      versions={versions}
                      view={showDetail}
                      install={(entry) =>
                        inspect.mutate({ kind: "catalog", entry })
                      }
                      openInstalled={() => {
                        const copies = allBooks.filter((book) =>
                          installed.some(
                            (release) =>
                              release.id === book.release_id &&
                              release.origin !== "local" &&
                              release.package.publisher ===
                                versions[0].publisher &&
                              release.package.app === versions[0].app,
                          ),
                        );
                        if (copies.length === 1) open(copies[0].id);
                        else showDetail(versions[0]);
                      }}
                      installed={allBooks.some((book) =>
                        installed.some(
                          (release) =>
                            release.id === book.release_id &&
                            release.origin !== "local" &&
                            release.package.publisher ===
                              versions[0].publisher &&
                            release.package.app === versions[0].app,
                        ),
                      )}
                    />
                  ),
                )}
            </div>
            {!target &&
              catalog.isSuccess &&
              groups.length > 0 &&
              !groups.some((group) =>
                contains(
                  group[0].name,
                  group[0].description,
                  group[0].publisher,
                ),
              ) && (
                <p className="text-sm text-muted-foreground">
                  No apps match that search.
                </p>
              )}
            {!target && (
              <div className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-dashed border-border px-6 py-5">
                <div className="flex items-center gap-4">
                  <Code2 size={22} className="text-muted-foreground" />
                  <div>
                    <h3 className="text-sm font-medium">
                      Have an app of your own?
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Bring a file from your agent, or start with an example.
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    standalone ? changeSection("agent") : file.current?.click()
                  }
                >
                  {standalone ? "Create with your agent" : "Import app"}
                  <ArrowRight />
                </Button>
              </div>
            )}
          </section>
        ))}
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
            examples={entries.filter((entry) => entry.origin === "builtin")}
            preview={async (raw) => {
              const release = await miniApps.localPackage(raw, "preview");
              setPreview({
                pkg: release.package,
                source: { kind: "local", raw, origin: release.origin },
              });
            }}
            expanded
          />
        </div>
      )}
      {standalone && section === "settings" && (
        <div className="space-y-6">
          <SectionHeading
            title="Catalog settings"
            description="Choose where Cove finds additional apps and updates."
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
                        onClick={() =>
                          setPreview({
                            pkg: release.package,
                            source: { kind: "installed", release },
                          })
                        }
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
