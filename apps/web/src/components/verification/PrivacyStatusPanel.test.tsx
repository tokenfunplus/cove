import { PrivacyStatusPanel } from "@/components/verification/PrivacyStatusPanel";
import {
  privacyStatusFromConversation,
  privacyStatusPresentation,
} from "@/lib/verification/privacy-status";
import { applicationMessages } from "@/messages";
import { privacyBatch, privacySnapshot } from "@/test/generation-fixture";
import type { ConversationView } from "@cove/api-contract";
import { expect, test } from "vitest";

test("privacy status is empty without a selected conversation", () => {
  expect(privacyStatusFromConversation(undefined, undefined, [])).toMatchObject(
    { status: "empty", privateModelCount: 0, verifiedAssistantMessageCount: 0 },
  );
});

test("privacy status requires persisted provider TEE evidence for confidentiality", () => {
  const modelVerification = {
    status: "verified_model" as const,
    signature_kind: "provider_tee" as const,
    evidence: {
      kind: "model" as const,
      tcb_status: "UpToDate",
      gpu_evidence: "verified" as const,
      raw: { intel_quote: "quote" },
    },
  };
  const modelBatch = privacyBatch({}, { verification: modelVerification });
  const view: ConversationView = {
    id: "conversation-1",
    title: "Private",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:01Z",
    messages: [
      {
        id: "message-nearai-private-model",
        conversation_id: "conversation-1",
        role: "assistant",
        body: "Private answer",
        provider_snapshot: privacySnapshot("nearai", "private-model"),
        created_at: "2026-09-17T00:00:01Z",
      },
    ],
    generation_batches: [modelBatch],
  };
  const summary = privacyStatusFromConversation(view, undefined, []);
  expect(summary.status).toBe("confidential");
  expect(summary.privateModelCount).toBe(1);
  expect(summary.nvidia.count).toBe(1);
  expect(summary.intel.count).toBe(1);
  expect(summary.verifiedAssistantMessageCount).toBe(1);
  expect(summary.verifiedMessages[0]).toMatchObject({
    body: "Private answer",
    modelId: "private-model",
  });

  const legacyBatch = privacyBatch(
    {},
    { verification: { ...modelVerification, signature_kind: undefined } },
  );
  expect(
    privacyStatusFromConversation(
      { ...view, generation_batches: [legacyBatch] },
      undefined,
      [],
    ).status,
  ).toBe("partial");
});

test("Gateway-only, unsupported, and mixed targets never claim confidential chat", () => {
  const gatewayBatch = privacyBatch(
    {},
    {
      providerId: "nearai",
      modelId: "private-model",
      verification: {
        status: "verified_gateway",
        signature_kind: "gateway",
        evidence: { kind: "gateway", raw: { intel_quote: "gateway" } },
      },
    },
  );
  const ordinaryBatch = privacyBatch(
    {
      state: "failed",
      error_code: "provider_unavailable",
      assistant_message_id: undefined,
    },
    {
      providerId: "ordinary",
      modelId: "public-model",
      verification: { status: "unsupported" },
    },
  );
  const view: ConversationView = {
    id: "conversation-1",
    title: "Mixed",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:01Z",
    messages: [],
    generation_batches: [gatewayBatch, ordinaryBatch],
  };
  const summary = privacyStatusFromConversation(view, undefined, []);
  expect(summary.status).toBe("partial");
  expect(summary.privateModelCount).toBe(1);
  expect(summary.verifiedAssistantMessageCount).toBe(1);
});

test("Gateway-only history is explicitly Gateway-verified, never confidential", () => {
  const batch = privacyBatch(
    {},
    {
      verification: {
        status: "verified_gateway",
        signature_kind: "gateway",
        evidence: { kind: "gateway", raw: { intel_quote: "gateway" } },
      },
    },
  );
  const view: ConversationView = {
    id: "conversation-1",
    title: "Gateway",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:01Z",
    messages: [],
    generation_batches: [batch],
  };
  expect(privacyStatusFromConversation(view, undefined, []).status).toBe(
    "gateway",
  );
});

test("privacy status panel exposes metrics, expandable verified messages, and detail actions", () => {
  const verification = {
    status: "verified_model" as const,
    signature_kind: "provider_tee" as const,
    signing_address: "signer",
    signing_algorithm: "ed25519",
    signed_message: "signed",
    signature: "signature",
    evidence: { kind: "model" as const, raw: { intel_quote: "quote" } },
  };
  const batch = privacyBatch({}, { verification });
  const view: ConversationView = {
    id: "conversation-1",
    title: "Private",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:01Z",
    messages: [
      {
        id: "message-nearai-private-model",
        conversation_id: "conversation-1",
        role: "assistant",
        body: "Saved private answer",
        provider_snapshot: privacySnapshot("nearai", "private-model"),
        created_at: "2026-09-17T00:00:01Z",
      },
    ],
    generation_batches: [batch],
  };
  const summary = privacyStatusFromConversation(view, undefined, []);
  expect(summary.status).toBe("confidential");
  expect(summary.verifiedMessages[0]?.verification.signature).toBe("signature");
  expect(PrivacyStatusPanel).toBeTypeOf("function");
});

test("privacy panel reserves attestation claims for confidential conversations", () => {
  for (const locale of ["en", "zh", "ja"] as const) {
    const copy = applicationMessages(locale);
    for (const status of [
      "empty",
      "gateway",
      "partial",
      "unverified",
    ] as const) {
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
