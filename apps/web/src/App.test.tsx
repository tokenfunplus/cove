import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Conversation, ConversationView, Generation, GenerationBatch, WorkspaceSettings } from "@cove/api-contract";
import type { ProviderProfile } from "@cove/api-contract";
import { ChatDataPanel, ConversationList, ConversationPanel, PrivacyStatusPanel, PrivateConnectionProgress, VerificationDialogContent, SignatureVerificationContent, availableModelsForAddedTarget, comparisonPromptForMessages, contractEvidenceFor, copyVerificationValue, defaultModelAfterTest, MarkdownMessage, ModelSelector, ProviderSettings, SettingsDialogContent, SidebarToggle, WorkspaceHeader, WorkspaceSettingsPanel, groupConversations, isDuplicateModelTarget, isSystemPromptWithinLimit, modelParameterFormValue, nearAISelectionPresent, nextClearConfirmLabel, parseModelParameters, privacyStatusFromConversation, privacyStatusPresentation, providerCatalogQueryOptions, providerConnectionLabel, providerConnectionStatus, providerErrorFeedback, providerErrorMessage, providerSelectionStatus, resolvedThemePreference, selectionAfterProviderRemoval, selectionAfterProviderSave, secureInferenceTargetSelected, selectionFromWorkspaceSettings, settingsWithActiveSelection, shouldDismissProviderDialog, shouldSubmitComposerKey, signatureVerificationAvailable, verificationEvidenceForDialog, verificationLaneStatus, verifiedInferenceTargetSelected } from "./App";
import { applicationMessages } from "./messages";
import { LocalServiceError } from "./transport";

const fixtureGenerationConfiguration = {
  system_prompt: "",
  temperature: null,
  top_p: null,
  max_tokens: null
};

test("conversation workspace shows an empty local history state", () => {
  const markup = renderToStaticMarkup(<ConversationList conversations={[]} selectedId={undefined} onSelect={() => {}} />);

  expect(markup).toContain("No local conversations yet");
});

test("conversation workspace shows locally persisted conversation titles", () => {
  const conversations: Conversation[] = [
    {
      id: "conversation-1",
      title: "Offline chat",
      created_at: "2026-09-10T00:00:00Z",
      updated_at: "2026-09-10T00:00:00Z"
    }
  ];

  const markup = renderToStaticMarkup(<ConversationList conversations={conversations} selectedId="conversation-1" onSelect={() => {}} />);

  expect(markup).toContain("Offline chat");
  expect(markup).toContain("conversation--selected");
});

