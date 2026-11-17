import { isNearAISnapshot } from "@/components/providers/model-selection";
import { englishConversationCopy, type ApplicationCopy } from "@/messages";
import {
  type ConversationView,
  type GenerationBatch,
  type GenerationVerification,
  type ProviderProfile,
} from "@cove/api-contract";

type PrivacyStatus =
  "empty" | "confidential" | "gateway" | "partial" | "unverified";

export type PrivacyVerifiedMessage = {
  messageId: string;
  body: string;
  modelId: string;
  providerName: string;
  targetId: string;
  verification: GenerationVerification;
};

export type PrivacyStatusSummary = {
  status: PrivacyStatus;
  privateModelCount: number;
  nvidia: { count: number; available: boolean };
  intel: { count: number; available: boolean };
  verifiedAssistantMessageCount: number;
  verifiedMessages: PrivacyVerifiedMessage[];
};

type PrivacyStatusTarget = {
  target: GenerationBatch["targets"][number];
  message?: ConversationView["messages"][number];
};

function privacyEvidenceForModel(
  verification: GenerationVerification | undefined,
): NonNullable<GenerationVerification["evidence"]> | undefined {
  if (!verification?.evidence) return undefined;
  return verification.evidence.kind === "model"
    ? verification.evidence
    : verification.evidence.model;
}

function privacyIntelEvidencePresent(
  evidence: NonNullable<GenerationVerification["evidence"]> | undefined,
): boolean {
  if (!evidence) return false;
  const raw = evidence.raw ?? {};
  return Object.entries(raw).some(
    ([key, value]) =>
      /intel[_-]?quote|quote/i.test(key) &&
      typeof value === "string" &&
      value.length > 0,
  );
}

function privacyBatchesForConversation(
  view: ConversationView | undefined,
  activeBatch?: GenerationBatch,
): GenerationBatch[] {
  const batches = [...(view?.generation_batches ?? [])];
  if (view?.active_generation_batch) batches.push(view.active_generation_batch);
  if (activeBatch) batches.push(activeBatch);
  const byID = new Map<string, GenerationBatch>();
  for (const batch of batches) byID.set(batch.id, batch);
  return [...byID.values()];
}

export function privacyStatusFromConversation(
  view: ConversationView | undefined,
  activeBatch: GenerationBatch | undefined,
  profiles: Pick<ProviderProfile, "id" | "kind">[],
): PrivacyStatusSummary {
  // Provider Profiles are intentionally not used to reinterpret persisted history.
  // A profile can be edited or deleted after a response was saved; the receipt and
  // immutable Provider Snapshot remain the source of truth for this panel.
  void profiles;
  const messagesByID = new Map(
    (view?.messages ?? []).map((message) => [message.id, message]),
  );
  const targetsByID = new Map<string, PrivacyStatusTarget>();
  for (const batch of privacyBatchesForConversation(view, activeBatch)) {
    for (const target of batch.targets) {
      targetsByID.set(target.id, {
        target,
        message: target.generation.assistant_message_id
          ? messagesByID.get(target.generation.assistant_message_id)
          : undefined,
      });
    }
  }
  const targets = [...targetsByID.values()];
  if (targets.length === 0) {
    return {
      status: "empty",
      privateModelCount: 0,
      nvidia: { count: 0, available: false },
      intel: { count: 0, available: false },
      verifiedAssistantMessageCount: 0,
      verifiedMessages: [],
    };
  }

  const privateModels = new Set<string>();
  let verifiedTargetCount = 0;
  let nvidiaCount = 0;
  let intelCount = 0;
  const verifiedMessages: PrivacyVerifiedMessage[] = [];
  const verifiedMessageIDs = new Set<string>();
  for (const { target, message } of targets) {
    const verification = target.generation.verification;
    const status = verification?.status;
    const providerTee =
      status === "verified_model" &&
      verification?.signature_kind === "provider_tee";
    const verified =
      status === "verified_model" || status === "verified_gateway";
    const privateTarget =
      isNearAISnapshot(target.generation.snapshot) || providerTee;
    if (privateTarget)
      privateModels.add(
        `${target.generation.snapshot.provider_id}:${target.generation.snapshot.model_id}`,
      );
    if (verified) verifiedTargetCount += 1;
    const modelEvidence = privacyEvidenceForModel(verification);
    if (verified && modelEvidence?.gpu_evidence === "verified")
      nvidiaCount += 1;
    if (verified && privacyIntelEvidencePresent(modelEvidence)) intelCount += 1;
    const messageID = target.generation.assistant_message_id;
    if (
      verified &&
      target.generation.state === "completed" &&
      messageID &&
      !verifiedMessageIDs.has(messageID)
    ) {
      verifiedMessageIDs.add(messageID);
      verifiedMessages.push({
        messageId: messageID,
        body: message?.body ?? "",
        modelId: target.generation.snapshot.model_id,
        providerName: target.generation.snapshot.provider_name,
        targetId: target.id,
        verification: verification!,
      });
    }
  }
  const confidential =
    targets.length > 0 &&
    targets.every(({ target }) => {
      const verification = target.generation.verification;
      const providerTee =
        verification?.status === "verified_model" &&
        verification.signature_kind === "provider_tee";
      return (
        providerTee &&
        target.generation.state === "completed" &&
        Boolean(target.generation.assistant_message_id)
      );
    });
  const gatewayOnly =
    targets.length > 0 &&
    targets.every(
      ({ target }) =>
        target.generation.verification?.status === "verified_gateway",
    );
  return {
    status: confidential
      ? "confidential"
      : gatewayOnly
        ? "gateway"
        : verifiedTargetCount > 0
          ? "partial"
          : "unverified",
    privateModelCount: privateModels.size,
    nvidia: { count: nvidiaCount, available: nvidiaCount > 0 },
    intel: { count: intelCount, available: intelCount > 0 },
    verifiedAssistantMessageCount: verifiedMessages.length,
    verifiedMessages,
  };
}

export function privacyStatusPresentation(
  status: PrivacyStatus,
  copy: ApplicationCopy = englishConversationCopy,
) {
  const statusLabel =
    status === "empty"
      ? copy.privacyNoData
      : status === "confidential"
        ? copy.chatConfidential
        : status === "gateway"
          ? copy.verificationGateway
          : status === "partial"
            ? copy.chatPartiallyVerified
            : copy.chatUnverified;
  const attested = status === "confidential";
  return {
    statusLabel,
    attested,
    sealTitle: attested ? copy.privacySealTitle : statusLabel,
    sealDetail: attested ? copy.privacySealDetail : copy.privacyStatusHint,
  };
}
