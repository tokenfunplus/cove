import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appKeys, miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Input } from "@/components/ui/input";
import { ErrorMessage, labelStyle, sectionStyle } from "./presentation";

export function CatalogSettings({ expanded = false }: { expanded?: boolean }) {
  const [open, setOpen] = useState(false);
  const [didSave, setDidSave] = useState(false);
  const saved = useQuery({
    queryKey: ["mini-app-catalog-settings"],
    queryFn: miniApps.catalogSettings,
    enabled: open || expanded,
  });
  const Container = expanded ? "section" : "details";
  return (
    <Container
      className={sectionStyle}
      onToggle={(event) => {
        if (event.currentTarget instanceof HTMLDetailsElement)
          setOpen(event.currentTarget.open);
      }}
    >
      {expanded ? (
        <h3 className="font-semibold">App catalog source</h3>
      ) : (
        <summary className="cursor-pointer font-semibold">
          Catalog settings
        </summary>
      )}
      {(open || expanded) && saved.data && (
        <CatalogForm
          key={saved.data.url + saved.data.public_key + saved.data.mode}
          url={saved.data.url}
          publicKey={saved.data.public_key}
          defaults={saved.data.defaults}
          mode={saved.data.mode}
          onSaved={() => setDidSave(true)}
          onEdit={() => setDidSave(false)}
        />
      )}
      {didSave && (
        <p role="status" className="text-sm text-primary">
          Catalog settings saved.
        </p>
      )}
      <ErrorMessage error={saved.error} />
    </Container>
  );
}
type CatalogConfig = { url: string; public_key: string; useDefaults?: boolean };

function CatalogForm({
  url,
  publicKey,
  defaults,
  mode,
  onSaved,
  onEdit,
}: {
  url: string;
  publicKey: string;
  defaults?: CatalogConfig;
  mode?: string;
  onSaved: () => void;
  onEdit: () => void;
}) {
  const [index, setIndex] = useState(url);
  const [key, setKey] = useState(publicKey);
  const [confirmation, setConfirmation] = useState<CatalogConfig>();
  const unchanged = index.trim() === url && key.trim() === publicKey;
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: ({
      config,
      confirmed,
      useDefaults,
    }: {
      config: CatalogConfig;
      confirmed: boolean;
      useDefaults?: boolean;
    }) =>
      useDefaults
        ? miniApps.useCatalogDefaults(
            confirmed ? { url, public_key: publicKey } : undefined,
          )
        : miniApps.saveCatalogSettings(
            config.url,
            config.public_key,
            confirmed ? { url, public_key: publicKey } : undefined,
          ),
    onSuccess: async () => {
      setConfirmation(undefined);
      onSaved();
      await Promise.all([
        cache.invalidateQueries({ queryKey: appKeys.catalog }),
        cache.invalidateQueries({ queryKey: ["mini-app-catalog-settings"] }),
      ]);
    },
  });
  const authority = confirmation?.public_key
    ? "The new signing key is " +
      confirmation.public_key +
      ". This authority can supply releases and updates for catalog apps on this Mac. Official bundled app identities require Cove's release key."
    : "Cove will use bundled releases only. You can choose another signed directory later.";
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (unchanged) return;
        const config = { url: index.trim(), public_key: key.trim() };
        save.reset();
        if (config.public_key !== publicKey) setConfirmation(config);
        else save.mutate({ config, confirmed: false });
      }}
    >
      <p className="text-sm">
        Choose the signing authority for app releases and updates on this Mac.
        Changing its key requires confirmation. Leave both fields empty to use
        bundled releases only.
      </p>
      {mode && (
        <p className="text-sm text-muted-foreground">
          Current source:{" "}
          {mode === "default"
            ? "Cove defaults"
            : mode === "bundled"
              ? "Bundled apps only"
              : "Custom directory"}
          .
        </p>
      )}
      <fieldset
        className="space-y-2"
        disabled={save.isPending || !!confirmation}
      >
        <label className={labelStyle}>
          HTTPS catalog URL
          <Input
            type="url"
            value={index}
            onChange={(event) => {
              onEdit();
              setIndex(event.target.value);
            }}
          />
        </label>
        <label className={labelStyle}>
          Ed25519 public key
          <Input
            value={key}
            onChange={(event) => {
              onEdit();
              setKey(event.target.value);
            }}
          />
        </label>
        <Button
          type="submit"
          disabled={unchanged || !!index.trim() !== !!key.trim()}
        >
          Save catalog settings
        </Button>
        {defaults && (
          <Button
            type="button"
            variant="outline"
            disabled={mode === "default" && unchanged}
            onClick={() => {
              onEdit();
              save.reset();
              const config = { ...defaults, useDefaults: true };
              if (config.public_key !== publicKey) setConfirmation(config);
              else save.mutate({ config, confirmed: false, useDefaults: true });
            }}
          >
            Use Cove defaults
          </Button>
        )}
      </fieldset>
      <ErrorMessage error={save.error} />
      <ConfirmationDialog
        open={!!confirmation}
        title={
          confirmation?.public_key
            ? "Trust this catalog signing authority?"
            : "Use bundled releases only?"
        }
        description={
          (save.error instanceof Error ? save.error.message + " " : "") +
          (confirmation?.useDefaults
            ? "Follow the catalog configured by your installed Cove version. "
            : "") +
          authority
        }
        confirmLabel={
          confirmation?.public_key
            ? "Confirm signing authority"
            : "Confirm bundled releases"
        }
        cancelLabel="Keep current authority"
        busy={save.isPending}
        onCancel={() => setConfirmation(undefined)}
        onConfirm={() => {
          if (confirmation)
            save.mutate({
              config: confirmation,
              confirmed: true,
              useDefaults: confirmation.useDefaults,
            });
        }}
      />
    </form>
  );
}
