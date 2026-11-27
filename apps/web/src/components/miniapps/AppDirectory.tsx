import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MiniAppInstance,
  MiniAppPackage,
  MiniAppRelease,
} from "@cove/api-contract";
import { BookOpen, Download, FolderOpen, Plus } from "lucide-react";
import { appKeys, miniApps, type CatalogEntry } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/file-input";
import { Input } from "@/components/ui/input";
import {
  ErrorMessage,
  Grants,
  canUpgrade,
  labelStyle,
  sectionStyle,
  selectStyle,
} from "./presentation";

import { CatalogSettings } from "./CatalogSettings";

type Source =
  | { kind: "local"; raw: string; origin?: string }
  | { kind: "catalog"; entry: CatalogEntry }
  | { kind: "installed"; release: MiniAppRelease };
export type InstallTarget = {
  publisher: string;
  app: string;
  version?: string;
};
interface Props {
  open: (id: string, view?: string, replace?: boolean) => void;
  target?: InstallTarget;
}
function matches(pkg: MiniAppPackage, target?: InstallTarget) {
  return (
    !target ||
    (pkg.app === target.app &&
      pkg.publisher === target.publisher &&
      (!target.version || pkg.version === target.version))
  );
}

export function AppDirectory({ open, target }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const backupFile = useRef<HTMLInputElement>(null);
  const cache = useQueryClient();
  const [backup, setBackup] = useState<File>();
  const restore = useMutation({
    retry: false,
    mutationFn: async (selected: File) => {
      if (selected.size > 42 * 1024 * 1024)
        throw new Error("Choose an instance backup of at most 42 MiB.");
      return miniApps.restore(await selected.text());
    },
    onSuccess: async (book) => {
      await cache.invalidateQueries({ queryKey: appKeys.instances });
      open(book.id);
    },
  });
  const [browse, setBrowse] = useState(false);

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
  const books = (instances.data?.instances ?? []).filter(
    (item) =>
      !target ||
      installed.some(
        (release) =>
          release.id === item.release_id &&
          release.origin !== "local" &&
          matches(release.package, target),
      ),
  );
  const ready = instances.isSuccess && releases.isSuccess;
  const showCatalog = browse || (ready && books.length === 0);
  const catalog = useQuery({
    queryKey: appKeys.catalog,
    queryFn: miniApps.catalog,
    retry: false,
    enabled: showCatalog,
  });
  const [preview, setPreview] = useState<{
    pkg: MiniAppPackage;
    source: Source;
  }>();
  const inspect = useMutation({
    retry: false,
    mutationFn: async (source: Source | File) => {
      if (source instanceof File) {
        if (source.size > 1024 * 1024)
          throw new Error("Choose a package of at most 1 MiB.");
        const raw = await source.text();
        const release = await miniApps.localPackage(raw, "preview");
        return {
          pkg: release.package,
          source: { kind: "local", raw, origin: release.origin } as Source,
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
  // A catalog handoff can open one installed instance without contacting the catalog.
  const onlyBook =
    ready && target && books.length === 1 ? books[0].id : undefined;
  useEffect(() => {
    if (onlyBook) open(onlyBook, undefined, true);
  }, [onlyBook, open]);
  if (preview && ready)
    return (
      <PackagePreview
        {...preview}
        versions={Object.fromEntries(
          installed.map((r) => [r.id, r.package.version]),
        )}
        previous={(instances.data?.instances ?? []).filter((i) => {
          const previous = installed.find((r) => r.id === i.release_id);
          const origin =
            preview.source.kind === "installed"
              ? preview.source.release.origin
              : preview.source.kind === "catalog"
                ? preview.source.entry.origin
                : (preview.source.origin ?? "local");
          return (
            previous &&
            canUpgrade(previous.package, preview.pkg, previous.origin, origin, previous.legacy_verified)
          );
        })}
        close={() => setPreview(undefined)}
        open={open}
      />
    );
  const error = instances.error ?? releases.error;
  const entries = (catalog.data?.packages ?? [])
    .filter(
      (entry) =>
        !target ||
        (entry.app === target.app &&
          entry.publisher === target.publisher &&
          (!target.version || entry.version === target.version)),
    )
    .sort(
      (a, b) =>
        a.publisher.localeCompare(b.publisher) ||
        a.app.localeCompare(b.app) ||
        b.version.localeCompare(a.version, "en", { numeric: true }),
    );
  return (
    <div className="space-y-5">
      <section className={sectionStyle}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {target ? "Choose an instance" : "My apps"}
          </h2>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={inspect.isPending}
              onClick={() => file.current?.click()}
            >
              <FolderOpen />
              Import package
            </Button>
            <FileInput
              ref={file}
              accept=".coveapp,.json"
              aria-label="Choose a Mini App package"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                e.target.value = "";
                if (selected) inspect.mutate(selected);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setBrowse(true);
              }}
            >
              <Download />
              Browse catalog
            </Button>
          </div>
        </div>
        {!ready && !error && <p role="status">Loading apps…</p>}
        <ErrorMessage error={error ?? inspect.error} />
        {ready && books.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {target?.version
              ? "No installed instance uses version " + target.version + "."
              : "Install a package to create an instance."}
          </p>
        )}
        {books.map((book) => (
          <InstanceRow
            key={book.id}
            book={book}
            release={installed.find((r) => r.id === book.release_id)}
            open={() => open(book.id)}
          />
        ))}
      </section>
      <details className={sectionStyle}>
        <summary className="cursor-pointer text-sm font-semibold">
          Restore an instance backup
        </summary>
        <p className="text-sm">
          Restore saved records into a new disabled instance. Install the
          original package release first, then choose permissions in instance
          settings after restoring.
        </p>
        <FileInput
          ref={backupFile}
          accept=".covedata"
          aria-label="Choose an instance backup"
          onChange={(e) => {
            setBackup(e.target.files?.[0]);
            e.target.value = "";
            restore.reset();
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => backupFile.current?.click()}
          >
            Choose backup
          </Button>
          {backup && (
            <Button
              size="sm"
              disabled={restore.isPending}
              onClick={() => restore.mutate(backup)}
            >
              Restore {backup.name}
            </Button>
          )}
        </div>
        <ErrorMessage error={restore.error} />
      </details>
      {showCatalog && (
        <section className={sectionStyle}>
          <h2 className="text-lg font-semibold">App catalog</h2>
          <ErrorMessage error={catalog.error} />
          {catalog.data?.warning && <p role="status">{catalog.data.warning}</p>}
          {catalog.isPending && <p role="status">Loading catalog…</p>}
          {catalog.isSuccess && entries.length === 0 && (
            <p>No matching release in the catalog.</p>
          )}
          {entries.map((entry) => (
            <div
              key={[entry.publisher, entry.app, entry.version].join("/")}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"
            >
              <div>
                <strong>{entry.name}</strong>
                <p className="text-sm text-muted-foreground">
                  {entry.publisher} / {entry.app} · {entry.version}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={inspect.isPending}
                onClick={() => inspect.mutate({ kind: "catalog", entry })}
              >
                Preview release
              </Button>
            </div>
          ))}
        </section>
      )}
      <CatalogSettings />
      {installed.length > 0 && (
        <section className={sectionStyle}>
          <h2 className="text-lg font-semibold">Installed packages</h2>
          {installed
            .filter((r) => matches(r.package, target))
            .map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"
              >
                <div>
                  <strong>{r.package.name}</strong>
                  <p className="text-sm text-muted-foreground">
                    {r.package.publisher} · {r.package.version} · {r.origin}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setPreview({
                      pkg: r.package,
                      source: { kind: "installed", release: r },
                    })
                  }
                >
                  <Plus />
                  New instance
                </Button>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}

function InstanceRow({
  book,
  release,
  open,
}: {
  book: MiniAppInstance;
  release?: MiniAppRelease;
  open: () => void;
}) {
  return (
    <Button
      variant="plain"
      className="flex h-auto w-full items-center justify-start gap-3 border-t border-border rounded-none px-0 py-3 text-left"
      onClick={open}
    >
      <BookOpen className="text-primary" />
      <span>
        <strong>{book.name}</strong>
        <span className="block text-sm text-muted-foreground">
          {release?.package.name} · {release?.package.version}
          {book.enabled ? "" : " · Disabled"}
        </span>
      </span>
    </Button>
  );
}

export function PackagePreview({
  pkg,
  previous,
  source,
  close,
  open,
  targetInstance,
  versions = {},
}: {
  pkg: MiniAppPackage;
  previous: MiniAppInstance[];
  source: Source;
  close: () => void;
  open: Props["open"];
  targetInstance?: MiniAppInstance;
  versions?: Record<string, string>;
}) {
  const cache = useQueryClient();
  const [name, setName] = useState(pkg.name);
  const firstTarget =
    targetInstance ??
    (source.kind !== "installed" && previous.length === 1
      ? previous[0]
      : undefined);
  const [selectedId, setUpgrade] = useState(
    firstTarget?.id ??
      (source.kind !== "installed" && previous.length > 1 ? "choose" : ""),
  );
  const upgradeId = targetInstance?.id ?? selectedId;
  const upgrade = targetInstance ?? previous.find((i) => i.id === upgradeId);
  const [grants, setGrants] = useState<string[]>(
    () =>
      firstTarget?.grants.filter((cap) => pkg.capabilities.includes(cap)) ?? [],
  );
  const submitting = useRef(false);
  const install = useMutation({
    retry: false,
    mutationFn: async (create: boolean) => {
      const release =
        source.kind === "installed"
          ? source.release
          : source.kind === "catalog"
            ? await miniApps.catalogInstall(source.entry)
            : await miniApps.localPackage(source.raw, "install");
      await cache.invalidateQueries({ queryKey: appKeys.releases });
      if (!create) return;
      if (upgradeId && !upgrade)
        throw new Error("The instance changed. Review the installation again.");
      return upgrade
        ? miniApps.upgrade(upgrade, release.id, grants)
        : miniApps.create(release.id, name.trim(), grants);
    },
    onSuccess: async (book) => {
      if (book) {
        await cache.invalidateQueries({ queryKey: appKeys.instances });
        open(book.id);
      } else close();
    },
  });
  function submit(create: boolean) {
    if (submitting.current) return;
    submitting.current = true;
    install.mutate(create, {
      onSettled: () => {
        submitting.current = false;
      },
    });
  }
  return (
    <section className={sectionStyle}>
      <div>
        <h2 className="text-xl font-semibold">{pkg.name}</h2>
        <p className="text-sm text-muted-foreground">
          {pkg.publisher} / {pkg.app} · {pkg.version} ·{" "}
          {source.kind === "installed"
            ? source.release.origin
            : source.kind === "local"
              ? source.origin
              : source.entry.origin}
        </p>
      </div>
      {pkg.description && <p>{pkg.description}</p>}
      <fieldset disabled={install.isPending} className="space-y-4">
        {targetInstance && (
          <p>
            Update {targetInstance.name} from{" "}
            {versions[targetInstance.release_id]} to {pkg.version}.
          </p>
        )}
        {!targetInstance && previous.length > 0 && (
          <label className={labelStyle}>
            Install for
            <select
              className={selectStyle}
              value={upgradeId}
              onChange={(e) => {
                setUpgrade(e.target.value);
                const target = previous.find((i) => i.id === e.target.value);
                setGrants(
                  target
                    ? target.grants.filter((g) => pkg.capabilities.includes(g))
                    : [],
                );
              }}
            >
              {previous.length > 1 && (
                <option value="choose" disabled>
                  Choose an instance to upgrade
                </option>
              )}
              {previous.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} · {versions[i.release_id]} → {pkg.version}
                </option>
              ))}
              <option value="">Create a separate new instance</option>
            </select>
          </label>
        )}
        {upgradeId === "" && (
          <label className={labelStyle}>
            Instance name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              aria-invalid={new TextEncoder().encode(name.trim()).length > 100}
            />
          </label>
        )}
        {upgradeId === "" &&
          new TextEncoder().encode(name.trim()).length > 100 && (
            <p role="alert">Use an instance name of at most 100 UTF-8 bytes.</p>
          )}
        <Grants
          capabilities={pkg.capabilities}
          selected={grants}
          onChange={setGrants}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              install.isPending ||
              upgradeId === "choose" ||
              (!upgrade &&
                (!name.trim() ||
                  new TextEncoder().encode(name.trim()).length > 100))
            }
            onClick={() => submit(true)}
          >
            {upgrade
              ? "Upgrade instance to " + pkg.version
              : source.kind === "installed"
                ? "Create instance"
                : "Install and create instance"}
          </Button>
          {!targetInstance && source.kind !== "installed" && (
            <Button
              variant="outline"
              disabled={install.isPending}
              onClick={() => submit(false)}
            >
              Install package only
            </Button>
          )}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </fieldset>
      <ErrorMessage error={install.error} />
    </section>
  );
}
