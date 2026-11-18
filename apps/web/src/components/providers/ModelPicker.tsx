import { useState, type ComponentProps } from "react";
import { SlidersHorizontal, Star } from "lucide-react";
import { FrontSelect } from "@/components/ui/front-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ModelOptionLabel, modelSearchText } from "./ModelOptionLabel";
import { modelsStyles } from "@/styles/models";
import { modelCatalogCopy } from "@/messages/model-catalog";
import {
  useModelPreferences,
  sameModel,
} from "@/hooks/providers/use-model-preferences";
import { browseModels, defaultCatalogFilter } from "@/lib/models/catalog";
import type { ApplicationCopy } from "@/messages";
import type { ProviderModelMetadata } from "@cove/api-contract";

type Props = Omit<
  ComponentProps<typeof FrontSelect>,
  "options" | "searchable" | "notice"
> & {
  providerId: string;
  models: string[];
  metadata?: Record<string, ProviderModelMetadata>;
  copy: ApplicationCopy;
  showPrivacyMode?: boolean;
  unavailableModels?: string[];
};
export function ModelPicker({
  providerId,
  models,
  metadata,
  copy,
  showPrivacyMode,
  unavailableModels = [],
  onValueChange,
  ...props
}: Props) {
  const { preferences, toggleFavorite, remember } = useModelPreferences();
  const [filter, setFilter] = useState(defaultCatalogFilter);
  const selected = { providerId, modelId: props.value };
  const favorite = preferences.favorites.some((item) =>
    sameModel(item, selected),
  );
  const filtered = browseModels(
    models,
    metadata,
    providerId,
    preferences,
    filter,
  );
  const modified =
    filter.view !== "all" ||
    !!filter.capability ||
    !!filter.minimumContext ||
    !!filter.maximumPrice;
  const selectedOption =
    models.includes(props.value) &&
    !filtered.some((item) => item.id === props.value)
      ? [
          {
            id: props.value,
            favorite,
            group: "Current selection",
            hidden: true,
          },
        ]
      : [];
  return (
    <div className="relative min-w-0" data-model-picker>
      <FrontSelect
        {...props}
        onValueChange={(id) => {
          remember({ providerId, modelId: id });
          onValueChange(id);
        }}
        searchable
        panelClassName={modelsStyles.modelCatalogPanel}
        notice={modelCatalogCopy.catalogNotice}
        searchPlaceholder={copy.searchModels}
        emptyText={copy.noMatchingModels}
        options={[...filtered, ...selectedOption].map((item) => ({
          value: item.id,
          group: item.group,
          hidden: "hidden" in item,
          keywords: modelSearchText(item.id, metadata?.[item.id]),
          displayLabel: metadata?.[item.id]?.name,
          selectedLabel: (
            <ModelOptionLabel
              compact
              modelId={item.id}
              metadata={metadata?.[item.id]}
              copy={copy}
              showPrivacyMode={showPrivacyMode}
            />
          ),
          label: (
            <span className="flex items-start gap-2">
              <ModelOptionLabel
                modelId={item.id}
                metadata={metadata?.[item.id]}
                copy={copy}
                showPrivacyMode={showPrivacyMode}
              />
              {item.favorite && (
                <Star
                  aria-label="Favorite"
                  className="mt-2 size-3 shrink-0 fill-primary text-primary"
                />
              )}
            </span>
          ),
          disabled: unavailableModels.includes(item.id),
        }))}
      />
      {props.label && (
        <div className="absolute right-0 -top-1 flex items-center gap-1">
          <Button
            variant="ghost"
            type="button"
            className="size-6 p-0"
            disabled={props.disabled || !props.value}
            aria-label={
              favorite
                ? "Remove model from favorites"
                : "Add model to favorites"
            }
            aria-pressed={favorite}
            title={
              favorite
                ? "Remove model from favorites"
                : "Add model to favorites"
            }
            onClick={() => toggleFavorite(selected)}
          >
            <Star
              className={`size-3 ${favorite ? "fill-primary text-primary" : ""}`}
              aria-hidden="true"
            />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                type="button"
                className={`size-6 p-0 ${modified ? "text-primary" : ""}`}
                aria-label="Filter models"
                disabled={props.disabled}
              >
                <SlidersHorizontal className="size-3" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              aria-label="Model filters"
              className="grid gap-3 text-xs"
            >
              <div className="flex gap-1">
                {(["all", "favorites", "recent"] as const).map((view) => (
                  <Button
                    key={view}
                    variant="ghost"
                    size="xs"
                    aria-pressed={filter.view === view}
                    className={filter.view === view ? "bg-accent text-accent-foreground" : undefined}
                    onClick={() =>
                      setFilter((current) => ({ ...current, view }))
                    }
                  >
                    {view === "all"
                      ? "All models"
                      : view === "favorites"
                        ? "Favorites"
                        : "Recent"}
                  </Button>
                ))}
              </div>
              <FrontSelect
                label="Capability"
                value={filter.capability || "any"}
                onValueChange={(value) => setFilter((current) => ({
                  ...current,
                  capability: value === "any" ? "" : value,
                }))}
                className="h-9 rounded-lg bg-background"
                panelClassName="z-[120]"
                optionClassName="py-2 text-xs"
                options={[
                  { value: "any", label: "Any capability" },
                  ...[
                    "image_input", "audio_input", "tools", "json_mode",
                    "structured_outputs", "reasoning",
                  ].map((capability) => ({
                    value: capability,
                    label: modelCatalogCopy[capability as keyof typeof modelCatalogCopy],
                  })),
                ]}
              />
              <FrontSelect
                label="Minimum context"
                value={String(filter.minimumContext)}
                onValueChange={(value) => setFilter((current) => ({
                  ...current,
                  minimumContext: Number(value),
                }))}
                className="h-9 rounded-lg bg-background"
                panelClassName="z-[120]"
                optionClassName="py-2 text-xs"
                options={[0, 32000, 128000, 200000, 1000000].map((count) => ({
                  value: String(count),
                  label: count ? count.toLocaleString("en-US") + " tokens" : "Any context length",
                }))}
              />
              <label className="grid gap-1">
                Maximum input and output price ($ / 1M tokens)
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={filter.maximumPrice}
                  onChange={(event) =>
                    setFilter((current) => ({
                      ...current,
                      maximumPrice: event.target.value,
                    }))
                  }
                />
              </label>
              <p className="text-muted-foreground">
                {filtered.length} matching models. Models with missing details
                are excluded by the corresponding filters.
              </p>
              <Button
                variant="outline"
                size="xs"
                onClick={() => setFilter(defaultCatalogFilter)}
              >
                Clear filters
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
}
