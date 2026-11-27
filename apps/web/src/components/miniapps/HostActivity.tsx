import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { miniApps, type HostActivity as Activity } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import {
  ErrorMessage,
  labelStyle,
  sectionStyle,
  selectStyle,
} from "./presentation";
import type { MiniAppInstance } from "@cove/api-contract";

export function HostActivity({ instances }: { instances: MiniAppInstance[] }) {
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState("");
  const history = useQuery({
    queryKey: ["mini-app-host-activity", instance],
    queryFn: () => miniApps.hostActivity(instance || undefined),
    enabled: open,
    retry: false,
  });
  return (
    <details
      id="mini-app-activity"
      className={sectionStyle}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">Host activity</summary>
      {open && (
        <>
          <label className={labelStyle}>
            Instance
            <select
              className={selectStyle}
              value={instance}
              onChange={(event) => setInstance(event.target.value)}
            >
              <option value="">All instances</option>
              {instances.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={history.isFetching}
            onClick={() => void history.refetch()}
          >
            Refresh activity
          </Button>
          <ErrorMessage error={history.error} />
          {history.isPending && <p role="status">Loading activity…</p>}
          {history.data?.activity.length === 0 && (
            <p>No saved changes or model tasks yet.</p>
          )}
          <ol className="space-y-3">
            {history.data?.activity.map((item: Activity) => (
              <li
                key={item.instance_id + item.operation_id}
                className="border-t border-border pt-3 text-sm"
              >
                <strong>{item.instance_name}</strong> · {item.action} ·{" "}
                {item.status}
                <br />
                <span className="text-muted-foreground">
                  {item.surface} · {new Date(item.time * 1000).toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </details>
  );
}
