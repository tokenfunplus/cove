import { useUpdateSettings } from "@/api/hooks/useSettings";

import {
  activeModelSetFromWorkspaceSettings,
  availableModelsForAddedTarget,
  isDuplicateModelTarget,
  type ActiveSelection,
  type ActiveModelSet,
  type ModelCatalogs,
} from "@/components/providers/model-selection";
import { providerErrorMessage } from "@/components/providers/provider-feedback";
import { type GenerationState } from "@/hooks/chat/use-generation-state";
import { type WorkspaceState } from "@/hooks/workspace/use-workspace-state";
import { type WorkspaceUi } from "@/hooks/workspace/use-workspace-ui";
import { type ApplicationCopy } from "@/messages";
import {
  type ProviderProfile,
  type WorkspaceSettings,
} from "@cove/api-contract";

type Dependencies = Pick<GenerationState, "isSending"> &
  Pick<
    WorkspaceState,
    | "setActiveModelSet"
    | "activeModelSet"
    | "settings"
    | "setSettings"
    | "providerProfiles"
  > &
  Pick<WorkspaceUi, "setFeedback"> & {
    catalogs: ModelCatalogs;
    copy: ApplicationCopy;
  };

export function useModelSelection({
  isSending,
  setActiveModelSet,
  setFeedback,
  activeModelSet,
  catalogs,
  copy,
  settings,
  setSettings,
  providerProfiles,
}: Dependencies) {
  const updateSettings = useUpdateSettings().mutateAsync;

  function handleProviderChange(providerId: string) {
    if (isSending) {
      return;
    }
    setActiveModelSet(providerId ? [{ providerId, modelId: "" }] : []);
    setFeedback(undefined);
  }

  async function handleApplyModelSet(targets: ActiveModelSet) {
    if (
      isSending ||
      !targets.length ||
      targets.length > 4 ||
      targets.some(
        (target, index) =>
          !providerProfiles.some(
            (profile) => profile.id === target.providerId && profile.configured,
          ) ||
          catalogs[target.providerId]?.status !== "ready" ||
          !catalogs[target.providerId]?.models.includes(target.modelId) ||
          isDuplicateModelTarget(targets, target, index),
      )
    )
      return;
    try {
      const updated = await updateSettings({
        ...settings,
        active_model_set: targets.map((target) => ({
          provider_id: target.providerId,
          model_id: target.modelId,
        })),
      });
      setSettings(updated);
      setActiveModelSet(
        activeModelSetFromWorkspaceSettings(updated, providerProfiles),
      );
      setFeedback(undefined);
    } catch (error) {
      setFeedback(providerErrorMessage(error, copy));
    }
  }

  async function handleModelChange(modelId: string) {
    await handleTargetModelChange(0, modelId);
  }

  async function handleTargetModelChange(targetIndex: number, modelId: string) {
    const target = activeModelSet[targetIndex];
    const targetCatalog = target ? catalogs[target.providerId] : undefined;
    if (
      isSending ||
      !target ||
      targetCatalog?.status !== "ready" ||
      !targetCatalog.models.includes(modelId)
    ) {
      return;
    }
    const nextTarget = { ...target, modelId };
    if (isDuplicateModelTarget(activeModelSet, nextTarget, targetIndex)) {
      setFeedback(copy.modelAlreadyInComparison);
      return;
    }
    try {
      const nextModelSet = activeModelSet.map((candidate, index) =>
        index === targetIndex ? nextTarget : candidate,
      );
      const updated = await updateSettings({
        ...settings,
        active_model_set: nextModelSet.map((candidate) => ({
          provider_id: candidate.providerId,
          model_id: candidate.modelId,
        })),
      });
      setSettings(updated);
      setActiveModelSet(
        activeModelSetFromWorkspaceSettings(updated, providerProfiles),
      );
      setFeedback(undefined);
    } catch (error) {
      setFeedback(providerErrorMessage(error, copy));
    }
  }

  async function handleAddModel(profile: ProviderProfile, modelId: string) {
    const availableModels = availableModelsForAddedTarget(
      profile,
      activeModelSet,
      catalogs[profile.id],
    );
    if (
      isSending ||
      !profile.configured ||
      !availableModels.includes(modelId) ||
      activeModelSet.length >= 4
    )
      return;
    const nextModelSet = [
      ...activeModelSet,
      { providerId: profile.id, modelId },
    ];
    try {
      const updated = await updateSettings({
        ...settings,
        active_model_set: nextModelSet.map((target) => ({
          provider_id: target.providerId,
          model_id: target.modelId,
        })),
      });
      setSettings(updated);
      setActiveModelSet(
        activeModelSetFromWorkspaceSettings(updated, providerProfiles),
      );
    } catch (error) {
      setFeedback(providerErrorMessage(error, copy));
    }
  }

  async function handleRemoveModel(target: ActiveSelection) {
    if (isSending) return;
    const nextModelSet = activeModelSet.filter(
      (candidate) =>
        candidate.providerId !== target.providerId ||
        candidate.modelId !== target.modelId,
    );
    try {
      const updated = await updateSettings({
        ...settings,
        active_model_set: nextModelSet.map((candidate) => ({
          provider_id: candidate.providerId,
          model_id: candidate.modelId,
        })),
      });
      setSettings(updated);
      setActiveModelSet(
        activeModelSetFromWorkspaceSettings(updated, providerProfiles),
      );
    } catch (error) {
      setFeedback(providerErrorMessage(error, copy));
    }
  }

  async function handleSaveSettings(next: WorkspaceSettings) {
    const updated = await updateSettings({
      ...next,
      active_model_set: activeModelSet.map((target) => ({
        provider_id: target.providerId,
        model_id: target.modelId,
      })),
    });
    setSettings(updated);
    setActiveModelSet(
      activeModelSetFromWorkspaceSettings(updated, providerProfiles),
    );
  }

  async function handleToggleTheme() {
    const effective =
      settings.theme === "system"
        ? typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : settings.theme;
    const next = effective === "dark" ? "light" : "dark";
    try {
      await handleSaveSettings({ ...settings, theme: next });
    } catch {
      setFeedback(copy.settingsFailed);
    }
  }

  async function clearActiveSelectionForProvider(providerId: string) {
    const nextModelSet = activeModelSet.filter(
      (selection) => selection.providerId !== providerId,
    );
    const nextSettings = {
      ...settings,
      active_model_set: nextModelSet.map((selection) => ({
        provider_id: selection.providerId,
        model_id: selection.modelId,
      })),
    };
    setActiveModelSet(nextModelSet);
    try {
      const updated = await updateSettings(nextSettings);
      setSettings(updated);
    } catch {
      setSettings(nextSettings);
      setFeedback(copy.settingsFailed);
    }
  }

  return {
    handleProviderChange,
    handleApplyModelSet,
    handleModelChange,
    handleTargetModelChange,
    handleAddModel,
    handleRemoveModel,
    handleSaveSettings,
    handleToggleTheme,
    clearActiveSelectionForProvider,
  };
}

export type ModelSelection = ReturnType<typeof useModelSelection>;
