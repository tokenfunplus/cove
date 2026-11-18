// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import * as api from "@/api";
import { useModelSelection } from "./use-model-selection";
import type { ActiveModelSet } from "@/components/providers/model-selection";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import { englishConversationCopy } from "@/messages";
import type { WorkspaceSettings } from "@cove/api-contract";

vi.mock("@/api", async original => ({ ...(await original<typeof api>()), updateSettings: vi.fn() }));
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
  let applying!: Promise<void>;
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
