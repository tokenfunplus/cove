import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { miniApps, appKeys, type CatalogEntry } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileInput } from "@/components/ui/file-input";
import { ErrorMessage, labelStyle, sectionStyle } from "./presentation";
import { PublicAppPreview } from "./AppPackagePreview";

export function PackageEditor({
  examples,
  preview,
  source,
  onChange: setSource,
  expanded = false,
}: {
  examples: CatalogEntry[];
  preview: (source: string) => Promise<void>;
  source: string;
  onChange: (source: string) => void;
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const catalog = useQuery({
    queryKey: appKeys.catalog,
    queryFn: miniApps.catalog,
    enabled: open || expanded,
    retry: false,
  });
  const builtin = new Map<string, CatalogEntry>();
  for (const item of [...(catalog.data?.packages ?? examples)].sort((a, b) =>
    b.version.localeCompare(a.version, "en", { numeric: true }),
  )) {
    if (
      item.origin === "builtin" &&
      !builtin.has(item.publisher + "/" + item.app)
    )
      builtin.set(item.publisher + "/" + item.app, item);
  }
  const file = useRef<HTMLInputElement>(null);
  const load = useMutation({
    mutationFn: async (item: CatalogEntry | File) => {
      if (item instanceof File) {
        if (item.size > 1024 * 1024)
          throw new Error("Choose a package of at most 1 MiB.");
        return item.text();
      }
      return miniApps.catalogSource(item);
    },
    onSuccess: setSource,
  });
  const inspect = useMutation({
    mutationFn: async () => {
      if (new TextEncoder().encode(source).length > 1024 * 1024)
        throw new Error("Use a package of at most 1 MiB.");
      await preview(source);
    },
  });
  const validation = useMutation({
    mutationFn: async (draft: string) => {
      if (new TextEncoder().encode(draft).length > 1024 * 1024)
        throw new Error("Use a package of at most 1 MiB.");
      return { source: draft, package: await miniApps.validateDraft(draft) };
    },
  });
  const validDraft =
    validation.data?.source === source ? validation.data.package : undefined;
  function download() {
    const blob = new Blob([source], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "app.coveapp";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  const Container = expanded ? "section" : "details";
  return (
    <Container
      id="mini-app-agent"
      className={sectionStyle}
      onToggle={(event) => {
        if (event.currentTarget instanceof HTMLDetailsElement)
          setOpen(event.currentTarget.open);
      }}
    >
      {expanded ? (
        <h3 className="font-semibold">Agent packages</h3>
      ) : (
        <summary className="cursor-pointer font-semibold">
          Agent packages
        </summary>
      )}
      <p className="text-sm">
        Edit a package from your agent, validate it and review its installation.
        Use your own publisher when changing an example. The author CLI supplies
        browser preview and upgrade tests.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={load.isPending}
          onClick={() => file.current?.click()}
        >
          Choose package file
        </Button>
        <FileInput
          ref={file}
          accept=".coveapp,.json"
          aria-label="Choose package source"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (chosen) load.mutate(chosen);
          }}
        />
        {[...builtin.values()].map((item) => (
          <Button
            size="sm"
            variant="outline"
            disabled={load.isPending}
            key={item.publisher + item.app + item.version}
            onClick={() => load.mutate(item)}
          >
            Load {item.name} example
          </Button>
        ))}
      </div>
      <label className={labelStyle}>
        App package JSON
        <Textarea
          disabled={load.isPending}
          spellCheck={false}
          rows={14}
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            inspect.reset();
            validation.reset();
          }}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!source.trim() || validation.isPending}
          onClick={() => validation.mutate(source)}
        >
          {validation.isPending ? "Validating draft…" : "Validate draft"}
        </Button>
        <Button
          size="sm"
          disabled={!source.trim() || inspect.isPending}
          onClick={() => inspect.mutate()}
        >
          Validate and preview package
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!source.trim()}
          onClick={download}
        >
          Download package
        </Button>
      </div>
      {validDraft && (
        <section
          aria-label="Unpublished draft preview"
          className="space-y-3 rounded-xl border border-border bg-muted/30 p-4"
        >
          <div>
            <p role="status" className="text-sm font-semibold">
              Draft is valid
            </p>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">
              Unpublished draft · This checks the app contract and shows example
              content. Installation still verifies the package source and
              permissions.
            </p>
          </div>
          <div className="max-w-lg overflow-hidden rounded-xl">
            <PublicAppPreview pkg={validDraft} name={validDraft.name} />
          </div>
        </section>
      )}
      <ErrorMessage
        error={
          load.error ??
          inspect.error ??
          (validation.variables === source ? validation.error : undefined) ??
          catalog.error
        }
      />
    </Container>
  );
}
