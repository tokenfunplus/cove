// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import * as api from "@/api";
import { useModelSelection } from "./use-model-selection";
import type { ActiveModelSet } from "@/components/providers/model-selection";
import { useWorkspaceState } from "@/hooks/workspace/use-workspace-state";
import { settingsKey } from "@/api/queryKeys";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import { englishConversationCopy } from "@/messages";
import type { WorkspaceSettings } from "@cove/api-contract";

vi.mock("@/api", async original => ({
  ...(await original<typeof api>()),
  getProviderProfiles: vi.fn(),
  getSession: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

test.each(["success", "failure"] as const)("a delayed preset %s cannot overwrite a newer provider selection", async outcome => {
  const fixture = createWorkspaceFixture();
  const other = { ...fixture.profile, id: "other-provider" };
  const cache = new QueryClient();
  let resolve!: (value: WorkspaceSettings) => void;
  let reject!: (error: Error) => void;
  vi.mocked(api.updateSettings).mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  const feedback = vi.fn();
  const { result, unmount } = renderHook(() => {
    const [activeModelSet, setActiveModelSet] = useState<ActiveModelSet>([{ providerId: fixture.profile.id, modelId: "model-one" }]);
    return { activeModelSet, ...useModelSelection({
      isSending: false, activeModelSet, setActiveModelSet,
      settings: fixture.settings, setSettings: vi.fn(), setFeedback: feedback,
      providerProfiles: [fixture.profile, other],
      catalogs: { [fixture.profile.id]: { status: "ready", models: fixture.models } },
      copy: englishConversationCopy,
    }) };
  }, { wrapper: ({ children }) => <QueryClientProvider client={cache}>{children}</QueryClientProvider> });
  let applying!: Promise<unknown>;
  act(() => { applying = result.current.handleApplyModelSet([{ providerId: fixture.profile.id, modelId: "model-one" }]); });
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledOnce());
  act(() => result.current.handleProviderChange(other.id));
  await act(async () => {
    if (outcome === "success") resolve(fixture.settings);
    else reject(new Error("Synthetic stale selection failure"));
    await applying;
  });
  expect(result.current.activeModelSet).toEqual([{ providerId: other.id, modelId: "" }]);
  expect(feedback).not.toHaveBeenCalledWith(expect.any(String));
  unmount();
  cache.clear();
});

test.each(["superseded", "uncontested"] as const)(
  "Quick Panel handles a %s model selection save through the settings cache",
  async (outcome) => {
    const fixture = createWorkspaceFixture(2);
    const other = { ...fixture.profile, id: "other-provider" };
    const initialSettings = {
      ...fixture.settings,
      active_model_set: [fixture.settings.active_model_set[0]!],
    };
    const savedSettings = {
      ...fixture.settings,
      active_model_set: [fixture.settings.active_model_set[1]!],
    };
    const initialSelection = [{ providerId: fixture.profile.id, modelId: "model-one" }];
    const savedSelection = [{ providerId: fixture.profile.id, modelId: "model-two" }];
    const cache = new QueryClient();
    let resolveSave!: (settings: WorkspaceSettings) => void;
    const pendingSave = new Promise<WorkspaceSettings>((resolve) => { resolveSave = resolve; });
    vi.mocked(api.getSession).mockResolvedValue({ csrf_token: "synthetic-session" });
    vi.mocked(api.getSettings).mockResolvedValue(initialSettings);
    vi.mocked(api.getProviderProfiles).mockResolvedValue([fixture.profile, other]);
    vi.mocked(api.updateSettings).mockReturnValue(pendingSave);
    const { result, unmount } = renderHook(() => {
      const workspace = useWorkspaceState(false, true);
      const commands = useModelSelection({
        ...workspace,
        isSending: false,
        setFeedback: vi.fn(),
        catalogs: { [fixture.profile.id]: { status: "ready", models: fixture.models } },
        copy: englishConversationCopy,
      });
      return { ...workspace, ...commands };
    }, { wrapper: ({ children }) => <QueryClientProvider client={cache}>{children}</QueryClientProvider> });
    await waitFor(() => expect(result.current.activeModelSet).toEqual(initialSelection));

    let saving!: Promise<unknown>;
    act(() => { saving = result.current.handleApplyModelSet(savedSelection); });
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledOnce());
    if (outcome === "superseded") {
      act(() => result.current.handleProviderChange(other.id));
    }
    await act(async () => {
      resolveSave(savedSettings);
      await saving;
    });

    if (outcome === "superseded") {
      expect(cache.getQueryData(settingsKey)).toEqual(initialSettings);
      expect(result.current.activeModelSet).toEqual([{ providerId: other.id, modelId: "" }]);
    } else {
      expect(cache.getQueryData(settingsKey)).toEqual(savedSettings);
      expect(result.current.activeModelSet).toEqual(savedSelection);
      await act(async () => {
        await cache.invalidateQueries({ queryKey: settingsKey });
      });
      await waitFor(() => expect(result.current.activeModelSet).toEqual(initialSelection));
    }
    unmount();
    cache.clear();
  },
);