test("conversation workspace exposes the selected conversation to assistive technology", () => {
  const markup = renderToStaticMarkup(
    <ConversationList
      conversations={[{ id: "conversation-1", title: "Current chat", created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z" }]}
      selectedId="conversation-1"
      onSelect={() => {}}
    />
  );

  expect(markup).toContain('aria-current="page"');
});

test("conversation workspace offers a new conversation action", () => {
  const markup = renderToStaticMarkup(<ConversationList conversations={[]} selectedId={undefined} onSelect={() => {}} />);

  expect(markup).toContain("New conversation");
});

test("conversation navigation presents the NearAI-inspired recent-workspace treatment", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
  const markup = renderToStaticMarkup(
    <ConversationList
      conversations={[
        { id: "conversation-1", title: "Today chat", created_at: "2026-09-12T00:00:00Z", updated_at: "2026-09-12T00:00:00Z" },
        { id: "conversation-2", title: "Previous chat", created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z" }
      ]}
      selectedId="conversation-1"
      onSelect={() => {}}
    />
  );

  expect(markup).not.toContain("conversation-list__chats-heading");
  expect(markup).toContain('aria-label="Chats"');
  expect(markup).toContain("Today");
  expect(markup).toContain("Previous 7 days");
  expect(markup).toContain("Today chat");
  expect(markup).toContain("Previous chat");
  expect(markup).toContain('aria-label="Settings"');
  expect(markup).toContain("Feedback");
  expect(markup).toContain("github.com/tokenfunplus/cove/issues/new/choose");
});

afterEach(() => vi.useRealTimers());

test("conversation navigation places settings in the lower-left without an account profile", () => {
  const markup = renderToStaticMarkup(
    <ConversationList
      conversations={[]}
      selectedId={undefined}
      onSelect={() => {}}
      onOpenSettings={() => {}}
    />
  );

  expect(markup).toContain('class="conversation-list__settings"');
  expect(markup).toContain("<span>Settings</span>");
  expect(markup).not.toContain("conversation-list__avatar");
  expect(markup).not.toContain("<strong>Cove</strong>");
});

test("sidebar toggle exposes reversible labels and directions", () => {
  const expanded = renderToStaticMarkup(<SidebarToggle collapsed={false} onToggle={() => {}} />);
  const collapsed = renderToStaticMarkup(<SidebarToggle collapsed={true} onToggle={() => {}} />);

  expect(expanded).toContain('aria-controls="conversation-sidebar"');
  expect(expanded).toContain('aria-expanded="true"');
  expect(expanded).toContain('aria-label="Collapse sidebar"');
  expect(expanded).toContain("lucide-panel-left-close");
  expect(collapsed).toContain('aria-expanded="false"');
  expect(collapsed).toContain('aria-label="Expand sidebar"');
  expect(collapsed).toContain("lucide-panel-left-open");
});

test("workspace header keeps only compact model controls in the main content area", () => {
  const markup = renderToStaticMarkup(
    <WorkspaceHeader
      profiles={[]}
      activeProviderId=""
      activeModelId=""
      catalog={{ status: "idle", models: [] }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
      connection="ready"
    />
  );

  expect(markup).toContain('data-workspace-region="workspace-header"');
  expect(markup).not.toContain("workspace__model-icon");
  expect(markup).not.toContain("workspace__new-chat");
  expect(markup).toContain('data-workspace-model-controls="compact"');
  expect(markup).toContain("model-selector--nearai");
  expect(markup).toContain("Local session ready");
});

test("workspace header offers a deliberate private connection verification action", () => {
  const markup = renderToStaticMarkup(
    <WorkspaceHeader
      profiles={[]}
      activeProviderId="nearai"
      activeModelId="private-model"
      activeModelSet={[{ providerId: "nearai", modelId: "private-model" }]}
      catalog={{ status: "ready", models: ["private-model"] }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
      onVerifyPrivateConnection={() => {}}
      onOpenPrivateVerification={() => {}}
      connection="ready"
    />
  );

  expect(markup).toContain("Verify private connection");
  expect(markup).toContain("Model Verification");
});

test("private connection progress keeps completed checks visible while highlighting the live phase", () => {
  const markup = renderToStaticMarkup(<PrivateConnectionProgress
    providerName="NearAI"
    modelIds={["Qwen/Qwen3.8-27B"]}
    phase="encrypted_path"
    copy={applicationMessages("en")}
    onClose={() => {}}
  />);

  expect(markup).toContain("NearAI · Qwen/Qwen3.8-27B");
  expect(markup).toContain("Testing the end-to-end encrypted path...");
  expect(markup).toContain('data-progress-step="environment" data-state="complete"');
  expect(markup).toContain('data-progress-step="encrypted_path" data-state="active"');
  expect(markup).toContain('data-progress-step="response" data-state="pending"');
});

test("workspace header exposes Privacy Status for an empty or loaded conversation", () => {
  const markup = renderToStaticMarkup(
    <WorkspaceHeader
      profiles={[]}
      activeProviderId=""
      activeModelId=""
      catalog={{ status: "idle", models: [] }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
      onOpenPrivacyStatus={() => {}}
      connection="ready"
    />
  );
  expect(markup).toContain("Privacy Status");
});

function privacySnapshot(providerId: string, modelId: string) {
  return {
    provider_id: providerId,
    provider_name: providerId === "nearai" ? "NearAI" : "Cloud Gateway",
    model_id: modelId,
    runtime_location: "TEE",
    destination: providerId,
    transport_security: "tls" as const,
    privacy_notice: "fixture"
  };
}

function privacyBatch(overrides: Partial<GenerationBatch["targets"][number]["generation"]> = {}, options: { providerId?: string; modelId?: string; messageId?: string; verification?: GenerationBatch["targets"][number]["generation"]["verification"] } = {}): GenerationBatch {
  const providerId = options.providerId ?? "nearai";
  const modelId = options.modelId ?? "private-model";
  const snapshot = privacySnapshot(providerId, modelId);
  return {
    id: `batch-${providerId}-${modelId}`,
    conversation_id: "conversation-1",
    client_request_id: "request-1",
    state: "completed",
    events_url: "/events",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:01Z",
    targets: [{
      id: `target-${providerId}-${modelId}`,
      provider_id: providerId,
      model_id: modelId,
      position: 0,
      generation: {
        id: `generation-${providerId}-${modelId}`,
        state: "completed",
        snapshot,
        configuration_snapshot: fixtureGenerationConfiguration,
        assistant_message_id: options.messageId ?? `message-${providerId}-${modelId}`,
        verification: options.verification,
        ...overrides
      }
    }]
  };
}

test("privacy status is empty without a selected conversation", () => {
  expect(privacyStatusFromConversation(undefined, undefined, [])).toMatchObject({ status: "empty", privateModelCount: 0, verifiedAssistantMessageCount: 0 });
});

test("privacy status requires persisted provider TEE evidence for confidentiality", () => {
  const modelVerification = {
    status: "verified_model" as const,
    signature_kind: "provider_tee" as const,
    evidence: {
      kind: "model" as const,
      tcb_status: "UpToDate",
      gpu_evidence: "verified" as const,
      raw: { intel_quote: "quote" }
    }
  };
  const modelBatch = privacyBatch({}, { verification: modelVerification });
  const view: ConversationView = {
    id: "conversation-1", title: "Private", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:01Z",
    messages: [{ id: "message-nearai-private-model", conversation_id: "conversation-1", role: "assistant", body: "Private answer", provider_snapshot: privacySnapshot("nearai", "private-model"), created_at: "2026-09-17T00:00:01Z" }],
    generation_batches: [modelBatch]
  };
  const summary = privacyStatusFromConversation(view, undefined, []);
  expect(summary.status).toBe("confidential");
  expect(summary.privateModelCount).toBe(1);
  expect(summary.nvidia.count).toBe(1);
  expect(summary.intel.count).toBe(1);
  expect(summary.verifiedAssistantMessageCount).toBe(1);
  expect(summary.verifiedMessages[0]).toMatchObject({ body: "Private answer", modelId: "private-model" });

  const legacyBatch = privacyBatch({}, { verification: { ...modelVerification, signature_kind: undefined } });
  expect(privacyStatusFromConversation({ ...view, generation_batches: [legacyBatch] }, undefined, []).status).toBe("partial");
});

test("Gateway-only, unsupported, and mixed targets never claim confidential chat", () => {
  const gatewayBatch = privacyBatch({}, {
    providerId: "nearai",
    modelId: "private-model",
    verification: { status: "verified_gateway", signature_kind: "gateway", evidence: { kind: "gateway", raw: { intel_quote: "gateway" } } }
  });
  const ordinaryBatch = privacyBatch({ state: "failed", error_code: "provider_unavailable", assistant_message_id: undefined }, {
    providerId: "ordinary", modelId: "public-model", verification: { status: "unsupported" }
  });
  const view: ConversationView = {
    id: "conversation-1", title: "Mixed", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:01Z", messages: [],
    generation_batches: [gatewayBatch, ordinaryBatch]
  };
  const summary = privacyStatusFromConversation(view, undefined, []);
  expect(summary.status).toBe("partial");
  expect(summary.privateModelCount).toBe(1);
  expect(summary.verifiedAssistantMessageCount).toBe(1);
});

test("Gateway-only history is explicitly Gateway-verified, never confidential", () => {
  const batch = privacyBatch({}, { verification: { status: "verified_gateway", signature_kind: "gateway", evidence: { kind: "gateway", raw: { intel_quote: "gateway" } } } });
  const view: ConversationView = { id: "conversation-1", title: "Gateway", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:01Z", messages: [], generation_batches: [batch] };
  expect(privacyStatusFromConversation(view, undefined, []).status).toBe("gateway");
});

test("privacy status panel exposes metrics, expandable verified messages, and detail actions", () => {
  const verification = {
    status: "verified_model" as const,
    signature_kind: "provider_tee" as const,
    signing_address: "signer",
    signing_algorithm: "ed25519",
    signed_message: "signed",
    signature: "signature",
    evidence: { kind: "model" as const, raw: { intel_quote: "quote" } }
  };
  const batch = privacyBatch({}, { verification });
  const view: ConversationView = {
    id: "conversation-1", title: "Private", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:01Z",
    messages: [{ id: "message-nearai-private-model", conversation_id: "conversation-1", role: "assistant", body: "Saved private answer", provider_snapshot: privacySnapshot("nearai", "private-model"), created_at: "2026-09-17T00:00:01Z" }],
    generation_batches: [batch]
  };
  const summary = privacyStatusFromConversation(view, undefined, []);
  expect(summary.status).toBe("confidential");
  expect(summary.verifiedMessages[0]?.verification.signature).toBe("signature");
  expect(PrivacyStatusPanel).toBeTypeOf("function");
});

test("privacy panel reserves attestation claims for confidential conversations", () => {
  for (const locale of ["en", "zh", "ja"] as const) {
    const copy = applicationMessages(locale);
    for (const status of ["empty", "gateway", "partial", "unverified"] as const) {
      const presentation = privacyStatusPresentation(status, copy);
      expect(presentation.attested).toBe(false);
      expect(presentation.sealTitle).toBe(presentation.statusLabel);
      expect(presentation.sealTitle).not.toBe(copy.privacySealTitle);
      expect(presentation.sealDetail).toBe(copy.privacyStatusHint);
    }
    const confidential = privacyStatusPresentation("confidential", copy);
    expect(confidential.attested).toBe(true);
    expect(confidential.sealTitle).toBe(copy.privacySealTitle);
    expect(confidential.sealDetail).toBe(copy.privacySealDetail);
  }
});

test("conversation workspace exposes a secondary action menu for each conversation", () => {
  const markup = renderToStaticMarkup(
    <ConversationList
      conversations={[{ id: "conversation-1", title: "Delete locally", created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z" }]}
      selectedId="conversation-1"
      onSelect={() => {}}
      onDelete={() => {}}
    />
  );

  expect(markup).toContain('class="conversation-actions__trigger"');
  expect(markup).toContain('aria-label="Conversation actions: Delete locally"');
});

test("conversation navigation puts pinned chats ahead of local time groups", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
  const groups = groupConversations([
    { id: "today", title: "Today", created_at: "2026-09-12T00:00:00Z", updated_at: "2026-09-12T00:00:00Z" },
    { id: "pinned", title: "Pinned", pinned: true, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z" }
  ]);

  expect(groups.map((group) => group.id)).toEqual(["pinned", "today"]);
  expect(groups[0]?.conversations[0]?.title).toBe("Pinned");
});

test("conversation workspace renders opened messages without conversation title controls", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "Offline chat",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: [
      {
        id: "message-1",
        conversation_id: "conversation-1",
        role: "user",
        body: "Saved locally",
        created_at: "2026-09-10T00:00:00Z"
      }
    ]
  };

  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={view}
      titleDraft="Offline chat"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
    />
  );

  expect(markup).toContain("Saved locally");
  expect(markup).not.toContain("Local conversation");
  expect(markup).not.toContain("Rename conversation");
  expect(markup).not.toContain("Save title");
});

test("conversation composer communicates the NearAI-inspired private mode", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "Private notes",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: []
  };

  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={view}
      titleDraft="Private notes"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      onSend={() => {}}
      onDraftChange={() => {}}
    />
  );

  expect(markup).toContain("Private mode");
});

test("Chat Surface allows private connection verification for an all-NearAI comparison", () => {
  expect(secureInferenceTargetSelected(
    [{ providerId: "nearai", modelId: "private-model" }],
    [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile],
    { nearai: { status: "ready", models: ["private-model"], metadata: { "private-model": { id: "private-model", privacy_mode: "private_tee", verifiable: true } } } }
  )).toBe(true);
  expect(secureInferenceTargetSelected(
    [{ providerId: "nearai", modelId: "private-model-a" }, { providerId: "nearai-2", modelId: "private-model-b" }],
    [{ id: "nearai", kind: "nearai", configured: true }, { id: "nearai-2", kind: "nearai", configured: true }] as ProviderProfile[],
    {
      nearai: { status: "ready", models: ["private-model-a"], metadata: { "private-model-a": { id: "private-model-a", privacy_mode: "private_tee", verifiable: true } } },
      "nearai-2": { status: "ready", models: ["private-model-b"], metadata: { "private-model-b": { id: "private-model-b", privacy_mode: "private_tee", verifiable: true } } }
    }
  )).toBe(true);
  expect(secureInferenceTargetSelected(
    [{ providerId: "nearai", modelId: "openai/gpt-4.1-mini" }],
    [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile],
    { nearai: { status: "ready", models: ["openai/gpt-4.1-mini"], metadata: { "openai/gpt-4.1-mini": { id: "openai/gpt-4.1-mini", privacy_mode: "incognito", verifiable: false } } } }
  )).toBe(false);
  expect(secureInferenceTargetSelected(
    [{ providerId: "nearai", modelId: "moonshotai/kimi-k2.5" }],
    [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile],
    { nearai: { status: "ready", models: ["moonshotai/kimi-k2.5"], metadata: {} } }
  )).toBe(false);
  expect(secureInferenceTargetSelected(
    [{ providerId: "nearai", modelId: "private-model" }, { providerId: "other", modelId: "model" }],
    [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile]
  )).toBe(false);
  expect(secureInferenceTargetSelected(
    [{ providerId: "other", modelId: "model" }],
    [{ id: "other", kind: "openai_compatible", configured: true } as ProviderProfile]
  )).toBe(false);
  expect(nearAISelectionPresent(
    [{ providerId: "nearai", modelId: "private-model" }, { providerId: "other", modelId: "model" }],
    [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile, { id: "other", kind: "openai_compatible", configured: true } as ProviderProfile]
  )).toBe(true);
  expect(secureInferenceTargetSelected(
    [{ providerId: "nearai", modelId: "moonshotai/kimi-k3" }],
    [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile],
    { nearai: { status: "ready", models: ["moonshotai/kimi-k3"], metadata: { "moonshotai/kimi-k3": { id: "moonshotai/kimi-k3", privacy_mode: "chutes", verifiable: false } } } }
  )).toBe(false);
  expect(verifiedInferenceTargetSelected(
    [{ providerId: "nearai", modelId: "openai/gpt-4.1-mini" }],
    [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile],
    { nearai: { status: "ready", models: ["openai/gpt-4.1-mini"], metadata: { "openai/gpt-4.1-mini": { id: "openai/gpt-4.1-mini", privacy_mode: "incognito", verifiable: false } } } }
  )).toBe(true);
  expect(verifiedInferenceTargetSelected(
    [{ providerId: "nearai", modelId: "moonshotai/kimi-k3" }],
    [{ id: "nearai", kind: "nearai", configured: true } as ProviderProfile],
    { nearai: { status: "ready", models: ["moonshotai/kimi-k3"], metadata: { "moonshotai/kimi-k3": { id: "moonshotai/kimi-k3", privacy_mode: "chutes", verifiable: false } } } }
  )).toBe(true);
});

test("verification lanes keep Gateway signatures distinct from model TEE proof", () => {
  const privateTee = { status: "verified_model" as const, signature_kind: "provider_tee" as const, lanes: { gateway: "verified" as const, model: "verified" as const, response: "verified" as const } };
  const incognito = { status: "verified_gateway" as const, signature_kind: "gateway" as const, lanes: { gateway: "verified" as const, response: "verified" as const } };
  const mixed = { status: "verified_gateway" as const, signature_kind: "gateway" as const, lanes: { gateway: "verified" as const, model: "failed" as const, response: "verified" as const } };
  const environmentFailed = { status: "failed" as const, failure_code: "environment_verification_failed", lanes: { gateway: "failed" as const, response: "failed" as const } };
  const responseFailed = { status: "failed" as const, failure_code: "response_verification_failed", lanes: { gateway: "verified" as const, response: "failed" as const } };
  const pendingModel = { status: "verified_model" as const, lanes: { gateway: "verified" as const, model: "pending" as const, response: "pending" as const } };
  expect(verificationLaneStatus("gateway", privateTee, "private_tee")).toBe("verified");
  expect(verificationLaneStatus("model", privateTee, "private_tee")).toBe("verified");
  expect(verificationLaneStatus("response", privateTee, "private_tee")).toBe("verified");
  expect(verificationLaneStatus("gateway", incognito, "incognito")).toBe("verified");
  expect(verificationLaneStatus("model", incognito, "incognito")).toBe("failed");
  expect(verificationLaneStatus("response", incognito, "incognito")).toBe("verified");
  expect(verificationLaneStatus("model", incognito, "chutes")).toBe("failed");
  expect(verificationLaneStatus("model", mixed, "private_tee")).toBe("failed");
  expect(verificationLaneStatus("gateway", environmentFailed, "chutes")).toBe("failed");
  expect(verificationLaneStatus("gateway", responseFailed, "incognito")).toBe("verified");
  expect(verificationLaneStatus("response", responseFailed, "incognito")).toBe("failed");
  expect(verificationLaneStatus("model", pendingModel, "private_tee")).toBe("pending");
  expect(verificationLaneStatus("model", responseFailed, "chutes")).toBe("failed");
  expect(verificationLaneStatus("response", { status: "failed", failure_code: "response_verification_failed", lanes: { gateway: "failed", response: "verified" } }, "incognito")).toBe("verified");
});

test("conversation workspace gives an empty state a direct create action", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={undefined}
      titleDraft=""
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      onCreateConversation={() => {}}
    />
  );

  expect(markup).toContain("Start a new conversation");
  expect(markup).toContain('data-workspace-empty="true"');
});

test("new conversation opens with a private assistant welcome and suggested prompts", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "New conversation",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: []
  };

  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={view}
      titleDraft="New conversation"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      onSend={() => {}}
      onDraftChange={() => {}}
    />
  );

  expect(markup).toContain("Your conversation");
  expect(markup).toContain("Prompts and selected conversation context go to your Provider");
  expect(markup).toContain("Suggested");
  expect(markup).toContain("Write the letter");
});

