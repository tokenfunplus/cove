import {
  activeModelSetFromWorkspaceSettings,
  availableModelsForAddedTarget,
  defaultModelAfterTest,
  inferenceModeForSnapshot,
  isDuplicateModelTarget,
  providerSelectionStatus,
  secureInferenceTargetSelected,
  secureTargetForCatalog,
} from "@/components/providers/model-selection";
import type { ProviderProfile, WorkspaceSettings } from "@cove/api-contract";
import { expect, test } from "vitest";

test("a sole configured Provider Profile supplies the workspace default model selection", () => {
  const settings: WorkspaceSettings = {
    theme: "system",
    locale: "system",
    system_prompt: "",
    temperature: null,
    top_p: null,
    max_tokens: null,
    active_model_set: [],
  };
  const provider: ProviderProfile = {
    id: "nearai",
    kind: "nearai",
    name: "NearAI",
    endpoint: "https://cloud-stg-api.near.ai",
    model_id: "openai/gpt-4.1-mini",
    auth_method: "bearer",
    runtime_location: "NearAI cloud",
    destination: "cloud-stg-api.near.ai",
    transport_security: "tls",
    privacy_notice: "notice",
    configured: true,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };

  expect(activeModelSetFromWorkspaceSettings(settings, [provider])).toEqual([
    {
      providerId: "nearai",
      modelId: "openai/gpt-4.1-mini",
    },
  ]);
  expect(
    activeModelSetFromWorkspaceSettings(
      {
        ...settings,
        active_model_set: [{ provider_id: "other", model_id: "model-b" }],
      },
      [provider],
    ),
  ).toEqual([{ providerId: "other", modelId: "model-b" }]);
  expect(
    activeModelSetFromWorkspaceSettings(settings, [
      provider,
      { ...provider, id: "other" },
    ]),
  ).toEqual([]);
});

test("a model target cannot be changed to another card's Provider and model combination", () => {
  const targets = [
    { providerId: "provider-1", modelId: "atlas-1" },
    { providerId: "provider-1", modelId: "atlas-2" },
  ];

  expect(
    isDuplicateModelTarget(
      targets,
      { providerId: "provider-1", modelId: "atlas-1" },
      1,
    ),
  ).toBe(true);
  expect(
    isDuplicateModelTarget(
      targets,
      { providerId: "provider-1", modelId: "atlas-3" },
      1,
    ),
  ).toBe(false);
});

test("adding a target offers every unused catalog model without choosing one automatically", () => {
  const profile: ProviderProfile = {
    id: "provider-1",
    kind: "openai_compatible",
    name: "Atlas",
    endpoint: "https://atlas.example",
    model_id: "atlas-1",
    auth_method: "bearer",
    runtime_location: "Atlas cloud",
    destination: "atlas.example",
    transport_security: "tls",
    privacy_notice: "notice",
    configured: true,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };

  expect(
    availableModelsForAddedTarget(
      profile,
      [{ providerId: "provider-1", modelId: "atlas-1" }],
      { status: "ready", models: ["atlas-1", "atlas-2", "atlas-3"] },
    ),
  ).toEqual(["atlas-2", "atlas-3"]);
  expect(
    availableModelsForAddedTarget(profile, [], {
      status: "loading",
      models: [],
    }),
  ).toEqual([]);
});

test("generation selection is not ready until a catalog model is selected", () => {
  const profile: ProviderProfile = {
    id: "provider-1",
    kind: "openai_compatible",
    name: "Fixture Provider",
    endpoint: "https://provider.example",
    model_id: "model-a",
    auth_method: "bearer",
    runtime_location: "User configured cloud provider",
    destination: "provider.example",
    transport_security: "tls",
    privacy_notice: "notice",
    configured: true,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };

  expect(
    providerSelectionStatus(
      profile,
      { status: "ready", models: ["model-a"] },
      "",
    ),
  ).toBe("model-required");
});

test("provider test picks a verified NearAI model when none is selected", () => {
  expect(
    defaultModelAfterTest([
      "anthropic/claude-haiku-4-5",
      "Qwen/Qwen3.8-27B",
      "z-ai/glm-5.3-flash",
    ]),
  ).toBe("Qwen/Qwen3.8-27B");
  expect(
    defaultModelAfterTest(
      ["anthropic/claude-haiku-4-5"],
      "anthropic/claude-haiku-4-5",
    ),
  ).toBe("anthropic/claude-haiku-4-5");
  expect(defaultModelAfterTest([])).toBe("");
});

