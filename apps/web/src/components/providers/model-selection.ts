import { type SecureInferenceMode } from "@/lib/inference/secure-inference";
import { type ApplicationCopy } from "@/messages";
import {
  type ProviderModelMetadata,
  type ProviderProfile,
  type ProviderSnapshot,
  type WorkspaceSettings,
} from "@cove/api-contract";

export type ActiveSelection = { providerId: string; modelId: string };

export type ActiveModelSet = ActiveSelection[];

export function secureInferenceTargetSelected(
  targets: ActiveModelSet,
  profiles: Pick<ProviderProfile, "id" | "kind" | "configured">[],
  catalogs: ModelCatalogs = {},
): boolean {
  return (
    targets.length > 0 &&
    targets.every((target) =>
      privateTeeTargetSelected(target, profiles, catalogs),
    )
  );
}

function privateTeeTargetSelected(
  target: ActiveSelection,
  profiles: Pick<ProviderProfile, "id" | "kind" | "configured">[],
  catalogs: ModelCatalogs,
): boolean {
  const profile = profiles.find(
    (candidate) => candidate.id === target.providerId,
  );
  const metadata = catalogs[target.providerId]?.metadata?.[target.modelId];
  return (
    profile?.kind === "nearai" &&
    profile.configured === true &&
    metadata?.privacy_mode === "private_tee" &&
    metadata.verifiable === true
  );
}

export function activeModelSetFromWorkspaceSettings(
  settings: WorkspaceSettings,
  profiles: ProviderProfile[],
): ActiveModelSet {
  const selections = settings.active_model_set.map((target) => ({
    providerId: target.provider_id,
    modelId: target.model_id,
  }));
  if (selections.length > 0) return selections;
  const configuredProfiles = profiles.filter(
    (profile) => profile.configured && profile.model_id,
  );
  return configuredProfiles.length === 1
    ? [
        {
          providerId: configuredProfiles[0].id,
          modelId: configuredProfiles[0].model_id,
        },
      ]
    : [];
}

export type ModelCatalogState = {
  status: "idle" | "loading" | "ready" | "error";
  models: string[];
  metadata?: Record<string, ProviderModelMetadata>;
};

export type ModelCatalogs = Record<string, ModelCatalogState>;

export type ProviderSelectionStatus =
  | "ready"
  | "unconfigured"
  | "catalog-loading"
  | "catalog-error"
  | "no-models"
  | "model-required"
  | "model-unavailable";

export function modelMetadataForTarget(
  catalogs: ModelCatalogs,
  target: ActiveSelection,
): ProviderModelMetadata | undefined {
  return catalogs[target.providerId]?.metadata?.[target.modelId];
}

export function secureTargetForCatalog(
  target: ActiveSelection,
  profiles: Pick<ProviderProfile, "id" | "kind" | "configured">[],
  catalogs: ModelCatalogs,
): boolean {
  const profile = profiles.find(
    (candidate) => candidate.id === target.providerId,
  );
  const metadata = modelMetadataForTarget(catalogs, target);
  if (profile?.kind !== "nearai" || profile.configured !== true) return false;
  return (
    metadata?.privacy_mode === "private_tee" ||
    metadata?.privacy_mode === "incognito" ||
    metadata?.privacy_mode === "chutes"
  );
}

export function inferenceModeForMetadata(
  metadata?: ProviderModelMetadata,
): SecureInferenceMode | undefined {
  if (
    metadata?.privacy_mode === "private_tee" ||
    metadata?.privacy_mode === "incognito" ||
    metadata?.privacy_mode === "chutes"
  ) {
    return metadata.privacy_mode;
  }
  return undefined;
}

export function isNearAISnapshot(
  snapshot: Pick<ProviderSnapshot, "provider_id" | "provider_kind"> &
    Partial<Pick<ProviderSnapshot, "runtime_location">>,
): boolean {
  if (snapshot.provider_kind) return snapshot.provider_kind === "nearai";
  return (
    snapshot.runtime_location === "NearAI cloud" ||
    (snapshot.provider_id === "nearai" && !snapshot.runtime_location)
  );
}

export function inferenceModeForSnapshot(
  snapshot?: Parameters<typeof isNearAISnapshot>[0] &
    Pick<ProviderSnapshot, "privacy_mode">,
): SecureInferenceMode | undefined {
  if (!snapshot || !isNearAISnapshot(snapshot)) return undefined;
  if (
    snapshot.privacy_mode === "private_tee" ||
    snapshot.privacy_mode === "incognito" ||
    snapshot.privacy_mode === "chutes"
  ) {
    return snapshot.privacy_mode;
  }
  return undefined;
}

export function privacyModeLabel(
  mode: SecureInferenceMode | undefined,
  copy: ApplicationCopy,
): string {
  if (mode === "incognito") return copy.privacyModeIncognito;
  if (mode === "chutes") return copy.privacyModeChutes;
  return copy.privacyModePrivateTee;
}

export function isDuplicateModelTarget(
  targets: ActiveModelSet,
  next: ActiveSelection,
  exceptIndex?: number,
): boolean {
  return targets.some(
    (target, index) =>
      index !== exceptIndex &&
      target.providerId === next.providerId &&
      target.modelId === next.modelId,
  );
}

export function availableModelsForAddedTarget(
  profile: ProviderProfile,
  targets: ActiveModelSet,
  catalog?: ModelCatalogState,
): string[] {
  if (catalog?.status !== "ready") {
    return [];
  }
  return catalog.models.filter(
    (modelId) =>
      !isDuplicateModelTarget(targets, { providerId: profile.id, modelId }),
  );
}

export function providerSelectionStatus(
  profile: ProviderProfile | undefined,
  catalog: ModelCatalogState,
  modelId: string,
): ProviderSelectionStatus {
  if (!profile?.configured) {
    return "unconfigured";
  }
  if (catalog.status === "loading") {
    return "catalog-loading";
  }
  if (catalog.status === "error") {
    return "catalog-error";
  }
  if (catalog.status === "ready" && catalog.models.length === 0) {
    return "no-models";
  }
  if (catalog.status === "ready" && modelId === "") {
    return "model-required";
  }
  if (
    catalog.status === "ready" &&
    modelId !== "" &&
    !catalog.models.includes(modelId)
  ) {
    return "model-unavailable";
  }
  return "ready";
}

export function defaultModelAfterTest(
  availableModels: string[],
  currentModel = "",
): string {
  if (currentModel && availableModels.includes(currentModel)) {
    return currentModel;
  }
  const preferred = ["Qwen/Qwen3.8-27B", "z-ai/glm-5.3-flash"];
  return (
    preferred.find((id) => availableModels.includes(id)) ??
    availableModels[0] ??
    ""
  );
}