test("pre-submit privacy copy discloses selected context for legacy locale preferences", () => {
  for (const [locale, context] of [["en", "selected context"], ["zh", "selected context"], ["ja", "selected context"]] as const) {
    const copy = applicationMessages(locale);
    expect(copy.composerFoot).toContain(context);
    expect(copy.composerFoot).toContain("Provider");
  }
});

test("new conversation keeps the NearAI empty state free of conversation title controls", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "New conversation",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: []
  };

  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={view}
      titleDraft="New conversation"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      onSend={() => {}}
      onDraftChange={() => {}}
    />
  );

  expect(markup).toContain('data-workspace-empty="true"');
  expect(markup).toContain("Your conversation");
  expect(markup).not.toContain("Rename conversation");
  expect(markup).not.toContain("Save title");
});

test("an archived conversation is readable but cannot start another Generation", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1", title: "Archived notes", archived: true,
        created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z",
        messages: [{ id: "message-1", conversation_id: "conversation-1", role: "user", body: "Keep this", created_at: "2026-09-10T00:00:00Z" }]
      }}
      titleDraft="Archived notes"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      onSend={() => {}}
      onDraftChange={() => {}}
    />
  );

  expect(markup).toContain("This conversation is archived. Unarchive it to continue chatting.");
  expect(markup).not.toContain("generation-composer");
});

test("conversation panel uses the NearAI message layout and metadata chrome", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Number sequence",
        created_at: "2026-09-10T21:10:00Z",
        updated_at: "2026-09-10T21:10:00Z",
        messages: [
          {
            id: "message-1",
            conversation_id: "conversation-1",
            role: "user",
            body: "123123",
            created_at: "2026-09-10T21:10:00Z"
          },
          {
            id: "message-2",
            conversation_id: "conversation-1",
            role: "assistant",
            body: "I see you sent 123123.",
            provider_snapshot: {
              provider_id: "provider-1",
              provider_name: "Free model",
              model_id: "free-model",
              runtime_location: "Configured provider",
              destination: "provider.example",
              transport_security: "tls",
              privacy_notice: "Sent over HTTPS/TLS."
            },
            created_at: "2026-09-10T21:10:00Z"
          }
        ]
      }}
      titleDraft="Number sequence"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
    />
  );

  expect(markup).toContain('data-workspace-chat-style="nearai"');
  expect(markup).toContain('data-message-meta="user"');
  expect(markup).toContain('data-message-meta="assistant"');
  expect(markup).toContain('class="message__timestamp"');
  expect(markup).toContain("Free model");
  expect(markup).toContain("Provider Snapshot");
  expect(markup).toContain('<details class="message__snapshot">');
});

test("conversation panel exposes a compact NearAI composer surface", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{ id: "conversation-1", title: "New conversation", created_at: "2026-09-10T21:10:00Z", updated_at: "2026-09-10T21:10:00Z", messages: [] }}
      titleDraft="New conversation"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      onSend={() => {}}
      onDraftChange={() => {}}
      providerStatus="ready"
    />
  );

  expect(markup).toContain('data-workspace-chat-style="nearai"');
  expect(markup).toContain('data-composer-style="nearai"');
  expect(markup).toContain('aria-label="Conversation messages"');
  expect(markup).toContain('aria-label="Send message"');
});

test("assistant messages render basic Markdown without raw HTML or remote images", () => {
  const markup = renderToStaticMarkup(
    <MarkdownMessage content={'## Heading\n\n**bold** and `code`\n\n<script>alert("x")</script>\n\n![remote image](https://example.com/image.png)'} />
  );

  expect(markup).toContain("<h2>Heading</h2>");
  expect(markup).toContain("<strong>bold</strong>");
  expect(markup).toContain("<code>code</code>");
  expect(markup).not.toContain("<script>");
  expect(markup).not.toContain("<img");
  expect(markup).toContain("remote image");
});

test("composer submits on Enter but preserves newlines and IME composition", () => {
  expect(shouldSubmitComposerKey({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
  expect(shouldSubmitComposerKey({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
  expect(shouldSubmitComposerKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
});

test("workspace settings expose global system prompt and optional model parameters", () => {
  const settings: WorkspaceSettings = { theme: "system", locale: "system", system_prompt: "", temperature: null, top_p: null, max_tokens: null, active_model_set: [] };
  const markup = renderToStaticMarkup(<WorkspaceSettingsPanel settings={settings} onSave={async () => {}} />);

  expect(markup).toContain("Settings");
  expect(markup).toContain('aria-label="Theme"');
  expect(markup).toContain('aria-label="Language"');
  expect(markup).toContain("Follow system");
  expect(markup).toContain("Model parameters");
  expect(markup).toContain("Temperature");
  expect(markup).toContain("Top P");
  expect(markup).toContain("Max tokens");
  expect(markup).not.toContain("maxlength");
});

test("model parameter form values retain provider defaults when blank and reject unsupported values", () => {
  expect(modelParameterFormValue(null)).toBe("");
  expect(modelParameterFormValue(0.7)).toBe("0.7");
  expect(parseModelParameters({ temperature: "0", topP: "0.95", maxTokens: "2048" })).toEqual({ temperature: 0, top_p: 0.95, max_tokens: 2048 });
  expect(parseModelParameters({ temperature: "", topP: "", maxTokens: "" })).toEqual({ temperature: null, top_p: null, max_tokens: null });
  expect(parseModelParameters({ temperature: "2.1", topP: "0.2", maxTokens: "1" })).toBeUndefined();
  expect(parseModelParameters({ temperature: "1", topP: "1.1", maxTokens: "1" })).toBeUndefined();
  expect(parseModelParameters({ temperature: "1", topP: "0.5", maxTokens: "1.5" })).toBeUndefined();
});

test("provider removal clears the active selection and settings saves preserve the current selection", () => {
  const selection = { providerId: "provider-1", modelId: "model-a" };
  const settings: WorkspaceSettings = {
    theme: "system",
    locale: "system",
    system_prompt: "Keep it concise.",
		temperature: null,
		top_p: null,
		max_tokens: null,
		active_model_set: [{ provider_id: "provider-1", model_id: "model-old" }]
  };

  expect(selectionAfterProviderRemoval(selection, "provider-1")).toEqual({ providerId: "", modelId: "" });
	expect(settingsWithActiveSelection(settings, selection)).toMatchObject({
		active_model_set: [{ provider_id: "provider-1", model_id: "model-a" }]
	});
});

test("a sole configured Provider Profile supplies the workspace default model selection", () => {
  const settings: WorkspaceSettings = { theme: "system", locale: "system", system_prompt: "", temperature: null, top_p: null, max_tokens: null, active_model_set: [] };
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
    updated_at: "2026-09-10T00:00:00Z"
  };

  expect(selectionFromWorkspaceSettings(settings, [provider])).toEqual({ providerId: "nearai", modelId: "openai/gpt-4.1-mini" });
  expect(selectionFromWorkspaceSettings({ ...settings, active_model_set: [{ provider_id: "other", model_id: "model-b" }] }, [provider])).toEqual({ providerId: "other", modelId: "model-b" });
  expect(selectionFromWorkspaceSettings(settings, [provider, { ...provider, id: "other" }])).toEqual({ providerId: "", modelId: "" });
});

test("saving a Provider Profile defaults its model without replacing another active selection", () => {
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
    updated_at: "2026-09-10T00:00:00Z"
  };

  expect(selectionAfterProviderSave({ providerId: "", modelId: "" }, provider)).toEqual({ providerId: "nearai", modelId: "openai/gpt-4.1-mini" });
  expect(selectionAfterProviderSave({ providerId: "nearai", modelId: "old-model" }, provider)).toEqual({ providerId: "nearai", modelId: "openai/gpt-4.1-mini" });
  expect(selectionAfterProviderSave({ providerId: "other", modelId: "model-b" }, provider)).toEqual({ providerId: "other", modelId: "model-b" });
  expect(selectionAfterProviderSave({ providerId: "", modelId: "" }, { ...provider, configured: false })).toEqual({ providerId: "", modelId: "" });
});

test("chat workspace explains the clear scope before offering the destructive action", () => {
  const markup = renderToStaticMarkup(<ChatDataPanel onClear={() => {}} />);

  expect(markup).toContain("Clear chat data");
  expect(markup).toContain("Deletes all local conversations, messages, Generations, and Provider Snapshots.");
  expect(markup).toContain("Provider Profiles, workspace settings, and saved Provider Keys are kept.");
  expect(markup).toContain("data-stats");
  expect(markup).toContain("JSON");
  expect(markup).toContain("Markdown");
  expect(markup).toContain("all active and archived conversations");
});

test("settings dialog content exposes General, Provider, and Chat Data sections", () => {
  const markup = renderToStaticMarkup(
    <SettingsDialogContent>
      <section data-settings-section="general"><h3>General</h3></section>
      <section data-settings-section="provider"><h3>Provider settings</h3></section>
      <section data-settings-section="chat-data"><h3>Chat data</h3></section>
    </SettingsDialogContent>
  );

  expect(markup).toContain("Settings");
  expect(markup).toContain('data-settings-section="general"');
  expect(markup).toContain('data-settings-section="provider"');
  expect(markup).toContain('data-settings-section="chat-data"');
  expect(markup).toContain('aria-label="Close settings"');
});

test("settings dialog uses a left-hand selector and one active content panel", () => {
  const markup = renderToStaticMarkup(
    <SettingsDialogContent>
      <section data-settings-section="general"><h3>General</h3></section>
      <section data-settings-section="provider"><h3>Provider settings</h3></section>
      <section data-settings-section="chat-data"><h3>Chat data</h3></section>
    </SettingsDialogContent>
  );

  expect(markup).toContain('class="settings-dialog__content"');
  expect(markup).toContain('data-active-settings-section="general"');
  expect(markup).toContain('aria-pressed="true"');
  expect(markup).not.toContain('href="#settings-general"');
});

test("chat data settings exposes a delete action for each conversation", () => {
  const conversations: Conversation[] = [{
    id: "conversation-1",
    title: "Keep locally",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z"
  }];

  const markup = renderToStaticMarkup(
    <ChatDataPanel conversations={conversations} onDelete={() => {}} onClear={() => {}} />
  );

  expect(markup).toContain('aria-label="Delete: Keep locally"');
});

test("system prompt limit counts Unicode characters rather than UTF-16 code units", () => {
  expect(isSystemPromptWithinLimit("😀".repeat(8192))).toBe(true);
  expect(isSystemPromptWithinLimit("😀".repeat(8193))).toBe(false);
});

test("conversation workspace offers generation controls and shows the assistant provider snapshot", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "Offline chat",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: [{
      id: "message-1",
      conversation_id: "conversation-1",
      role: "assistant",
      body: "Hello from the Provider",
      provider_snapshot: {
        provider_id: "provider-1",
        provider_name: "Fixture Provider",
        model_id: "model-a",
        runtime_location: "User configured cloud provider",
        destination: "provider.example",
        transport_security: "tls",
        privacy_notice: "Sent over HTTPS/TLS."
      },
      created_at: "2026-09-10T00:00:00Z"
    }]
  };
  const generation: Generation = {
    id: "generation-1",
    conversation_id: view.id,
    client_request_id: "request-1",
    user_message_id: "message-2",
    state: "streaming",
    snapshot: view.messages[0].provider_snapshot!,
    configuration_snapshot: fixtureGenerationConfiguration,
    events_url: "/api/generations/generation-1/events",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z"
  };

  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={view}
      titleDraft="Offline chat"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      onSend={() => {}}
      onCancel={() => {}}
      onRetry={() => {}}
      generation={generation}
      draft="Partial reply"
      onDraftChange={() => {}}
      isSending={true}
    />
  );

  expect(markup).toContain("Send message");
  expect(markup).toContain("Stop generation");
  expect(markup).toContain("Fixture Provider");
  expect(markup).toContain("provider-1");
  expect(markup).toContain("model-a");
  expect(markup).toContain("User configured cloud provider");
  expect(markup).toContain("Partial reply");
  expect(markup).toContain('class="chat-status-live"');
  expect(markup).toContain("Provider Snapshot");
});

test("conversation workspace keeps a live assistant reply inside the scrollable message region", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "Offline chat",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: []
  };
  const generation: Generation = {
    id: "generation-1",
    conversation_id: view.id,
    client_request_id: "request-1",
    user_message_id: "message-1",
    state: "streaming",
    snapshot: {
      provider_id: "provider-1",
      provider_name: "Fixture Provider",
      model_id: "model-a",
      runtime_location: "User configured cloud provider",
      destination: "provider.example",
      transport_security: "tls",
      privacy_notice: "Sent over HTTPS/TLS."
    },
    configuration_snapshot: fixtureGenerationConfiguration,
    events_url: "/api/generations/generation-1/events",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z"
  };

  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={view}
      titleDraft="Offline chat"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      generation={generation}
      liveAssistantBody="Partial reply"
    />
  );
  const messageRegionStart = markup.indexOf('data-workspace-region="messages"');
  const liveAssistantReplyStart = markup.indexOf('message--live-assistant');

  expect(liveAssistantReplyStart).toBeGreaterThan(messageRegionStart);
  expect(markup.slice(messageRegionStart, liveAssistantReplyStart)).not.toContain("</div>");
  expect(markup).not.toContain("Thinking...");
});

