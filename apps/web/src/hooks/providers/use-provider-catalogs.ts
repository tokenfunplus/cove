import { providerCatalogQueryOptions } from "@/api/hooks/useProviders";
import {
  providerSelectionStatus,
  type ActiveModelSet,
  type ModelCatalogs,
  type ModelCatalogState,
  type ProviderSelectionStatus,
} from "@/components/providers/model-selection";
import type { ProviderProfile } from "@cove/api-contract";
import { useQueries } from "@tanstack/react-query";

const emptyCatalog: ModelCatalogState = {
  status: "idle",
  models: [],
  metadata: {},
};

export function useProviderCatalogs(
  profiles: ProviderProfile[],
  targets: ActiveModelSet,
) {
  const configured = profiles.filter((profile) => profile.configured);
  const queries = useQueries({
    queries: configured.map((profile) =>
      providerCatalogQueryOptions(profile.id),
    ),
  });
  const catalogs: ModelCatalogs = {};
  for (const [index, profile] of configured.entries()) {
    const query = queries[index]!;
    catalogs[profile.id] = query.isPending
      ? { status: "loading", models: [], metadata: {} }
      : query.isError
        ? { status: "error", models: [], metadata: {} }
        : {
            status: "ready",
            models: query.data.models,
            metadata: Object.fromEntries(
              (query.data.model_metadata ?? []).map((model) => [
                model.id,
                model,
              ]),
            ),
          };
  }
  const activeSelection = targets[0] ?? { providerId: "", modelId: "" };
  const selectionStatus: ProviderSelectionStatus =
    targets.length === 0
      ? "unconfigured"
      : (targets
          .map((target) =>
            providerSelectionStatus(
              profiles.find((profile) => profile.id === target.providerId),
              catalogs[target.providerId] ?? emptyCatalog,
              target.modelId,
            ),
          )
          .find((status) => status !== "ready") ?? "ready");
  return {
    catalogs,
    activeSelection,
    catalog: catalogs[activeSelection.providerId] ?? emptyCatalog,
    selectionStatus,
  };
}
