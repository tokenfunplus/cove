import {
  useDeleteProvider,
  useDeleteProviderKey,
  useSaveProvider,
  useTestProviderConnection,
} from "@/api/hooks/useProviders";
import { useUpdateSettings } from "@/api/hooks/useSettings";

import { activeModelSetFromWorkspaceSettings } from "@/components/providers/model-selection";
import { shouldDismissProviderDialog } from "@/components/providers/provider-feedback";
import type { WorkspaceState } from "@/hooks/workspace/use-workspace-state";
import type { WorkspaceUi } from "@/hooks/workspace/use-workspace-ui";
import type { ApplicationCopy } from "@/messages";
import type { ProviderProfileInput } from "@cove/api-contract";
import type { ModelSelection } from "./use-model-selection";

type Dependencies = Pick<
  WorkspaceState,
  | "providerProfiles"
  | "activeModelSet"
  | "setActiveModelSet"
  | "settings"
  | "setSettings"
> &
  Pick<WorkspaceUi, "setFeedback" | "setSettingsEntry"> &
  Pick<ModelSelection, "clearActiveSelectionForProvider"> & {
    copy: ApplicationCopy;
  };

export function useProviderActions({
  providerProfiles,
  activeModelSet,
  setActiveModelSet,
  settings,
  setSettings,
  setFeedback,
  setSettingsEntry,
  clearActiveSelectionForProvider,
  copy,
}: Dependencies) {
  const deleteProviderKey = useDeleteProviderKey().mutateAsync;
  const deleteProviderProfile = useDeleteProvider().mutateAsync;
  const saveProviderProfile = useSaveProvider().mutateAsync;
  const testProviderConnection = useTestProviderConnection().mutateAsync;
  const updateSettings = useUpdateSettings().mutateAsync;

  async function handleSaveProvider(input: ProviderProfileInput) {
    const saved = await saveProviderProfile(input);
    const nextProfiles = [
      saved,
      ...providerProfiles.filter((profile) => profile.id !== saved.id),
    ];

    if (activeModelSet.length === 0 && saved.configured && saved.model_id) {
      const nextModelSet = [{ providerId: saved.id, modelId: saved.model_id }];
      setActiveModelSet(nextModelSet);
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
          activeModelSetFromWorkspaceSettings(updated, nextProfiles),
        );
      } catch {
        setFeedback(copy.settingsFailed);
      }
    }
    if (shouldDismissProviderDialog(saved)) setSettingsEntry(undefined);
    return saved;
  }

  async function handleTestProvider(input: ProviderProfileInput) {
    return testProviderConnection(input);
  }

  async function handleDeleteProvider(id: string) {
    await deleteProviderProfile(id);

    await clearActiveSelectionForProvider(id);
  }

  async function handleDeleteProviderKey(id: string) {
    await deleteProviderKey(id);

    await clearActiveSelectionForProvider(id);
  }

  return {
    handleSaveProvider,
    handleTestProvider,
    handleDeleteProvider,
    handleDeleteProviderKey,
  };
}