test("an ordinary snapshot's catalog classification does not enable private verification", () => {
  expect(
    inferenceModeForSnapshot({
      provider_id: "custom-provider",
      privacy_mode: "incognito",
    }),
  ).toBeUndefined();
  expect(
    inferenceModeForSnapshot({
      provider_id: "nearai",
      privacy_mode: "incognito",
    }),
  ).toBe("incognito");
  expect(
    inferenceModeForSnapshot({
      provider_id: "nearai",
      provider_kind: "openai_compatible",
      privacy_mode: "private_tee",
    }),
  ).toBeUndefined();
  expect(
    inferenceModeForSnapshot({
      provider_id: "nearai-fixture",
      provider_kind: "nearai",
      privacy_mode: "private_tee",
    }),
  ).toBe("private_tee");
});

test("Chat Surface allows private connection verification for an all-NearAI comparison", () => {
  expect(
    secureInferenceTargetSelected(
      [{ providerId: "nearai", modelId: "private-model" }],
      [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile],
      {
        nearai: {
          status: "ready",
          models: ["private-model"],
          metadata: {
            "private-model": {
              id: "private-model",
              privacy_mode: "private_tee",
              verifiable: true,
            },
          },
        },
      },
    ),
  ).toBe(true);
  expect(
    secureInferenceTargetSelected(
      [
        { providerId: "nearai", modelId: "private-model-a" },
        { providerId: "nearai-2", modelId: "private-model-b" },
      ],
      [
        { id: "nearai", kind: "nearai", configured: true },
        { id: "nearai-2", kind: "nearai", configured: true },
      ] as ProviderProfile[],
      {
        nearai: {
          status: "ready",
          models: ["private-model-a"],
          metadata: {
            "private-model-a": {
              id: "private-model-a",
              privacy_mode: "private_tee",
              verifiable: true,
            },
          },
        },
        "nearai-2": {
          status: "ready",
          models: ["private-model-b"],
          metadata: {
            "private-model-b": {
              id: "private-model-b",
              privacy_mode: "private_tee",
              verifiable: true,
            },
          },
        },
      },
    ),
  ).toBe(true);
  expect(
    secureInferenceTargetSelected(
      [{ providerId: "nearai", modelId: "openai/gpt-4.1-mini" }],
      [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile],
      {
        nearai: {
          status: "ready",
          models: ["openai/gpt-4.1-mini"],
          metadata: {
            "openai/gpt-4.1-mini": {
              id: "openai/gpt-4.1-mini",
              privacy_mode: "incognito",
              verifiable: false,
            },
          },
        },
      },
    ),
  ).toBe(false);
  expect(
    secureInferenceTargetSelected(
      [{ providerId: "nearai", modelId: "moonshotai/kimi-k2.5" }],
      [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile],
      {
        nearai: {
          status: "ready",
          models: ["moonshotai/kimi-k2.5"],
          metadata: {},
        },
      },
    ),
  ).toBe(false);
  expect(
    secureInferenceTargetSelected(
      [
        { providerId: "nearai", modelId: "private-model" },
        { providerId: "other", modelId: "model" },
      ],
      [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile],
    ),
  ).toBe(false);
  expect(
    secureInferenceTargetSelected(
      [{ providerId: "other", modelId: "model" }],
      [
        {
          id: "other",
          kind: "openai_compatible",
          configured: true,
        } as ProviderProfile,
      ],
    ),
  ).toBe(false);
  expect(
    secureInferenceTargetSelected(
      [{ providerId: "nearai", modelId: "moonshotai/kimi-k3" }],
      [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile],
      {
        nearai: {
          status: "ready",
          models: ["moonshotai/kimi-k3"],
          metadata: {
            "moonshotai/kimi-k3": {
              id: "moonshotai/kimi-k3",
              privacy_mode: "chutes",
              verifiable: false,
            },
          },
        },
      },
    ),
  ).toBe(false);
  expect(
    secureTargetForCatalog(
      { providerId: "nearai", modelId: "openai/gpt-4.1-mini" },
      [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile],
      {
        nearai: {
          status: "ready",
          models: ["openai/gpt-4.1-mini"],
          metadata: {
            "openai/gpt-4.1-mini": {
              id: "openai/gpt-4.1-mini",
              privacy_mode: "incognito",
              verifiable: false,
            },
          },
        },
      },
    ),
  ).toBe(true);
  expect(
    secureTargetForCatalog(
      { providerId: "nearai", modelId: "moonshotai/kimi-k3" },
      [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile],
      {
        nearai: {
          status: "ready",
          models: ["moonshotai/kimi-k3"],
          metadata: {
            "moonshotai/kimi-k3": {
              id: "moonshotai/kimi-k3",
              privacy_mode: "chutes",
              verifiable: false,
            },
          },
        },
      },
    ),
  ).toBe(true);
});
