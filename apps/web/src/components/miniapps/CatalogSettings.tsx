import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appKeys, miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Input } from "@/components/ui/input";
import { ErrorMessage, labelStyle, sectionStyle } from "./presentation";

export function CatalogSettings() {
  const [open, setOpen] = useState(false);
  const saved = useQuery({
    queryKey: ["mini-app-catalog-settings"],
    queryFn: miniApps.catalogSettings,
    enabled: open,
  });
  return (
    <details
      className={sectionStyle}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">
        Catalog settings
      </summary>
      {open && saved.data && (
        <CatalogForm
          key={saved.data.url + saved.data.public_key}
          url={saved.data.url}
          publicKey={saved.data.public_key}
        />
      )}
      <ErrorMessage error={saved.error} />
    </details>
  );
}
type CatalogConfig = { url: string; public_key: string };

function CatalogForm({ url, publicKey }: { url: string; publicKey: string }) {
  const [index, setIndex] = useState(url);
  const [key, setKey] = useState(publicKey);
  const [confirmation, setConfirmation] = useState<CatalogConfig>();
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: ({
      config,
      confirmed,
    }: {
      config: CatalogConfig;
      confirmed: boolean;
    }) =>
      miniApps.saveCatalogSettings(
        config.url,
        config.public_key,
        confirmed ? { url, public_key: publicKey } : undefined,
      ),
    onSuccess: async () => {
      setConfirmation(undefined);
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
      <fieldset
        className="space-y-2"
        disabled={save.isPending || !!confirmation}
      >
        <label className={labelStyle}>
          HTTPS catalog URL
          <Input
            type="url"
            value={index}
            onChange={(event) => setIndex(event.target.value)}
          />
        </label>
        <label className={labelStyle}>
          Ed25519 public key
          <Input value={key} onChange={(event) => setKey(event.target.value)} />
        </label>
        <Button type="submit" disabled={!!index.trim() !== !!key.trim()}>
          Save catalog settings
        </Button>
      </fieldset>
      {save.isSuccess && <span role="status">Catalog settings saved.</span>}
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
            save.mutate({ config: confirmation, confirmed: true });
        }}
      />
    </form>
  );
}
