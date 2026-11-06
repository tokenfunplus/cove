import { ModelSelector } from "@/components/providers/ModelSelector";
import type { ProviderProfile } from "@cove/api-contract";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

test("model selector badges NearAI catalog types without folding Chutes into Incognito", () => {
  const profile: ProviderProfile = {
    id: "nearai",
    kind: "nearai",
    name: "NearAI",
    endpoint: "https://cloud-stg-api.near.ai",
    model_id: "Qwen/Qwen3.8-27B",
    auth_method: "bearer",
    runtime_location: "NearAI cloud",
    destination: "cloud-stg-api.near.ai",
    transport_security: "tls",
    privacy_notice: "notice",
    configured: true,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };
  const catalog = {
    status: "ready" as const,
    models: ["Qwen/Qwen3.8-27B", "openai/gpt-4.1-mini", "moonshotai/kimi-k3"],
    metadata: {
      "Qwen/Qwen3.8-27B": {
        id: "Qwen/Qwen3.8-27B",
        privacy_mode: "private_tee" as const,
        verifiable: true,
      },
      "openai/gpt-4.1-mini": {
        id: "openai/gpt-4.1-mini",
        privacy_mode: "incognito" as const,
        verifiable: false,
      },
      "moonshotai/kimi-k3": {
        id: "moonshotai/kimi-k3",
        privacy_mode: "chutes" as const,
        verifiable: false,
      },
    },
  };
  for (const [modelId, mode, label] of [
    ["Qwen/Qwen3.8-27B", "private_tee", "Private TEE"],
    ["openai/gpt-4.1-mini", "incognito", "Incognito"],
    ["moonshotai/kimi-k3", "chutes", "Chutes"],
  ] as const) {
    const markup = renderToStaticMarkup(
      <ModelSelector
        profiles={[profile]}
        activeProviderId="nearai"
        activeModelId={modelId}
        catalog={catalog}
        onProviderChange={() => {}}
        onModelChange={() => {}}
      />,
    );
    expect(markup).toContain(`data-privacy-mode="${mode}"`);
    expect(markup).toContain(label);
  }
});

test("model selector shows the active Provider and model catalog state", () => {
  const markup = renderToStaticMarkup(
    <ModelSelector
      profiles={[
        {
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
        },
      ]}
      activeProviderId="provider-1"
      activeModelId="model-b"
      catalog={{ status: "ready", models: ["model-a", "model-b"] }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
    />,
  );

  expect(markup).toContain("Fixture Provider");
  expect(markup).toContain("model-b");
  expect(markup).toContain('data-catalog-status="ready"');
});

test("model selector keeps comparison targets in compact, independently selectable chips", () => {
  const profiles: ProviderProfile[] = [
    {
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
    },
    {
      id: "provider-2",
      kind: "openai_compatible",
      name: "Boreal",
      endpoint: "https://boreal.example",
      model_id: "boreal-2",
      auth_method: "bearer",
      runtime_location: "Boreal cloud",
      destination: "boreal.example",
      transport_security: "tls",
      privacy_notice: "notice",
      configured: true,
      created_at: "2026-09-10T00:00:00Z",
      updated_at: "2026-09-10T00:00:00Z",
    },
  ];
  profiles.push({
    ...profiles[1],
    id: "provider-3",
    name: "Cetus",
    endpoint: "https://cetus.example",
    model_id: "cetus-1",
    destination: "cetus.example",
  });
  const markup = renderToStaticMarkup(
    <ModelSelector
      profiles={profiles}
      activeProviderId="provider-1"
      activeModelId="atlas-1"
      activeModelSet={[
        { providerId: "provider-1", modelId: "atlas-1" },
        { providerId: "provider-2", modelId: "boreal-3" },
      ]}
      catalog={{ status: "ready", models: ["atlas-1"] }}
      catalogs={{
        "provider-1": { status: "ready", models: ["atlas-1", "atlas-2"] },
        "provider-2": { status: "ready", models: ["boreal-2", "boreal-3"] },
        "provider-3": { status: "ready", models: ["cetus-1", "cetus-2"] },
      }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
      onTargetModelChange={() => {}}
      onAddModel={() => {}}
      onRemoveModel={() => {}}
    />,
  );

  expect(markup).toMatch(
    /class="[^"\n]*\bmodel\-selector__comparison\b[^"\n]*"/,
  );
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toMatch(/model-selector__comparison[^>]*hidden=""/);
  expect(markup).toMatch(
    /class="[^"\n]*\bmodel\-selector__chip\-provider\b[^"\n]*">Atlas/,
  );
  expect(markup).toMatch(
    /class="[^"\n]*\bmodel\-selector__chip\-provider\b[^"\n]*">Boreal/,
  );
  expect(markup).toContain('aria-label="Model: Atlas atlas-1"');
  expect(markup).toContain('aria-label="Model: Boreal boreal-3"');
  expect(markup).toContain("model-selector__chip-model-select");
  expect(markup).toContain('aria-label="Remove model: Atlas atlas-1"');
  expect(markup).toContain("model-selector__add-menu");
  expect(markup).toContain("Search models");
  expect(markup).toContain("model-selector__add-button");
});

test("model selector disables model choice while its catalog is unavailable", () => {
  const markup = renderToStaticMarkup(
    <ModelSelector
      profiles={[
        {
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
        },
      ]}
      activeProviderId="provider-1"
      activeModelId="model-a"
      activeModelSet={[{ providerId: "provider-1", modelId: "model-a" }]}
      catalog={{ status: "error", models: [] }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
    />,
  );

  expect(markup).toContain('data-catalog-status="error"');
  expect(markup).toContain("disabled");
});

test("model selector marks a persisted model that disappeared from the catalog as invalid", () => {
  const markup = renderToStaticMarkup(
    <ModelSelector
      profiles={[
        {
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
        },
      ]}
      activeProviderId="provider-1"
      activeModelId="retired-model"
      catalog={{ status: "ready", models: ["model-a"] }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
    />,
  );

  expect(markup).toContain('data-selection-valid="false"');
  expect(markup).toContain("Selected model is no longer available");
});