test("conversation workspace keeps a repeated Live Turn visible until its user message ID is known", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{ id: "conversation-1", title: "Chat", created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z", messages: [{ id: "old-user", conversation_id: "conversation-1", role: "user", body: "Repeat", created_at: "2026-09-10T00:00:00Z" }] }}
      titleDraft="Chat"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      liveTurn={{ conversationId: "conversation-1", clientRequestId: "request-2", userBody: "Repeat", assistantBody: "", phase: "pending" }}
    />
  );

  expect((markup.match(/Repeat/g) ?? []).length).toBe(2);
});

test("conversation workspace renders a Live Turn before generation creation resolves", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{ id: "conversation-1", title: "New conversation", created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z", messages: [] }}
      titleDraft="New conversation"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      liveTurn={{ conversationId: "conversation-1", clientRequestId: "request-1", userBody: "Immediate message", assistantBody: "", phase: "pending" }}
      onSend={() => {}}
      onDraftChange={() => {}}
    />
  );

  expect(markup).toContain("Immediate message");
  expect(markup).toContain("Thinking...");
  expect(markup).not.toContain("Chat with your local assistant");
});

test("conversation workspace keeps thinking visible while streaming has no assistant content yet", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{ id: "conversation-1", title: "Chat", created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z", messages: [] }}
      titleDraft="Chat"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      generation={{
        id: "generation-1",
        conversation_id: "conversation-1",
        client_request_id: "request-1",
        state: "streaming",
        snapshot: { provider_id: "provider-1", provider_name: "Fixture", model_id: "model-a", runtime_location: "local", destination: "local", transport_security: "tls", privacy_notice: "notice" },
        configuration_snapshot: fixtureGenerationConfiguration,
        events_url: "/api/generations/generation-1/events",
        created_at: "2026-09-10T00:00:00Z",
        updated_at: "2026-09-10T00:00:00Z"
      }}
      liveTurn={{ conversationId: "conversation-1", clientRequestId: "request-1", userBody: "Hello", assistantBody: "", phase: "streaming" }}
    />
  );

  expect(markup).toContain("Thinking...");
  expect(markup).not.toContain("data-secure-generation-progress");
});

test("conversation workspace shows the real private verification stages for one live Generation", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{ id: "conversation-1", title: "Private chat", created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z", messages: [] }}
      titleDraft="Private chat"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      generation={{
        id: "generation-private",
        conversation_id: "conversation-1",
        client_request_id: "request-private",
        user_message_id: "message-private",
        state: "verifying_environment",
        snapshot: { provider_id: "nearai", provider_name: "NearAI", model_id: "private-model", runtime_location: "NearAI cloud", destination: "cloud-api.near.ai", transport_security: "tls", privacy_notice: "Private inference." },
        configuration_snapshot: fixtureGenerationConfiguration,
        verification: { status: "pending" },
        events_url: "/api/generations/generation-private/events",
        created_at: "2026-09-10T00:00:00Z",
        updated_at: "2026-09-10T00:00:00Z"
      }}
      liveTurn={{ conversationId: "conversation-1", clientRequestId: "request-private", userBody: "Verify this", assistantBody: "", phase: "verifying_environment" }}
    />
  );

  expect(markup).toContain('data-secure-generation-progress="verifying_environment"');
  expect(markup).toContain("Checking gateway and model hardware identity...");
  expect(markup).toContain("Gateway and model identity");
  expect(markup).toContain("End-to-end encrypted path");
  expect(markup).toContain("Signed model response");
  expect(markup).not.toContain("Thinking...");
});

test("conversation workspace gives an unconfigured Provider a setup entry point", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={undefined}
      titleDraft=""
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      providerStatus="unconfigured"
    />
  );

  expect(markup).toContain("Configure a Provider key before sending.");
  expect(markup).toContain('href="#provider-settings"');
});

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
    updated_at: "2026-09-10T00:00:00Z"
  };
  const catalog = {
    status: "ready" as const,
    models: ["Qwen/Qwen3.8-27B", "openai/gpt-4.1-mini", "moonshotai/kimi-k3"],
    metadata: {
      "Qwen/Qwen3.8-27B": { id: "Qwen/Qwen3.8-27B", privacy_mode: "private_tee" as const, verifiable: true },
      "openai/gpt-4.1-mini": { id: "openai/gpt-4.1-mini", privacy_mode: "incognito" as const, verifiable: false },
      "moonshotai/kimi-k3": { id: "moonshotai/kimi-k3", privacy_mode: "chutes" as const, verifiable: false }
    }
  };
  for (const [modelId, mode, label] of [
    ["Qwen/Qwen3.8-27B", "private_tee", "Private TEE"],
    ["openai/gpt-4.1-mini", "incognito", "Incognito"],
    ["moonshotai/kimi-k3", "chutes", "Chutes"]
  ] as const) {
    const markup = renderToStaticMarkup(
      <ModelSelector
        profiles={[profile]}
        activeProviderId="nearai"
        activeModelId={modelId}
        catalog={catalog}
        onProviderChange={() => {}}
        onModelChange={() => {}}
      />
    );
    expect(markup).toContain(`data-privacy-mode="${mode}"`);
    expect(markup).toContain(label);
  }
});

test("model selector shows the active Provider and model catalog state", () => {
  const markup = renderToStaticMarkup(
    <ModelSelector
      profiles={[{
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
        updated_at: "2026-09-10T00:00:00Z"
      }]}
      activeProviderId="provider-1"
      activeModelId="model-b"
      catalog={{ status: "ready", models: ["model-a", "model-b"] }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
    />
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
      updated_at: "2026-09-10T00:00:00Z"
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
      updated_at: "2026-09-10T00:00:00Z"
    }
  ];
  profiles.push({
    ...profiles[1],
    id: "provider-3",
    name: "Cetus",
    endpoint: "https://cetus.example",
    model_id: "cetus-1",
    destination: "cetus.example"
  });
  const markup = renderToStaticMarkup(
    <ModelSelector
      profiles={profiles}
      activeProviderId="provider-1"
      activeModelId="atlas-1"
      activeModelSet={[
        { providerId: "provider-1", modelId: "atlas-1" },
        { providerId: "provider-2", modelId: "boreal-3" }
      ]}
      catalog={{ status: "ready", models: ["atlas-1"] }}
			catalogs={{
				"provider-1": { status: "ready", models: ["atlas-1", "atlas-2"] },
				"provider-2": { status: "ready", models: ["boreal-2", "boreal-3"] },
				"provider-3": { status: "ready", models: ["cetus-1", "cetus-2"] }
			}}
      onProviderChange={() => {}}
      onModelChange={() => {}}
			onTargetModelChange={() => {}}
      onAddModel={() => {}}
      onRemoveModel={() => {}}
    />
  );

  expect(markup).toContain('class="model-selector__comparison"');
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toMatch(/model-selector__comparison[^>]*hidden=""/);
  expect(markup).toContain('class="model-selector__chip-provider">Atlas');
  expect(markup).toContain('class="model-selector__chip-provider">Boreal');
  expect(markup).toContain('aria-label="Model: Atlas atlas-1"');
  expect(markup).toContain('aria-label="Model: Boreal boreal-3"');
  expect(markup).toContain("model-selector__chip-model-select");
  expect(markup).toContain('aria-label="Remove model: Atlas atlas-1"');
  expect(markup).toContain("model-selector__add-menu");
  expect(markup).toContain("Search models");
  expect(markup).toContain("model-selector__add-button");
});

