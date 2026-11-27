import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MiniAppSurface } from "@cove/api-contract";
import { miniApps } from "@/api/mini-apps";
import { Button } from "@/components/ui/button";
import { ErrorMessage, Fields } from "./presentation";

export function AppRecordSource({
  instance,
  revision,
  action,
  id,
  label,
  surface,
}: {
  instance: string;
  revision: number;
  action: string;
  id: string;
  label: string;
  surface: MiniAppSurface;
}) {
  const [open, setOpen] = useState(false);
  const result = useQuery({
    queryKey: ["mini-app-records", instance, revision, action, id, surface],
    queryFn: () =>
      miniApps.invoke(instance, {
        action,
        inputs: { id },
        surface,
        operation_id: crypto.randomUUID(),
        expected_instance_revision: revision,
      }),
    enabled: open,
    retry: false,
  });
  return (
    <div className="mt-2">
      <Button
        size="xs"
        variant="link"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Source · {label}
      </Button>
      {open &&
        (result.isPending ? (
          <p>Opening source…</p>
        ) : result.isError ? (
          <ErrorMessage error={result.error} />
        ) : result.data.records?.[0] ? (
          <Fields fields={result.data.records[0].fields} />
        ) : (
          <p>Source record unavailable.</p>
        ))}
    </div>
  );
}
