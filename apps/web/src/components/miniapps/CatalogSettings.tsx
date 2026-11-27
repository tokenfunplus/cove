import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appKeys, miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
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
        <CatalogForm url={saved.data.url} publicKey={saved.data.public_key} />
      )}
      <ErrorMessage error={saved.error} />
    </details>
  );
}
function CatalogForm({ url, publicKey }: { url: string; publicKey: string }) {
  const [index, setIndex] = useState(url);
  const [key, setKey] = useState(publicKey);
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: () => miniApps.saveCatalogSettings(index.trim(), key.trim()),
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: appKeys.catalog }),
        cache.invalidateQueries({ queryKey: ["mini-app-catalog-settings"] }),
      ]);
    },
  });
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-sm">
        Choose the signing authority for app releases and updates on this Mac.
        Leave both fields empty to use bundled releases only.
      </p>
      <label className={labelStyle}>
        HTTPS catalog URL
        <Input
          type="url"
          value={index}
          onChange={(e) => setIndex(e.target.value)}
        />
      </label>
      <label className={labelStyle}>
        Ed25519 public key
        <Input value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <Button
        type="submit"
        disabled={save.isPending || !!index.trim() !== !!key.trim()}
      >
        Save catalog settings
      </Button>
      {save.isSuccess && <span role="status">Catalog settings saved.</span>}
      <ErrorMessage error={save.error} />
    </form>
  );
}
