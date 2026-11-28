import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { miniApps } from "@/api/mini-apps";
import { ErrorMessage, sectionStyle } from "./presentation";

/** Version 1 exposes provenance without a custom-directory editor. */
export function CatalogSettings({ expanded = false }: { expanded?: boolean }) {
  const [open, setOpen] = useState(false);
  const saved = useQuery({
    queryKey: ["mini-app-catalog-settings"],
    queryFn: miniApps.catalogSettings,
    enabled: open || expanded,
    retry: false,
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
        <h3 className="font-semibold">Signed release source</h3>
      ) : (
        <summary className="cursor-pointer font-semibold">Release source</summary>
      )}
      {(open || expanded) && (
        <>
          {saved.isPending && <p role="status">Loading release source…</p>}
          {saved.data && (
            <div className="space-y-3 text-sm">
              <p className="font-medium">
                {!saved.data.public_key
                  ? "No signed source configured"
                  : saved.data.mode === "custom"
                    ? "Configured signed source"
                    : "Cove defaults"}
              </p>
              <p className="leading-6 text-muted-foreground">
                {saved.data.public_key
                  ? "Cove verifies releases and checks updates against this signed source. Your app data stays on this Mac."
                  : "Your installed apps remain available offline. This installation has no signed source for checking updates."}
              </p>
              {saved.data.url && <p className="break-all text-muted-foreground">{saved.data.url}</p>}
            </div>
          )}
          <ErrorMessage error={saved.error} />
        </>
      )}
    </Container>
  );
}