test("a model target cannot be changed to another card's Provider and model combination", () => {
  const targets = [
    { providerId: "provider-1", modelId: "atlas-1" },
    { providerId: "provider-1", modelId: "atlas-2" }
  ];

  expect(isDuplicateModelTarget(targets, { providerId: "provider-1", modelId: "atlas-1" }, 1)).toBe(true);
  expect(isDuplicateModelTarget(targets, { providerId: "provider-1", modelId: "atlas-3" }, 1)).toBe(false);
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
    updated_at: "2026-09-10T00:00:00Z"
  };

  expect(availableModelsForAddedTarget(profile, [{ providerId: "provider-1", modelId: "atlas-1" }], { status: "ready", models: ["atlas-1", "atlas-2", "atlas-3"] })).toEqual(["atlas-2", "atlas-3"]);
  expect(availableModelsForAddedTarget(profile, [], { status: "loading", models: [] })).toEqual([]);
});

test("model selector disables model choice while its catalog is unavailable", () => {
  const markup = renderToStaticMarkup(
    <ModelSelector
      profiles={[{
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
        updated_at: "2026-09-10T00:00:00Z"
      }]}
      activeProviderId="provider-1"
      activeModelId="model-a"
      activeModelSet={[{ providerId: "provider-1", modelId: "model-a" }]}
      catalog={{ status: "error", models: [] }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
    />
  );

  expect(markup).toContain('data-catalog-status="error"');
  expect(markup).toContain("disabled");
});

test("model selector marks a persisted model that disappeared from the catalog as invalid", () => {
  const markup = renderToStaticMarkup(
    <ModelSelector
      profiles={[{
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
        updated_at: "2026-09-10T00:00:00Z"
      }]}
      activeProviderId="provider-1"
      activeModelId="retired-model"
      catalog={{ status: "ready", models: ["model-a"] }}
      onProviderChange={() => {}}
      onModelChange={() => {}}
    />
  );

  expect(markup).toContain('data-selection-valid="false"');
  expect(markup).toContain("Selected model is no longer available");
});

test("conversation workspace explains when the Provider model catalog is unavailable", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={undefined}
      titleDraft=""
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      providerStatus="catalog-error"
    />
  );

  expect(markup).toContain("Models unavailable");
  expect(markup).toContain('data-provider-status="catalog-error"');
  expect(markup).not.toContain("Configure a Provider key before sending.");
});

test("Provider catalog query options identify one cached catalog per Provider", () => {
  const options = providerCatalogQueryOptions("provider/one");

  expect(options.queryKey).toEqual(["provider-catalog", "provider/one"]);
  expect(options.enabled).toBe(true);
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
    updated_at: "2026-09-10T00:00:00Z"
  };

  expect(providerSelectionStatus(profile, { status: "ready", models: ["model-a"] }, "")).toBe("model-required");
});

test("conversation workspace offers retry after a stopped generation", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "Offline chat",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: [{
      id: "message-1",
      conversation_id: "conversation-1",
      role: "user",
      body: "Try again",
      created_at: "2026-09-10T00:00:00Z"
    }]
  };
  const generation: Generation = {
    id: "generation-1",
    conversation_id: view.id,
    client_request_id: "request-1",
    user_message_id: "message-1",
    state: "stopped",
    snapshot: {
      provider_id: "provider-1",
      provider_name: "Fixture Provider",
      model_id: "model-a",
      runtime_location: "User configured cloud provider",
      destination: "provider.example",
      transport_security: "tls",
      privacy_notice: "Sent over HTTPS/TLS."
    },
    configuration_snapshot: fixtureGenerationConfiguration,
    events_url: "/api/generations/generation-1/events",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z"
  };

  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={view}
      titleDraft="Offline chat"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      onRetry={() => {}}
      generation={generation}
    />
  );

  expect(markup).toContain("Retry generation");
  expect(markup).toContain("User configured cloud provider");
});

test("conversation workspace explains when a Provider hits the output token limit", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1", title: "Offline chat", created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z",
        messages: [{ id: "message-1", conversation_id: "conversation-1", role: "user", body: "Try again", created_at: "2026-09-10T00:00:00Z" }]
      }}
      titleDraft="Offline chat"
      onTitleChange={() => {}}
      onRename={() => {}}
      isSaving={false}
      generation={{
        id: "generation-1", conversation_id: "conversation-1", client_request_id: "request-1", user_message_id: "message-1", state: "failed",
        error_code: "output_limit", error_message: "The Provider reached the output token limit before returning an assistant response.",
        snapshot: { provider_id: "provider-1", provider_name: "Fixture Provider", model_id: "model-a", runtime_location: "fixture", destination: "provider.example", transport_security: "tls", privacy_notice: "notice" },
        configuration_snapshot: fixtureGenerationConfiguration,
        events_url: "/api/generations/generation-1/events", created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z"
      }}
    />
  );

  expect(markup).toContain("The Provider reached the output token limit");
  expect(markup).toContain("Increase Max Tokens or leave it blank");
});

