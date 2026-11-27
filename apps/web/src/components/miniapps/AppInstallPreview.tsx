import { useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronDown, ShieldCheck } from "lucide-react";
import type {
  MiniAppInstance,
  MiniAppPackage,
  MiniAppRelease,
} from "@cove/api-contract";
import { appKeys, miniApps, type CatalogEntry } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorMessage, labelStyle, selectStyle } from "./presentation";

export type PackageSource =
  | { kind: "local"; raw: string; origin?: string }
  | { kind: "catalog"; entry: CatalogEntry }
  | { kind: "installed"; release: MiniAppRelease };

type OpenApp = (id: string, view?: string, replace?: boolean) => void;

const permissionCopy: Record<string, { title: string; description: string }> = {
  "records.query": {
    title: "Read saved items",
    description: "View the items saved in this copy of the app.",
  },
  "records.commit": {
    title: "Save changes",
    description: "Add, edit or remove items after you review the changes.",
  },
  "ai.generate": {
    title: "Use AI tools",
    description: "Run tasks with a model you choose in Cove.",
  },
  "models.list": {
    title: "Choose a model",
    description: "See the models you have configured in Cove.",
  },
  "chat.attach": {
    title: "Add items to a chat",
    description: "Place items you select in a chat draft for review.",
  },
  "mac.files.pick": {
    title: "Choose files",
    description: "Import a file through the Mac file picker when you ask.",
  },
  "blobs.import": {
    title: "Keep attachments",
    description: "Store files with this app on your Mac.",
  },
  "mac.selection.receive": {
    title: "Receive selected Mac text",
    description: "Use text you send through the macOS Services menu.",
  },
  "documents.search": {
    title: "Search selected documents",
    description: "Search documents you explicitly choose in Cove.",
  },
  "speech.speak": {
    title: "Read text aloud",
    description: "Use local speech to read text you select.",
  },
};

