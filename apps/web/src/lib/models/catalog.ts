import type { ProviderModelMetadata } from "@cove/api-contract";
import {
  sameModel,
  type ModelPreferences,
} from "@/hooks/providers/use-model-preferences";
export type CatalogFilter = {
  view: "all" | "favorites" | "recent";
  capability: string;
  minimumContext: number;
  maximumPrice: string;
};
export const defaultCatalogFilter: CatalogFilter = {
  view: "all",
  capability: "",
  minimumContext: 0,
  maximumPrice: "",
};
export function browseModels(
  models: string[],
  metadata: Record<string, ProviderModelMetadata> | undefined,
  providerId: string,
  preferences: ModelPreferences,
  filter: CatalogFilter,
) {
  const isFavorite = (modelId: string) =>
    preferences.favorites.some((item) =>
      sameModel(item, { providerId, modelId }),
    );
  const recentIndex = (modelId: string) =>
    preferences.recent.findIndex((item) =>
      sameModel(item, { providerId, modelId }),
    );
  return models
    .filter((id) => {
      const details = metadata?.[id];
      if (
        (filter.view === "favorites" && !isFavorite(id)) ||
        (filter.view === "recent" && recentIndex(id) < 0)
      )
        return false;
      if (
        filter.capability &&
        !details?.capabilities?.some(
          (capability) => capability === filter.capability,
        )
      )
        return false;
      if (
        filter.minimumContext &&
        (details?.context_length ?? 0) < filter.minimumContext
      )
        return false;
      if (filter.maximumPrice.trim()) {
        const ceiling = Number(filter.maximumPrice);
        if (
          !Number.isFinite(ceiling) ||
          ceiling < 0 ||
          details?.input_price_per_million === undefined ||
          details.output_price_per_million === undefined ||
          Math.max(
            details.input_price_per_million,
            details.output_price_per_million,
          ) > ceiling
        )
          return false;
      }
      return true;
    })
    .sort((a, b) => {
      const group = (id: string) =>
        isFavorite(id) ? 0 : recentIndex(id) >= 0 ? 1 : 2;
      return (
        group(a) - group(b) ||
        (group(a) === 1 ? recentIndex(a) - recentIndex(b) : 0)
      );
    })
    .map((id) => ({
      id,
      favorite: isFavorite(id),
      group: isFavorite(id)
        ? "Favorites"
        : recentIndex(id) >= 0
          ? "Recently selected"
          : "All models",
    }));
}
