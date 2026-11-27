import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MiniAppInstance, MiniAppPackage } from "@cove/api-contract";
import { appKeys, miniApps } from "@/api/mini-apps";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Button } from "@/components/ui/button";
import {
  ErrorMessage,
  Grants,
  canUpgrade,
  labelStyle,
  sectionStyle,
  selectStyle,
} from "./presentation";

export function AppSettings({
  instance,
  pkg,
  removed,
}: {
  instance: MiniAppInstance;
  pkg: MiniAppPackage;
  removed: () => void;
}) {
  const cache = useQueryClient();
  const releases = useQuery({
    queryKey: appKeys.releases,
    queryFn: miniApps.releases,
    retry: false,
  });
  const current = releases.data?.packages.find(
    (p) => p.id === instance.release_id,
  );
  const choices =
    releases.data?.packages.filter(
      (r) =>
        r.id === instance.release_id ||
        (current && canUpgrade(pkg, r.package, current.origin, r.origin)),
    ) ?? [];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useMutation({
    retry: false,
    mutationFn: () => miniApps.remove(instance.id),
    onSuccess: () => {
      removed();
      void cache.invalidateQueries({ queryKey: appKeys.instances });
    },
  });
  const backup = useMutation({
    retry: false,
    mutationFn: async () => {
      const data = await miniApps.export(instance.id);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = pkg.app + ".covedata";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  const [releaseId, setRelease] = useState(instance.release_id);
  const [grants, setGrants] = useState(instance.grants ?? []);
  const [enabled, setEnabled] = useState(instance.enabled);
  const next = choices.find((p) => p.id === releaseId);
  const upgrading = releaseId !== instance.release_id;
  const save = useMutation({
    retry: false,
    mutationFn: async () => {
      if (upgrading) await miniApps.upgrade(instance, releaseId, grants);
      else await miniApps.settings(instance, enabled, grants);
    },
    onSettled: () => cache.invalidateQueries({ queryKey: appKeys.instances }),
  });
  return (
    <section className={sectionStyle}>
      <h2 className="text-lg font-semibold">Instance settings</h2>
      <p className="text-sm text-muted-foreground">
        {pkg.publisher} / {pkg.app} · {pkg.version}
      </p>
      <fieldset disabled={save.isPending} className="space-y-4">
        {choices.length > 1 && (
          <label className={labelStyle}>
            Installed release
            <select
              className={selectStyle}
              value={releaseId}
              onChange={(e) => {
                setRelease(e.target.value);
                const selected = choices.find((p) => p.id === e.target.value)!;
                setGrants(
                  instance.grants.filter((cap) =>
                    selected.package.capabilities.includes(cap),
                  ),
                );
              }}
            >
              {choices.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.package.version}
                </option>
              ))}
            </select>
          </label>
        )}
        {!upgrading && (
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enable this instance
          </label>
        )}
        <Grants
          capabilities={next?.package.capabilities ?? pkg.capabilities}
          selected={grants}
          onChange={setGrants}
        />
        <Button onClick={() => save.mutate()}>
          {upgrading ? "Migrate and activate release" : "Save settings"}
        </Button>
      </fieldset>
      <div className="space-y-2 border-t border-border pt-4">
        <h3 className="font-medium">Instance data</h3>
        <p className="text-sm text-muted-foreground">
          The backup contains a plain-text copy of this instance’s saved
          records.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={backup.isPending}
            onClick={() => backup.mutate()}
          >
            Export data
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
          >
            Delete instance
          </Button>
        </div>
        <ErrorMessage error={backup.error ?? remove.error} />
      </div>
      <ConfirmationDialog
        open={confirmDelete}
        title={"Delete " + instance.name + "?"}
        description="This permanently deletes this instance and its saved records. Other instances keep their data."
        confirmLabel="Delete instance"
        destructive
        busy={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          remove.mutate(undefined, { onError: () => setConfirmDelete(false) })
        }
      />
      <ErrorMessage error={save.error ?? releases.error} />
    </section>
  );
}
