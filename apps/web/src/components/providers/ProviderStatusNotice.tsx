import { modelsStyles } from "@/styles/models";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type ProviderSelectionStatus } from "@/components/providers/model-selection";
import { type ApplicationCopy } from "@/messages";
import { CircleAlert, CircleDashed, TriangleAlert } from "lucide-react";

export function ProviderStatusNotice({
  onOpenSettings,
  status,
  copy,
}: {
  onOpenSettings?: () => void;
  status: Exclude<ProviderSelectionStatus, "ready" | "catalog-loading">;
  copy: ApplicationCopy;
}) {
  const icon =
    status === "catalog-error" || status === "model-unavailable" ? (
      <CircleAlert aria-hidden="true" size={17} strokeWidth={2} />
    ) : status === "no-models" ? (
      <TriangleAlert aria-hidden="true" size={17} strokeWidth={2} />
    ) : (
      <CircleDashed aria-hidden="true" size={17} strokeWidth={1.8} />
    );
  if (status === "unconfigured") {
    return (
      <div
        className={cn(
          modelsStyles.providerRequired,
          "provider-required--unconfigured",
        )}
        data-provider-status={status}
        role="status"
      >
        <span className={modelsStyles.providerRequired_icon} aria-hidden="true">
          <CircleAlert size={17} strokeWidth={2} />
        </span>
        <p>{copy.providerRequired}</p>
        {onOpenSettings ? (
          <Button variant="outline" onClick={onOpenSettings} type="button">
            {copy.openProviderSettings}
          </Button>
        ) : (
          <a href="#provider-settings">{copy.openProviderSettings}</a>
        )}
      </div>
    );
  }

  const message =
    status === "catalog-error"
      ? copy.modelsUnavailable
      : status === "no-models"
        ? copy.noModels
        : status === "model-required"
          ? copy.selectModel
          : copy.modelUnavailable;
  return (
    <div
      className={cn(
        modelsStyles.providerRequired,
        `provider-required provider-required--${status}`,
      )}
      data-provider-status={status}
      role="status"
    >
      <span className={modelsStyles.providerRequired_icon} aria-hidden="true">
        {icon}
      </span>
      <p>{message}</p>
    </div>
  );
}