function AccessChoice({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const identity = useId();
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-muted/60 has-checked:bg-primary/5">
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-primary"
        checked={checked}
        aria-labelledby={identity + "-title"}
        aria-describedby={identity + "-description"}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0 space-y-1">
        <span id={identity + "-title"} className="block text-sm font-medium">
          {title}
        </span>
        <span
          id={identity + "-description"}
          className="block text-xs leading-relaxed text-muted-foreground"
        >
          {description}
        </span>
      </span>
    </label>
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
  source: PackageSource;
  close: () => void;
  open: OpenApp;
  targetInstance?: MiniAppInstance;
  versions?: Record<string, string>;
}) {
  const cache = useQueryClient();
  const formId = useId();
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
  const upgrade =
    targetInstance ?? previous.find((item) => item.id === upgradeId);
  const [grants, setGrants] = useState<string[]>(
    () =>
      firstTarget?.grants.filter((cap) => pkg.capabilities.includes(cap)) ?? [],
  );
  const [cloudEnabled, setCloudEnabled] = useState(
    firstTarget?.cloud_enabled === true,
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
        throw new Error("This copy changed. Review the installation again.");
      return upgrade
        ? miniApps.upgrade(upgrade, release.id, grants, cloudEnabled)
        : miniApps.create(release.id, name.trim(), grants, cloudEnabled);
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
  const core: string[] = pkg.capabilities.filter(
    (capability) =>
      capability === "records.query" || capability === "records.commit",
  );
  const optional = pkg.capabilities.filter(
    (capability) => !core.includes(capability),
  );
  const optionalAllowed =
    optional.filter((capability) => grants.includes(capability)).length +
    Number(cloudEnabled);
  const nameTooLong = new TextEncoder().encode(name.trim()).length > 100;
  const origin =
    source.kind === "installed"
      ? source.release.origin
      : source.kind === "local"
        ? (source.origin ?? "local")
        : source.entry.origin;
  const sourceLabel =
    source.kind === "installed"
      ? "Installed on this Mac"
      : origin === "builtin"
        ? "Included with Cove"
        : origin === "catalog"
          ? "Verified catalog"
          : "From a local file";
  const permission = (capability: string) => {
    const copy = permissionCopy[capability] ?? {
      title: capability.replaceAll(/[._-]/g, " "),
      description: "Allow this app to use this feature when you request it.",
    };
    return (
      <AccessChoice
        key={capability}
        {...copy}
        checked={grants.includes(capability)}
        onChange={(checked) =>
          setGrants((current) =>
            checked
              ? [...current, capability]
              : current.filter((item) => item !== capability),
          )
        }
      />
    );
  };

  return (
    <section className="mx-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-card">
      <header className="border-b border-border/70 px-5 py-6 sm:px-8 sm:py-7">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {upgrade ? "Update your app" : "Add to your apps"}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">{pkg.name}</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          By {pkg.publisher} <span aria-hidden="true">·</span> Version{" "}
          {pkg.version}
          <span className="mx-2" aria-hidden="true">
            ·
          </span>
          {sourceLabel}
        </p>
        {pkg.description && (
          <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {pkg.description}
          </p>
        )}
      </header>

      <fieldset disabled={install.isPending} className="min-w-0">
        <div className="space-y-6 px-5 py-6 sm:px-8">
          {targetInstance && (
            <div className="rounded-2xl bg-primary/5 p-4 text-sm">
              <p className="font-medium">Update {targetInstance.name}</p>
              <p className="mt-1 text-muted-foreground">
                {versions[targetInstance.release_id]}{" "}
                <ArrowRight className="mx-1 inline size-3" aria-label="to" />{" "}
                {pkg.version}. Your saved items and attachments are kept.
              </p>
            </div>
          )}
          {!targetInstance && previous.length > 0 && (
            <label className={labelStyle}>
              Update an existing copy
              <select
                className={selectStyle}
                aria-label="Update an existing copy"
                aria-describedby={formId + "-update-hint"}
                value={upgradeId}
                onChange={(event) => {
                  const target = previous.find(
                    (item) => item.id === event.target.value,
                  );
                  setUpgrade(event.target.value);
                  setCloudEnabled(target?.cloud_enabled === true);
                  setGrants(
                    target
                      ? target.grants.filter((capability) =>
                          pkg.capabilities.includes(capability),
                        )
                      : [],
                  );
                }}
              >
                {previous.length > 1 && (
                  <option value="choose" disabled>
                    Choose a copy to update
                  </option>
                )}
                {previous.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {versions[item.release_id]} → {pkg.version}
                  </option>
                ))}
                <option value="">Create a separate copy</option>
              </select>
              <span
                id={formId + "-update-hint"}
                className="font-normal leading-relaxed text-muted-foreground"
              >
                Updates keep your saved items. A separate copy starts with its
                own data.
              </span>
            </label>
          )}
          {upgradeId === "" && (
            <label className={labelStyle}>
              App name
              <Input
                aria-label="App name"
                aria-describedby={formId + "-name-hint"}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                aria-invalid={nameTooLong}
              />
              <span
                id={formId + "-name-hint"}
                className="font-normal text-muted-foreground"
              >
                A name to help you recognize this copy in My apps.
              </span>
            </label>
          )}
          {upgradeId === "" && nameTooLong && (
            <p role="alert" className="text-sm text-destructive">
              This name is too long. Try a shorter name.
            </p>
          )}

          <section aria-label="Choose app access" className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Choose access</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {upgrade
                  ? "Your current choices are kept. Additional access stays off until you allow it."
                  : "Access starts off. Choose what this app can do; you can change this later in settings."}
              </p>
            </div>
            {core.length > 0 && (
              <div className="rounded-2xl border border-border/80 p-1">
                {core.map(permission)}
              </div>
            )}
            <details className="group rounded-2xl border border-border/80">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                More access
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {optionalAllowed ? `${optionalAllowed} allowed` : "Optional"}
                </span>
                <ChevronDown
                  className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="space-y-1 border-t border-border/70 p-1">
                {optional.map(permission)}
                <div
                  className={
                    optional.length ? "border-t border-border/70 pt-1" : ""
                  }
                >
                  <AccessChoice
                    title="Allow cloud models"
                    description="Allow app input to be sent to a cloud model. You still choose the model for each task."
                    checked={cloudEnabled}
                    onChange={setCloudEnabled}
                  />
                </div>
              </div>
            </details>
          </section>

          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            Your app data is stored on this Mac. Model requests use the
            destination you choose.
          </p>

          <details className="group text-sm">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
              Advanced
              <ChevronDown
                className="size-3 transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-3 space-y-3 rounded-2xl bg-muted/50 p-4">
              <p className="break-all text-xs text-muted-foreground">
                {pkg.publisher} / {pkg.app} · {pkg.version}
              </p>
              {!targetInstance && source.kind !== "installed" && (
                <div className="space-y-2">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Keep the app package for later without creating a copy or
                    granting access.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => submit(false)}
                  >
                    Install package only
                  </Button>
                </div>
              )}
            </div>
          </details>
          <ErrorMessage error={install.error} />
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 bg-muted/30 px-5 py-4 sm:px-8">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={
              upgradeId === "choose" ||
              (!upgrade && (!name.trim() || nameTooLong))
            }
            onClick={() => submit(true)}
          >
            {install.isPending
              ? upgrade
                ? "Updating…"
                : "Installing…"
              : upgrade
                ? "Update to " + pkg.version
                : source.kind === "installed"
                  ? "Create copy"
                  : "Install app"}
            {install.isPending ? null : (
              <Check className="size-4" aria-hidden="true" />
            )}
          </Button>
        </footer>
      </fieldset>
    </section>
  );
}
