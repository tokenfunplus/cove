import { Badge } from "@/components/ui/badge";
import { ModelBrandIcon } from "@/components/providers/ModelBrandIcon";
import { privacyModeLabel } from "@/components/providers/model-selection";
import { modelCatalogCopy as labels } from "@/messages/model-catalog";
import { modelsStyles } from "@/styles/models";
import { cn } from "@/lib/utils";
import type { ApplicationCopy } from "@/messages";
import type { ProviderModelMetadata } from "@cove/api-contract";

export function modelSearchText(
  modelId: string,
  metadata?: ProviderModelMetadata,
): string {
  return [
    modelId,
    metadata?.name,
    metadata?.owner,
    ...(metadata?.capabilities ?? []),
    ...(metadata?.capabilities ?? []).map((capability) => labels[capability]),
  ]
    .filter(Boolean)
    .join(" ");
}

function price(value?: number) {
  return value === undefined
    ? "—"
    : `$${value.toLocaleString("en-US", { maximumFractionDigits: 8 })}`;
}

export function ModelOptionLabel({
  modelId,
  metadata,
  copy,
  showPrivacyMode = false,
  compact = false,
}: {
  modelId: string;
  metadata?: ProviderModelMetadata;
  copy: ApplicationCopy;
  showPrivacyMode?: boolean;
  compact?: boolean;
}) {
  const mode = showPrivacyMode ? metadata?.privacy_mode : undefined;
  const name = metadata?.name || modelId;
  const hasPrice =
    metadata?.input_price_per_million !== undefined ||
    metadata?.output_price_per_million !== undefined;
  const hasDetails =
    hasPrice ||
    metadata?.context_length ||
    metadata?.max_output_tokens ||
    metadata?.capabilities?.length;
  const privacyBadge = mode ? (
    <Badge
      className={cn(
        modelsStyles.modelOption_badge,
        `model-option__badge model-option__badge--${mode}`,
      )}
      data-privacy-mode={mode}
    >
      {privacyModeLabel(mode, copy)}
    </Badge>
  ) : null;
  if (compact)
    return (
      <span className={modelsStyles.modelOption} title={modelId}>
        <ModelBrandIcon
          modelId={modelId}
          owner={metadata?.owner}
          className="size-4"
        />
        <span className={modelsStyles.modelOption_id}>{name}</span>
        {privacyBadge}
      </span>
    );
  return (
    <span className={modelsStyles.modelCatalogRow} data-model-id={modelId}>
      <ModelBrandIcon
        modelId={modelId}
        owner={metadata?.owner}
        className="mt-1 size-6"
      />
      <span className={modelsStyles.modelCatalogContent}>
        <span className={modelsStyles.modelCatalogHeading}>
          <strong title={modelId}>{name}</strong>
          {privacyBadge}
        </span>
        {name !== modelId && (
          <span className={modelsStyles.modelCatalogId}>{modelId}</span>
        )}
        <span className={modelsStyles.modelCatalogStats}>
          {hasPrice && (
            <span>
              {labels.input} {price(metadata?.input_price_per_million)} /{" "}
              {labels.output} {price(metadata?.output_price_per_million)}{" "}
              {labels.perMillion}
            </span>
          )}
          {metadata?.context_length !== undefined && (
            <span>
              {metadata.context_length.toLocaleString("en-US")} {labels.context}
            </span>
          )}
          {metadata?.max_output_tokens !== undefined && (
            <span>
              {metadata.max_output_tokens.toLocaleString("en-US")}{" "}
              {labels.maxOutput}
            </span>
          )}
          {!hasDetails && <span>{labels.detailsUnavailable}</span>}
        </span>
        {!!metadata?.capabilities?.length && (
          <span className={modelsStyles.modelCatalogCapabilities}>
            {metadata.capabilities.map((capability) => (
              <span key={capability} title={labels.capabilityNotice}>
                {labels[capability]}
              </span>
            ))}
          </span>
        )}
        {metadata?.description && (
          <span
            className="line-clamp-2 text-[10px] leading-relaxed text-muted-foreground"
            title={metadata.description}
          >
            {metadata.description}
          </span>
        )}
      </span>
    </span>
  );
}
