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
import { AppTaskSaveNotice } from "./AppTaskSaveNotice";

export function HostActivity({
  instances,
  expanded = false,
}: {
  instances: MiniAppInstance[];
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState("");
  const history = useQuery({
    queryKey: ["mini-app-host-activity", instance],
    queryFn: () => miniApps.hostActivity(instance || undefined),
    enabled: open || expanded,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.activity.some((item) => item.status === "running")
        ? 1000
        : false,
  });
  const Container = expanded ? "section" : "details";
  return (
    <Container
      id="mini-app-activity"
      className={sectionStyle}
      onToggle={(event) => {
        if (event.currentTarget instanceof HTMLDetailsElement)
          setOpen(event.currentTarget.open);
      }}
    >
      {expanded ? (
        <h3 className="font-semibold">Recent activity</h3>
      ) : (
        <summary className="cursor-pointer font-semibold">
          Host activity
        </summary>
      )}
      {(open || expanded) && (
        <>
          <label className={labelStyle}>
            App
            <select
              className={selectStyle}
              value={instance}
              onChange={(event) => setInstance(event.target.value)}
            >
              <option value="">All apps</option>
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
                {item.status === "save_failed"
                  ? "Result needs saving"
                  : item.status}
                <br />
                <span className="text-muted-foreground">
                  {item.surface} · {new Date(item.time * 1000).toLocaleString()}
                </span>
                {item.status === "save_failed" && (
                  <div className="mt-3">
                    <AppTaskSaveNotice
                      instance={item.instance_id}
                      task={item.operation_id}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </Container>
  );
}