test("a Model Comparison renders one independent answer card per Generation Target", () => {
	const snapshot = {
		provider_id: "provider-a", provider_name: "Provider A", model_id: "model-a", runtime_location: "fixture", destination: "provider-a.example", transport_security: "tls" as const, privacy_notice: "fixture"
	};
	const batch = {
		id: "batch-1", conversation_id: "conversation-1", client_request_id: "request-1", state: "completed" as const,
		events_url: "/api/generation-batches/batch-1/events", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z",
		targets: [
			{ id: "target-a", provider_id: "provider-a", model_id: "model-a", position: 0, generation: { id: "generation-a", state: "completed" as const, snapshot, configuration_snapshot: fixtureGenerationConfiguration } },
			{ id: "target-b", provider_id: "provider-b", model_id: "model-b", position: 1, generation: { id: "generation-b", state: "completed" as const, snapshot: { ...snapshot, provider_id: "provider-b", provider_name: "Provider B", model_id: "model-b" }, configuration_snapshot: fixtureGenerationConfiguration } }
		]
	};
	const markup = renderToStaticMarkup(
		<ConversationPanel
			view={{ id: "conversation-1", title: "Compare", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z", messages: [] }}
			titleDraft="Compare"
			onTitleChange={() => {}}
			onRename={() => {}}
			isSaving={false}
			generationBatch={batch}
			liveTurn={{ conversationId: "conversation-1", clientRequestId: "request-1", userBody: "Compare", batchId: "batch-1", targets: [
				{ key: "target-a", targetId: "target-a", generationId: "generation-a", providerId: "provider-a", modelId: "model-a", snapshot, assistantBody: "Answer A", phase: "completed" },
				{ key: "target-b", targetId: "target-b", generationId: "generation-b", providerId: "provider-b", modelId: "model-b", snapshot: { ...snapshot, provider_id: "provider-b", provider_name: "Provider B", model_id: "model-b" }, assistantBody: "Answer B", phase: "completed" }
			] }}
			onSelectAnswer={() => {}}
			onSkipContext={() => {}}
		/>
	);

	expect(markup).toContain('data-generation-target="target-a"');
	expect(markup).toContain('data-generation-target="target-b"');
	expect(markup).toContain("model-comparison-grid");
	expect(markup).toContain('class="model-answer-card model-answer-card--completed"');
	expect(markup).toContain("Answer A");
	expect(markup).toContain("Answer B");
	expect(markup).toContain("Use for next turn");
	expect(markup).toContain("Continue without an answer");
	expect(markup).toContain('class="conversation-panel__skip-context');
	expect(markup).toContain("The Prompt · This turn");
	expect(markup).toContain("note-band");
});

test("completed comparison answers move from the Live Turn into history without duplication and remain selectable", () => {
	const snapshot = {
		provider_id: "provider-a", provider_name: "Provider A", model_id: "model-a", runtime_location: "fixture", destination: "provider-a.example", transport_security: "tls" as const, privacy_notice: "fixture"
	};
	const batch = {
		id: "batch-1", conversation_id: "conversation-1", client_request_id: "request-1", state: "completed" as const,
		events_url: "/api/generation-batches/batch-1/events", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z",
			targets: [{ id: "target-a", provider_id: "provider-a", model_id: "model-a", position: 0, generation: { id: "generation-a", state: "completed" as const, snapshot, configuration_snapshot: fixtureGenerationConfiguration, assistant_message_id: "assistant-a" } }, { id: "target-b", provider_id: "provider-b", model_id: "model-b", position: 1, generation: { id: "generation-b", state: "completed" as const, snapshot: { ...snapshot, provider_id: "provider-b", provider_name: "Provider B", model_id: "model-b" }, configuration_snapshot: fixtureGenerationConfiguration, assistant_message_id: "assistant-b" } }]
	};
	const markup = renderToStaticMarkup(
		<ConversationPanel
			view={{ id: "conversation-1", title: "Compare", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z", messages: [{ id: "user-a", conversation_id: "conversation-1", role: "user", body: "Compare", created_at: "2026-09-17T00:00:00Z" }, { id: "assistant-a", conversation_id: "conversation-1", role: "assistant", body: "Answer A", provider_snapshot: snapshot, created_at: "2026-09-17T00:00:01Z" }, { id: "assistant-b", conversation_id: "conversation-1", role: "assistant", body: "Answer B", provider_snapshot: { ...snapshot, provider_id: "provider-b", provider_name: "Provider B", model_id: "model-b" }, created_at: "2026-09-17T00:00:01Z" }] }}
			titleDraft="Compare"
			onTitleChange={() => {}}
			onRename={() => {}}
			isSaving={false}
			generationBatches={[batch]}
			liveTurn={{ conversationId: "conversation-1", clientRequestId: "request-1", userBody: "Compare", userMessageId: "user-a", batchId: "batch-1", targets: [{ key: "target-a", targetId: "target-a", generationId: "generation-a", assistantMessageId: "assistant-a", providerId: "provider-a", modelId: "model-a", snapshot, assistantBody: "Answer A", phase: "completed" }, { key: "target-b", targetId: "target-b", generationId: "generation-b", assistantMessageId: "assistant-b", providerId: "provider-b", modelId: "model-b", snapshot: { ...snapshot, provider_id: "provider-b", provider_name: "Provider B", model_id: "model-b" }, assistantBody: "Answer B", phase: "completed" }] }}
			onSelectAnswer={() => {}}
		/>
	);

	expect(markup.match(/Answer A/g)).toHaveLength(1);
	expect(markup.match(/Answer B/g)).toHaveLength(1);
	expect(markup).toContain("Use for next turn");
});

test("a historical Model Comparison retains the selected answer after its context is frozen", () => {
	const snapshot = { provider_id: "provider-a", provider_name: "Provider A", model_id: "model-a", runtime_location: "fixture", destination: "provider-a.example", transport_security: "tls" as const, privacy_notice: "fixture" };
	const batch = {
		id: "batch-1", conversation_id: "conversation-1", client_request_id: "request-1", state: "completed" as const,
		selected_generation_id: "generation-b", context_frozen: true,
		events_url: "/api/generation-batches/batch-1/events", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z",
		targets: [
			{ id: "target-a", provider_id: "provider-a", model_id: "model-a", position: 0, generation: { id: "generation-a", state: "completed" as const, snapshot, configuration_snapshot: fixtureGenerationConfiguration, assistant_message_id: "assistant-a" } },
			{ id: "target-b", provider_id: "provider-b", model_id: "model-b", position: 1, generation: { id: "generation-b", state: "completed" as const, snapshot: { ...snapshot, provider_id: "provider-b", provider_name: "Provider B", model_id: "model-b" }, configuration_snapshot: fixtureGenerationConfiguration, assistant_message_id: "assistant-b" } }
		]
	};
	const markup = renderToStaticMarkup(
		<ConversationPanel
			view={{ id: "conversation-1", title: "Compare", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z", messages: [{ id: "assistant-a", conversation_id: "conversation-1", role: "assistant", body: "Answer A", provider_snapshot: snapshot, created_at: "2026-09-17T00:00:01Z" }, { id: "assistant-b", conversation_id: "conversation-1", role: "assistant", body: "Answer B", provider_snapshot: { ...snapshot, provider_id: "provider-b", provider_name: "Provider B", model_id: "model-b" }, created_at: "2026-09-17T00:00:01Z" }] }}
			titleDraft="Compare"
			onTitleChange={() => {}}
			onRename={() => {}}
			isSaving={false}
			generationBatches={[batch]}
		/>
	);

	expect(markup).toContain('data-generation-target="target-b"');
	expect(markup).toContain("model-answer-card--selected");
	expect(markup).toContain("Selected for context");
});

test("a streaming target card offers an individual stop action", () => {
	const snapshot = { provider_id: "provider-a", provider_name: "Provider A", model_id: "model-a", runtime_location: "fixture", destination: "provider-a.example", transport_security: "tls" as const, privacy_notice: "fixture" };
	const batch = { id: "batch-1", conversation_id: "conversation-1", client_request_id: "request-1", state: "streaming" as const, events_url: "/api/generation-batches/batch-1/events", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z", targets: [{ id: "target-a", provider_id: "provider-a", model_id: "model-a", position: 0, generation: { id: "generation-a", state: "streaming" as const, snapshot, configuration_snapshot: fixtureGenerationConfiguration } }] };
	const markup = renderToStaticMarkup(<ConversationPanel view={{ id: "conversation-1", title: "Compare", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z", messages: [] }} titleDraft="Compare" onTitleChange={() => {}} onRename={() => {}} isSaving={false} generationBatch={batch} liveTurn={{ conversationId: "conversation-1", clientRequestId: "request-1", userBody: "Compare", batchId: "batch-1", targets: [{ key: "target-a", targetId: "target-a", generationId: "generation-a", providerId: "provider-a", modelId: "model-a", snapshot, assistantBody: "", phase: "streaming" }] }} onCancelTarget={() => {}} />);

	expect(markup).toContain("Stop generation");
});

test("assistant history shows Gateway, model, and response verification lanes", () => {
  const snapshot = { provider_id: "nearai", provider_name: "NearAI", model_id: "private-model", runtime_location: "TEE", destination: "nearai", transport_security: "tls" as const, privacy_notice: "fixture", privacy_mode: "private_tee" as const };
  const catalogs = {
    nearai: {
      status: "ready" as const,
      models: ["private-model", "openai/gpt-4.1-mini", "moonshotai/kimi-k3"],
      metadata: {
        "private-model": { id: "private-model", privacy_mode: "private_tee" as const, verifiable: true },
        "openai/gpt-4.1-mini": { id: "openai/gpt-4.1-mini", privacy_mode: "incognito" as const, verifiable: false },
        "moonshotai/kimi-k3": { id: "moonshotai/kimi-k3", privacy_mode: "chutes" as const, verifiable: false }
      }
    }
  };
  const privateBatch = {
    id: "batch-private", conversation_id: "conversation-1", client_request_id: "request-private", state: "completed" as const,
    events_url: "/api/generation-batches/batch-private/events", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z",
    targets: [{ id: "target-private", provider_id: "nearai", model_id: "private-model", position: 0, generation: { id: "generation-private", state: "completed" as const, snapshot, configuration_snapshot: fixtureGenerationConfiguration, assistant_message_id: "assistant-private", verification: { status: "verified_model" as const, signature_kind: "provider_tee" as const, lanes: { gateway: "verified" as const, model: "verified" as const, response: "verified" as const } } } }]
  };
  const privateMarkup = renderToStaticMarkup(<ConversationPanel view={{ id: "conversation-1", title: "Private", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z", messages: [{ id: "assistant-private", conversation_id: "conversation-1", role: "assistant", body: "TEE answer", provider_snapshot: snapshot, created_at: "2026-09-17T00:00:01Z" }] }} titleDraft="Private" onTitleChange={() => {}} onRename={() => {}} isSaving={false} generationBatches={[privateBatch]} catalogs={catalogs} />);
  expect(privateMarkup).toContain('data-verification-lane="gateway"');
  expect(privateMarkup).toContain('data-verification-lane="model"');
  expect(privateMarkup).toContain('data-verification-lane="response"');
  expect(privateMarkup).toContain('data-verification-lane="model" data-status="verified"');
  expect(privateMarkup).toContain("Response Verification");

  const incognitoSnapshot = { ...snapshot, model_id: "openai/gpt-4.1-mini", privacy_mode: "incognito" as const };
  const incognitoBatch = {
    id: "batch-incognito", conversation_id: "conversation-1", client_request_id: "request-incognito", state: "completed" as const,
    events_url: "/api/generation-batches/batch-incognito/events", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z",
    targets: [{ id: "target-incognito", provider_id: "nearai", model_id: "openai/gpt-4.1-mini", position: 0, generation: { id: "generation-incognito", state: "completed" as const, snapshot: incognitoSnapshot, configuration_snapshot: fixtureGenerationConfiguration, assistant_message_id: "assistant-incognito", verification: { status: "verified_gateway" as const, signature_kind: "gateway" as const, lanes: { gateway: "verified" as const, response: "verified" as const } } } }]
  };
  const incognitoMarkup = renderToStaticMarkup(<ConversationPanel view={{ id: "conversation-1", title: "Incognito", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z", messages: [{ id: "assistant-incognito", conversation_id: "conversation-1", role: "assistant", body: "Gateway answer", provider_snapshot: incognitoSnapshot, created_at: "2026-09-17T00:00:01Z" }] }} titleDraft="Incognito" onTitleChange={() => {}} onRename={() => {}} isSaving={false} generationBatches={[incognitoBatch]} catalogs={catalogs} privateMode={false} />);
  expect(incognitoMarkup).not.toContain('data-verification-lane="model"');
  expect(incognitoMarkup).toContain('data-verification-lane="gateway" data-status="verified"');
  expect(incognitoMarkup).toContain('data-verification-lane="response" data-status="verified"');
  expect(incognitoMarkup).not.toContain("Private mode");

  const chutesSnapshot = { ...snapshot, model_id: "moonshotai/kimi-k3", privacy_mode: "chutes" as const };
  const chutesBatch = {
    id: "batch-chutes", conversation_id: "conversation-1", client_request_id: "request-chutes", state: "completed" as const,
    events_url: "/api/generation-batches/batch-chutes/events", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z",
    targets: [{ id: "target-chutes", provider_id: "nearai", model_id: "moonshotai/kimi-k3", position: 0, generation: { id: "generation-chutes", state: "completed" as const, snapshot: chutesSnapshot, configuration_snapshot: fixtureGenerationConfiguration, assistant_message_id: "assistant-chutes", verification: { status: "failed" as const, failure_code: "response_verification_failed", lanes: { gateway: "verified" as const, response: "failed" as const } } } }]
  };
  const chutesMarkup = renderToStaticMarkup(<ConversationPanel view={{ id: "conversation-1", title: "Chutes", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z", messages: [{ id: "assistant-chutes", conversation_id: "conversation-1", role: "assistant", body: "Unverified Chutes answer", provider_snapshot: chutesSnapshot, created_at: "2026-09-17T00:00:01Z" }] }} titleDraft="Chutes" onTitleChange={() => {}} onRename={() => {}} isSaving={false} generationBatches={[chutesBatch]} catalogs={catalogs} privateMode={false} />);
  expect(chutesMarkup).toContain("Unverified Chutes answer");
  expect(chutesMarkup).not.toContain('data-verification-lane="model"');
  expect(chutesMarkup).toContain('data-verification-lane="gateway" data-status="verified"');
  expect(chutesMarkup).toContain('data-verification-lane="response" data-status="failed"');
});


test("historical verification lanes follow the saved snapshot, not the live catalog", () => {
  const snapshot = { provider_id: "nearai", provider_name: "NearAI", model_id: "openai/gpt-4.1-mini", runtime_location: "TEE", destination: "nearai", transport_security: "tls" as const, privacy_notice: "fixture", privacy_mode: "incognito" as const };
  const catalogs = {
    nearai: {
      status: "ready" as const,
      models: ["openai/gpt-4.1-mini"],
      metadata: { "openai/gpt-4.1-mini": { id: "openai/gpt-4.1-mini", privacy_mode: "private_tee" as const, verifiable: true } }
    }
  };
  const batch = {
    id: "batch-history", conversation_id: "conversation-1", client_request_id: "request-history", state: "completed" as const,
    events_url: "/api/generation-batches/batch-history/events", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z",
    targets: [{ id: "target-history", provider_id: "nearai", model_id: "openai/gpt-4.1-mini", position: 0, generation: { id: "generation-history", state: "completed" as const, snapshot, configuration_snapshot: fixtureGenerationConfiguration, assistant_message_id: "assistant-history", verification: { status: "verified_gateway" as const, signature_kind: "gateway" as const, lanes: { gateway: "verified" as const, response: "verified" as const } } } }]
  };
  const markup = renderToStaticMarkup(<ConversationPanel view={{ id: "conversation-1", title: "History", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z", messages: [{ id: "assistant-history", conversation_id: "conversation-1", role: "assistant", body: "Saved gateway answer", provider_snapshot: snapshot, created_at: "2026-09-17T00:00:01Z" }] }} titleDraft="History" onTitleChange={() => {}} onRename={() => {}} isSaving={false} generationBatches={[batch]} catalogs={catalogs} />);
  expect(markup).not.toContain('data-verification-lane="model"');
  expect(markup).toContain('data-verification-lane="gateway" data-status="verified"');
  expect(markup).toContain('data-verification-lane="response" data-status="verified"');
});

test("verified private history exposes model evidence details and a safe re-verification action", () => {
  const snapshot = { provider_id: "nearai", provider_name: "NearAI", model_id: "private-model", runtime_location: "TEE", destination: "nearai", transport_security: "tls" as const, privacy_notice: "fixture" };
  const batch = {
    id: "batch-1", conversation_id: "conversation-1", client_request_id: "request-1", state: "completed" as const,
    events_url: "/api/generation-batches/batch-1/events", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z",
    targets: [{ id: "target-a", provider_id: "nearai", model_id: "private-model", position: 0, generation: { id: "generation-a", state: "completed" as const, snapshot, configuration_snapshot: fixtureGenerationConfiguration, assistant_message_id: "assistant-a", verification: { status: "verified_model" as const, evidence: { kind: "model" as const, signer_address: "signer", signing_algorithm: "ed25519", tcb_status: "UpToDate", gpu_evidence: "not_provided" as const, raw: { quote: "fixture" } } } } }]
  };
  const markup = renderToStaticMarkup(<ConversationPanel view={{ id: "conversation-1", title: "Private", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z", messages: [{ id: "assistant-a", conversation_id: "conversation-1", role: "assistant", body: "Verified answer", provider_snapshot: snapshot, created_at: "2026-09-17T00:00:01Z" }] }} titleDraft="Private" onTitleChange={() => {}} onRename={() => {}} isSaving={false} generationBatches={[batch]} onVerifyAgain={() => {}} />);
  expect(markup).toContain("Model Verification");
  expect(markup).toContain("Verify Again");
});

test("a completed private answer is not rendered twice while the live target lacks its message id", () => {
  const snapshot = { provider_id: "nearai", provider_name: "NearAI", model_id: "private-model", runtime_location: "TEE", destination: "nearai", transport_security: "tls" as const, privacy_notice: "fixture" };
  const batch = {
    id: "batch-1", conversation_id: "conversation-1", client_request_id: "request-1", state: "completed" as const,
    events_url: "/api/generation-batches/batch-1/events", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z",
    targets: [{ id: "target-a", provider_id: "nearai", model_id: "private-model", position: 0, generation: { id: "generation-a", state: "completed" as const, snapshot, configuration_snapshot: fixtureGenerationConfiguration, assistant_message_id: "assistant-a" } }]
  };
  const markup = renderToStaticMarkup(<ConversationPanel
    view={{ id: "conversation-1", title: "Private", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z", messages: [{ id: "assistant-a", conversation_id: "conversation-1", role: "assistant", body: "Same answer", provider_snapshot: snapshot, created_at: "2026-09-17T00:00:01Z" }] }}
    titleDraft="Private"
    onTitleChange={() => {}}
    onRename={() => {}}
    isSaving={false}
    generationBatches={[batch]}
    liveTurn={{ conversationId: "conversation-1", clientRequestId: "request-1", userBody: "Question", batchId: "batch-1", targets: [{ key: "target-a", targetId: "target-a", generationId: "generation-a", providerId: "nearai", modelId: "private-model", snapshot, assistantBody: "Same answer", phase: "completed" }] }}
  />);

  expect(markup.match(/Same answer/g)).toHaveLength(1);
});

test("contract evidence keeps the independently verified gateway alongside model evidence", () => {
  const evidence = contractEvidenceFor({
    kind: "model",
    signerAddress: "model-signer",
    signingAlgorithm: "ed25519",
    tcbStatus: "UpToDate",
    advisoryIds: [],
    gpuEvidence: "not_provided",
    deployment: { appCompose: "fixture-compose" },
    raw: { intel_quote: "model-quote" }
  }, {
    model: {
      kind: "model",
      signerAddress: "model-signer",
      signingAlgorithm: "ed25519",
      tcbStatus: "UpToDate",
      advisoryIds: [],
      gpuEvidence: "not_provided",
      deployment: { appCompose: "fixture-compose" },
      raw: { intel_quote: "model-quote" }
    },
    gateway: {
      kind: "gateway",
      signerAddress: "gateway-signer",
      signingAlgorithm: "ed25519",
      tcbStatus: "UpToDate",
      advisoryIds: [],
      tlsBinding: "none",
      deployment: { appCompose: "fixture-compose" },
      raw: { intel_quote: "gateway-quote", nonce: "gateway-nonce" }
    }
  });

  expect(evidence.gateway?.kind).toBe("gateway");
  expect(evidence.gateway?.raw).toMatchObject({ intel_quote: "gateway-quote", nonce: "gateway-nonce" });
});

test("a successful private connection probe produces dialog evidence without a chat message", () => {
  const result = verificationEvidenceForDialog({
    status: "verified_model",
    signingKind: "provider_tee",
    evidence: {
      kind: "model",
      signerAddress: "model-signer",
      signingAlgorithm: "ed25519",
      tcbStatus: "UpToDate",
      gpuEvidence: "verified",
      advisoryIds: [],
      deployment: { appCompose: "fixture-compose" },
      raw: { intel_quote: "model-quote" }
    },
    environment: {
      model: {
        kind: "model",
        signerAddress: "model-signer",
        signingAlgorithm: "ed25519",
        tcbStatus: "UpToDate",
        gpuEvidence: "verified",
        advisoryIds: [],
        deployment: { appCompose: "fixture-compose" },
        raw: { intel_quote: "model-quote" }
      },
      gateway: {
        kind: "gateway",
        signerAddress: "gateway-signer",
        signingAlgorithm: "ed25519",
        tlsBinding: "none",
        tcbStatus: "UpToDate",
        advisoryIds: [],
        deployment: { appCompose: "fixture-compose" },
        raw: { intel_quote: "gateway-quote" }
      }
    }
  });

  expect(result?.kind).toBe("model");
  expect(result?.evidence.gateway?.signer_address).toBe("gateway-signer");
});

test("signature verification only appears for complete verified receipts and copies exact values", async () => {
  const writeText = vi.fn(async () => {});
  const verified = { status: "verified_model" as const, signature_kind: "provider_tee" as const, signing_address: "signer", signing_algorithm: "ed25519", signed_message: "signed message bytes", signature: "full signature" };
  expect(signatureVerificationAvailable(verified)).toBe(true);
  expect(signatureVerificationAvailable({ ...verified, status: "verified_gateway", signature_kind: "gateway", signing_algorithm: "ecdsa" })).toBe(true);
  expect(signatureVerificationAvailable({ ...verified, status: "failed" })).toBe(false);
  expect(signatureVerificationAvailable({ ...verified, signature: undefined })).toBe(false);
  await expect(copyVerificationValue(verified.signature, { writeText })).resolves.toBe(true);
  expect(writeText).toHaveBeenCalledWith("full signature");
});

test("verification dialog follows the unified model and gateway verification design", () => {
  const markup = renderToStaticMarkup(
    <VerificationDialogContent
      kind="model"
      providerName="NearAI"
      modelId="deepseek-ai/DeepSeek-V4-Flash"
      evidence={{
        kind: "model",
        gpu_evidence: "verified",
        tcb_status: "UpToDate",
        raw: { intel_quote: "model-quote" },
        gateway: { kind: "gateway", tls_binding: "attested", raw: { intel_quote: "gateway-quote" } }
      }}

    />
  );

  expect(markup).toContain('data-verification-dialog="model"');
  expect(markup).toContain('role="tablist"');
  expect(markup).toContain('aria-selected="true"');
  expect(markup).toContain("Private Model");
  expect(markup).toContain("deepseek-ai/DeepSeek-V4-Flash");
  expect(markup).toContain("GPU Attestation");
  expect(markup).toContain("TDX Attestation");
  expect(markup).toContain('data-verification-card="gpu"');
  expect(markup).toContain('data-verification-card="tdx"');
  expect(markup).not.toContain('data-verification-card="tdx" open');
  expect(markup).toContain("NVIDIA");
  expect(markup).toContain("intel.");
  expect(markup).toContain("Copy");
  expect(markup).not.toContain("Documentation");
  expect(markup).not.toContain("Intel TDX Explorer");
});

test("verification dialog keeps the Gateway tab available when history only has model evidence", () => {
  const markup = renderToStaticMarkup(
    <VerificationDialogContent
      kind="model"
      providerName="NearAI"
      modelId="private-model"
      evidence={{ kind: "model", gpu_evidence: "verified", raw: { intel_quote: "model-quote" } }}
      hasGatewayEvidence
    />
  );

  const gatewayTab = markup.match(/<button role="tab"[^>]*>Gateway Verification<\/button>/)?.[0];
  expect(gatewayTab).toBeDefined();
  expect(gatewayTab).not.toContain("disabled");
});

test("verification dialog switches to a saved-evidence empty state without presenting model evidence as Gateway evidence", () => {
  const markup = renderToStaticMarkup(
    <VerificationDialogContent
      kind="gateway"
      providerName="NearAI"
      evidence={undefined}
    />
  );

  expect(markup).toContain('data-verification-dialog="gateway"');
  expect(markup).toContain("No saved verification evidence is available for this tab.");
  expect(markup).not.toContain('data-verification-card="gpu"');
});

test("signature verification dialog follows the verified receipt design", () => {
  const markup = renderToStaticMarkup(
    <SignatureVerificationContent
      verification={{
        status: "verified_model",
        signature_kind: "provider_tee",
        signing_address: "0xsigner",
        signing_algorithm: "ECDSA",
        signed_message: "signed message",
        signature: "full signature"
      }}
    />
  );

  expect(markup).toContain('data-signature-verification="saved"');
  expect(markup).toContain('data-signature-status="verified"');
  expect(markup).toContain("Message Signature Verified");
  expect(markup).toContain('class="signature-dialog__fact"');
  expect(markup).toContain('class="signature-dialog__field"');
  expect(markup).toContain('class="signature-dialog__notes"');
  expect(markup).toContain('aria-label="Copy: Address"');
  expect(markup).toContain('data-signature-field="signer"');
  expect(markup).toContain('data-signature-field="signed-message"');
  expect(markup).toContain('data-signature-field="signature"');
});

test("provider settings show configuration state and keep the NearAI endpoint fixed", () => {
  const provider: ProviderProfile = {
    id: "nearai",
    kind: "nearai",
    name: "NearAI",
    endpoint: "https://cloud-stg-api.near.ai",
    model_id: "nearai/model-a",
    auth_method: "bearer",
    runtime_location: "NearAI cloud",
    destination: "cloud-stg-api.near.ai",
    transport_security: "tls",
    privacy_notice: "Conversation content is sent to NearAI cloud over HTTPS/TLS.",
    configured: false,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z"
  };

  const markup = renderToStaticMarkup(
    <ProviderSettings profiles={[provider]} onSave={async () => provider} onTest={async () => []} onDelete={async () => {}} onDeleteKey={async () => {}} />
  );

  expect(markup).toContain("Provider settings");
  expect(markup).toContain("Key not configured");
  expect(markup).toContain("https://cloud-stg-api.near.ai");
  expect(markup).toContain('type="password"');
  expect(markup).toContain("nearai/model-a");
  expect(markup).toContain("NearAI preset");
  expect(markup).toContain("spec-line");
  expect(markup).not.toContain("disabled=\"\"");
});

test("provider settings preserve distinct connection error states", () => {
  const error = (code: string) => new LocalServiceError({
    error: { code, message: "redacted", details: null, request_id: "local" }
  });

  expect(providerErrorMessage(error("service_unavailable"))).toBe("Local service unavailable");
  expect(providerErrorMessage(error("provider_unconfigured"))).toBe("Provider key is not configured");
  expect(providerErrorMessage(error("authentication_failed"))).toBe("The Provider rejected the API key");
  expect(providerErrorMessage(error("validation"))).toBe("The Provider settings are invalid");
  expect(providerErrorMessage(error("provider_unavailable"))).toBe("The Provider could not be reached");
  expect(providerErrorMessage(error("protocol_error"))).toBe("The Provider returned an invalid response");
  expect(providerErrorMessage(error("rate_limited"))).toBe("The Provider rate limited the request");
  expect(providerErrorMessage(error("unexpected"))).toBe("Provider connection failed");
  expect(providerErrorFeedback(error("authentication_failed"))).toEqual({
    text: "The Provider rejected the API key",
    tone: "error"
  });
});

test("provider test picks a verified NearAI model when none is selected", () => {
  expect(defaultModelAfterTest(["anthropic/claude-haiku-4-5", "Qwen/Qwen3.8-27B", "z-ai/glm-5.3-flash"])).toBe("Qwen/Qwen3.8-27B");
  expect(defaultModelAfterTest(["anthropic/claude-haiku-4-5"], "anthropic/claude-haiku-4-5")).toBe("anthropic/claude-haiku-4-5");
  expect(defaultModelAfterTest([])).toBe("");
});

test("provider success copy is painted green and failure copy stays signal orange", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const blocks = [...css.matchAll(/p\.provider-settings__message\.provider-settings__message--(success|error)\[role="status"\]\s*\{([^}]+)\}/g)];
  const success = blocks.find((match) => match[1] === "success")?.[2] ?? "";
  const error = blocks.find((match) => match[1] === "error")?.[2] ?? "";

  expect(success).toContain("color: #1f7a4d");
  expect(success).toContain("border-color: #1f7a4d");
  expect(success).not.toMatch(/var\(--(?:success|signal)\)/);
  expect(error).toContain("color: #e84a0f");
  expect(error).not.toContain("#1f7a4d");
});

test("saving a configured model dismisses the provider dialog", () => {
  expect(shouldDismissProviderDialog({ configured: true, model_id: "Qwen/Qwen3.8-27B" })).toBe(true);
  expect(shouldDismissProviderDialog({ configured: false, model_id: "Qwen/Qwen3.8-27B" })).toBe(false);
  expect(shouldDismissProviderDialog({ configured: true, model_id: "" })).toBe(false);
});

test("composer letterpress reset stretches the input to the prototype measure", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const block = css.slice(css.lastIndexOf("composer letterpress reset"));
  expect(block).toContain("display: flex");
  expect(block).toContain("max-width: 736px");
  expect(block).toContain("width: 100%");
  expect(block).toContain("border-radius: 0");
  expect(block).toContain("min-height: 26px");
});

test("prototype stream restore keeps the user bubble on a 736 column", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const block = css.slice(css.lastIndexOf("prototype stream restore"));
  expect(block).toContain("max-width: 736px");
  expect(block).toContain("max-width: 72%");
  expect(block).toContain("align-items: flex-end");
  expect(block).toContain("overflow-wrap: break-word");
  expect(block).toContain("word-break: normal");
  expect(block).toContain("max-width: 66ch");
  expect(block).not.toContain("overflow-wrap: anywhere");
  expect(block).not.toContain("width: fit-content");
});

test("prototype appendix restore keeps the settings layout and provider card", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const block = css.slice(css.lastIndexOf("prototype appendix restore"));
  expect(block).toContain("grid-template-columns: 230px minmax(0, 1fr)");
  expect(block).toContain("width: min(1060px, calc(100vw - 48px))");
  expect(block).toContain("width: 100%");
  expect(block).toContain(".prov {");
  expect(block).toContain("grid-template-columns: 150px minmax(0, 1fr)");
  expect(block).toContain(".prov__foot button[type=\"submit\"]");
  expect(block).toContain("color: var(--paper)");
  expect(block).toContain("background: var(--ink)");
  expect(block).toContain(".data-stats {");
  expect(block).toContain(".danger {");
  expect(block).toContain('.settings-dialog__sections > .settings-dialog__section {\n  display: none;');
  expect(block).toContain('data-active-settings-section="general"] > [data-settings-section="general"]');
});

test("system and legacy language preferences consistently render English", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    for (const [language, locale] of [["zh-CN", "zh"], ["ja-JP", "ja"], ["en-US", "en"]] as const) {
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language } });
      expect(applicationMessages("system").settings).toBe(applicationMessages(locale).settings);
    }
    expect(applicationMessages("en").settings).toBe("Settings");
    expect(applicationMessages("zh")).toEqual(applicationMessages("en"));
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("settings show the supported English interface without unavailable language controls", () => {
  const settings: WorkspaceSettings = { theme: "system", locale: "system", system_prompt: "", temperature: null, top_p: null, max_tokens: null, active_model_set: [] };
  const markup = renderToStaticMarkup(<WorkspaceSettingsPanel settings={settings} onSave={async () => {}} />);
  expect(markup).toContain('aria-label="Language"');
  expect(markup).toContain("Follow system");
  expect(markup).toContain("English");
  expect(markup).not.toContain('aria-pressed="false">Chinese');
  expect(markup).toContain("Messages and prompts can use any language");
});

test("empty workspace keeps the prototype cover and a pinned composer", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const block = css.slice(css.lastIndexOf("empty workspace restore"));
  expect(block).toContain("justify-content: flex-start");
  expect(block).toContain("flex-shrink: 0");
  expect(block).toContain("clamp(34px, 4.4vw, 50px)");
  expect(block).toContain("margin: 0 0 26px");
  expect(block).toContain("margin: 22px 0 0");
  expect(block).toContain("button.suggest");
  expect(block).toContain("border: 1px solid var(--ink)");
  expect(block).toContain("min-height: 92px");
});

test("chrome restore collapses the sidebar rail and loosens the masthead", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const block = css.slice(css.lastIndexOf("chrome restore"));
  expect(block).toContain("grid-template-columns: 64px minmax(0, 1fr)");
  expect(block).toContain("height: 64px");
  expect(block).toContain("margin-left: 0");
  expect(block).toContain("conversation-sidebar--collapsed .conversation-list-shell");
  expect(block).toContain("display: none");
  expect(block).toContain(".masthead__models");
  expect(block).toContain("grid-template-columns: none");
  expect(block).toContain("border-right: 1px solid var(--rule)");
  expect(block).toContain("overflow: visible");
});

test("model popovers stay in viewport instead of clipping or overflowing", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const block = css.slice(css.lastIndexOf("model popover restore"));
  expect(block).toContain("overflow: visible");
  expect(block).toContain("right: 0");
  expect(block).toContain("width: min(380px, calc(100vw - 48px))");
  expect(block).toContain("flex-direction: column");
  expect(block).toContain("min-width: 260px");
});

test("disabled buttons use a not-allowed cursor instead of a wait cursor", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  expect(css).toContain("button:disabled {\n  cursor: not-allowed;");
  expect(css).not.toContain("button:disabled {\n  cursor: wait;");
});

test("closed conversation menus and hidden settings panels do not intercept clicks", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const block = css.slice(css.lastIndexOf("interaction restore"));
  expect(block).toContain("pointer-events: none");
  expect(block).toContain("visibility: hidden");
  expect(block).toContain(".conversation-actions__menu[data-closed]");
  expect(block).toContain("pointer-events: auto");
});

test("prototype compare restore widens the spread to 1080", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const block = css.slice(css.lastIndexOf("prototype compare restore"));
  expect(block).toContain("max-width: 1080px");
  expect(block).toContain(".lede {");
  expect(block).toContain(".note-band {");
});

test("clear confirmation arms on the first press", () => {
  const copy = applicationMessages("en");
  expect(nextClearConfirmLabel(false, copy)).toBe("Clear chat data");
  expect(nextClearConfirmLabel(true, copy)).toBe("Click again to confirm");
});

test("comparison prompt prefers the user message before the batch", () => {
  expect(comparisonPromptForMessages([
    { id: "u1", role: "user", body: "First" },
    { id: "a1", role: "assistant", body: "A" },
    { id: "u2", role: "user", body: "Compare these" },
    { id: "a2", role: "assistant", body: "B" }
  ], ["a2"])).toBe("Compare these");
});

test("resolved theme preference maps system to a concrete edition", () => {
  expect(resolvedThemePreference("light")).toBe("light");
  expect(resolvedThemePreference("dark")).toBe("dark");
});

test("provider connection status shows the test result instead of only the saved key", () => {
  const copy = applicationMessages("en");
  expect(providerConnectionStatus("verified", false)).toBe("configured");
  expect(providerConnectionLabel("verified", false, copy)).toBe("Connection verified");
  expect(providerConnectionStatus("failed", true)).toBe("failed");
  expect(providerConnectionLabel("failed", true, copy)).toBe("Provider connection failed");
  expect(providerConnectionStatus("idle", false)).toBe("unconfigured");
  expect(providerConnectionLabel("idle", false, copy)).toBe("Key not configured");
});
