import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions, Dialog, DialogBackdrop, DialogPanel, DialogTitle, Menu, MenuButton, MenuItem, MenuItems, Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { useQueries } from "@tanstack/react-query";
import { ArrowRight, ArrowUp, BadgeCheck, Check, CircleAlert, CircleDashed, ChevronDown, Copy, Download, GitCompareArrows, KeyRound, LoaderCircle, LockKeyhole, MessageCircleMore, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, ShieldCheck, Square, Sun, Trash2, TriangleAlert, X } from "lucide-react";
import type { Conversation, ConversationView, Generation, GenerationBatch, GenerationBatchEvent, GenerationVerification, ProviderModelMetadata, ProviderProfile, ProviderProfileInput, ProviderSnapshot, ThemePreference, VerificationEvidence, VerificationLaneKind, WorkspaceSettings } from "@cove/api-contract";
import { applicationMessages, type ApplicationCopy } from "./messages";
import { FrontSelect } from "./components/ui/front-select";
import { applyLiveTurnEvent, createLiveTurn, hydrateLiveTurnBatch, liveTurnFromBatch, reconcileLiveTurn, replaceLiveTargetAttempt, type LiveTurn, type LiveTurnPhase } from "./live-turn";
import { downloadConversationExport, downloadWorkspaceExport, loadWorkspaceExportViews, type ConversationExportFormat } from "./conversation-export";
import { runPrivateConnectionProbe, type PrivateConnectionProbeResult } from "./private-connection";
import type { SecureInferenceEvidence, SecureInferenceMode, SecureInferenceVerification, SecureInferenceVerificationEvent } from "./secure-inference";
import { secureInferenceFailureReason } from "./secure-inference-errors";
import {
  createConversation,
  createGenerationBatch,
  clearChatData,
  cancelGeneration,
  deleteConversation,
  getConversation,
  getConversations,
  getGenerationBatch,
  getProviderCatalog,
  getProviderProfiles,
  getSession,
  getSettings,
  renameConversation,
  updateConversation,
  retryGenerationTarget,
  saveProviderProfile,
  subscribeGenerationBatch,
	selectGenerationAnswer,
	skipGenerationBatchContext,
	cancelGenerationBatch,
  testProviderConnection,
  updateSettings,
  deleteProviderKey,
  deleteProviderProfile,
  LocalServiceError,
  markSecureGenerationEnvironment,
  markSecureGenerationStreaming,
  markSecureGenerationResponseVerification,
  settleSecureGeneration
} from "./transport";

type ConnectionState = "loading" | "ready" | "unavailable";
type SettingsDialogSection = "general" | "provider" | "chat-data";
type ConfirmationRequest = { kind: "switch" | "delete" | "clear"; conversationId?: string };
const PRIVATE_GENERATION_TIMEOUT_MS = 2 * 60 * 1000;

export type ActiveSelection = { providerId: string; modelId: string };
export type ActiveModelSet = ActiveSelection[];

export function useNarrowLayout(query = "(max-width: 980px)"): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export type PrivacyStatus = "empty" | "confidential" | "gateway" | "partial" | "unverified";

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

function privacyEvidenceForModel(verification: GenerationVerification | undefined): NonNullable<GenerationVerification["evidence"]> | undefined {
  if (!verification?.evidence) return undefined;
  return verification.evidence.kind === "model" ? verification.evidence : verification.evidence.model;
}

function privacyIntelEvidencePresent(evidence: NonNullable<GenerationVerification["evidence"]> | undefined): boolean {
  if (!evidence) return false;
  const raw = evidence.raw ?? {};
  return Object.entries(raw).some(([key, value]) => /intel[_-]?quote|quote/i.test(key) && typeof value === "string" && value.length > 0);
}

function privacyBatchesForConversation(view: ConversationView | undefined, activeBatch?: GenerationBatch): GenerationBatch[] {
  const batches = [...(view?.generation_batches ?? [])];
  if (view?.active_generation_batch) batches.push(view.active_generation_batch);
  if (activeBatch) batches.push(activeBatch);
  const byID = new Map<string, GenerationBatch>();
  for (const batch of batches) byID.set(batch.id, batch);
  return [...byID.values()];
}

export function privacyStatusFromConversation(view: ConversationView | undefined, activeBatch: GenerationBatch | undefined, profiles: Pick<ProviderProfile, "id" | "kind">[]): PrivacyStatusSummary {
  // Provider Profiles are intentionally not used to reinterpret persisted history.
  // A profile can be edited or deleted after a response was saved; the receipt and
  // immutable Provider Snapshot remain the source of truth for this panel.
  void profiles;
  const messagesByID = new Map((view?.messages ?? []).map((message) => [message.id, message]));
  const targetsByID = new Map<string, PrivacyStatusTarget>();
  for (const batch of privacyBatchesForConversation(view, activeBatch)) {
    for (const target of batch.targets) {
      targetsByID.set(target.id, { target, message: target.generation.assistant_message_id ? messagesByID.get(target.generation.assistant_message_id) : undefined });
    }
  }
  const targets = [...targetsByID.values()];
  if (targets.length === 0) {
    return { status: "empty", privateModelCount: 0, nvidia: { count: 0, available: false }, intel: { count: 0, available: false }, verifiedAssistantMessageCount: 0, verifiedMessages: [] };
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
    const providerTee = status === "verified_model" && verification?.signature_kind === "provider_tee";
    const verified = status === "verified_model" || status === "verified_gateway";
    const privateTarget = target.generation.snapshot.provider_id === "nearai" || providerTee;
    if (privateTarget) privateModels.add(`${target.generation.snapshot.provider_id}:${target.generation.snapshot.model_id}`);
    if (verified) verifiedTargetCount += 1;
    const modelEvidence = privacyEvidenceForModel(verification);
    if (verified && modelEvidence?.gpu_evidence === "verified") nvidiaCount += 1;
    if (verified && privacyIntelEvidencePresent(modelEvidence)) intelCount += 1;
    const messageID = target.generation.assistant_message_id;
    if (verified && target.generation.state === "completed" && messageID && !verifiedMessageIDs.has(messageID)) {
      verifiedMessageIDs.add(messageID);
      verifiedMessages.push({
        messageId: messageID,
        body: message?.body ?? "",
        modelId: target.generation.snapshot.model_id,
        providerName: target.generation.snapshot.provider_name,
        targetId: target.id,
        verification: verification!
      });
    }
  }
  const confidential = targets.length > 0 && targets.every(({ target }) => {
    const verification = target.generation.verification;
    const providerTee = verification?.status === "verified_model" && verification.signature_kind === "provider_tee";
    const privateTarget = target.generation.snapshot.provider_id === "nearai" || providerTee;
    return privateTarget && providerTee && target.generation.state === "completed" && Boolean(target.generation.assistant_message_id);
  });
  const gatewayOnly = targets.length > 0 && targets.every(({ target }) => target.generation.verification?.status === "verified_gateway");
  return {
    status: confidential ? "confidential" : gatewayOnly ? "gateway" : verifiedTargetCount > 0 ? "partial" : "unverified",
    privateModelCount: privateModels.size,
    nvidia: { count: nvidiaCount, available: nvidiaCount > 0 },
    intel: { count: intelCount, available: intelCount > 0 },
    verifiedAssistantMessageCount: verifiedMessages.length,
    verifiedMessages
  };
}

function isTerminalGenerationState(state: Generation["state"]): boolean {
  return state === "completed" || state === "stopped" || state === "failed";
}

export function secureInferenceTargetSelected(targets: ActiveModelSet, profiles: Pick<ProviderProfile, "id" | "kind" | "configured">[], catalogs: ModelCatalogs = {}): boolean {
  return targets.length > 0 && targets.every((target) => privateTeeTargetSelected(target, profiles, catalogs));
}

export function verifiedInferenceTargetSelected(targets: ActiveModelSet, profiles: Pick<ProviderProfile, "id" | "kind" | "configured">[], catalogs: ModelCatalogs = {}): boolean {
  return targets.length > 0 && targets.every((target) => secureTargetForCatalog(target, profiles, catalogs));
}

function privateTeeTargetSelected(target: ActiveSelection, profiles: Pick<ProviderProfile, "id" | "kind" | "configured">[], catalogs: ModelCatalogs): boolean {
  const profile = profiles.find((candidate) => candidate.id === target.providerId);
  const metadata = catalogs[target.providerId]?.metadata?.[target.modelId];
  return profile?.kind === "nearai" && profile.configured === true && metadata?.privacy_mode === "private_tee" && metadata.verifiable === true;
}

export function nearAISelectionPresent(targets: ActiveModelSet, profiles: Pick<ProviderProfile, "id" | "kind">[]): boolean {
  return targets.some((target) => profiles.find((profile) => profile.id === target.providerId)?.kind === "nearai");
}

export function selectionAfterProviderRemoval(selection: ActiveSelection, providerId: string): ActiveSelection {
  return selection.providerId === providerId ? { providerId: "", modelId: "" } : selection;
}

export function settingsWithActiveSelection(settings: WorkspaceSettings, selection: ActiveSelection): WorkspaceSettings {
	return { ...settings, active_model_set: selection.providerId && selection.modelId ? [{ provider_id: selection.providerId, model_id: selection.modelId }] : [] };
}

export function selectionFromWorkspaceSettings(settings: WorkspaceSettings, profiles: ProviderProfile[]): ActiveSelection {
  const selection = activeModelSetFromWorkspaceSettings(settings, profiles)[0] ?? { providerId: "", modelId: "" };
  if (selection.providerId || selection.modelId) {
    return selection;
  }
  const configuredProfiles = profiles.filter((profile) => profile.configured && profile.model_id);
  if (configuredProfiles.length !== 1) {
    return selection;
  }
  return { providerId: configuredProfiles[0].id, modelId: configuredProfiles[0].model_id };
}

export function activeModelSetFromWorkspaceSettings(settings: WorkspaceSettings, profiles: ProviderProfile[]): ActiveModelSet {
	const selections = settings.active_model_set.map((target) => ({ providerId: target.provider_id, modelId: target.model_id }));
	if (selections.length > 0) return selections;
	const configuredProfiles = profiles.filter((profile) => profile.configured && profile.model_id);
	return configuredProfiles.length === 1 ? [{ providerId: configuredProfiles[0].id, modelId: configuredProfiles[0].model_id }] : [];
}

export function selectionAfterProviderSave(selection: ActiveSelection, profile: ProviderProfile): ActiveSelection {
  if (!profile.configured || !profile.model_id) {
    return selection;
  }
  if ((selection.providerId === "" && selection.modelId === "") || selection.providerId === profile.id) {
    return { providerId: profile.id, modelId: profile.model_id };
  }
  return selection;
}

const defaultWorkspaceSettings: WorkspaceSettings = {
  theme: "system",
  locale: "en",
  system_prompt: "",
	temperature: null,
	top_p: null,
	max_tokens: null,
	active_model_set: []
};

function lanesForSuccessfulVerification(verification: SecureInferenceVerification, mode?: SecureInferenceMode): GenerationVerification["lanes"] {
  if (verification.status === "verified_model" && verification.signingKind === "provider_tee") {
    return { gateway: "verified", model: "verified", response: "verified" };
  }
  if (verification.status === "verified_gateway" && verification.signingKind === "gateway") {
    return mode === "private_tee" ? { gateway: "verified", model: "failed", response: "verified" } : { gateway: "verified", response: "verified" };
  }
  return { gateway: "failed", ...(mode === "private_tee" ? { model: "failed" as const } : {}), response: "failed" };
}

function lanesForFailedVerification(mode: SecureInferenceMode | undefined, failureCode?: string, streamed = false): GenerationVerification["lanes"] {
  const includeModel = mode === "private_tee";
  const environmentFailed = failureCode === "environment_verification_failed" || failureCode === "gateway_verification_failed" || failureCode === "secure_transport_error";
  if (environmentFailed && !streamed) {
    return { gateway: "failed", ...(includeModel ? { model: "failed" as const } : {}), response: "failed" };
  }
  if (failureCode === "response_verification_failed" || failureCode === "timeout" || failureCode === "verification_stopped" || failureCode === "stream_failed" || streamed) {
    return { gateway: "verified", ...(includeModel ? { model: "failed" as const } : {}), response: "failed" };
  }
  return { gateway: "failed", ...(includeModel ? { model: "failed" as const } : {}), response: "failed" };
}

async function secureVerificationForContract(verification: SecureInferenceVerification, mode?: SecureInferenceMode): Promise<GenerationVerification> {
  let signatureDigest: string | undefined;
  if (verification.signature) {
    try {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verification.signature));
      signatureDigest = `sha256:${Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("")}`;
    } catch {
      signatureDigest = "sha256:unavailable";
    }
  }
  const status = verification.status === "verified_model" ? "verified_model" : verification.status === "verified_gateway" ? "verified_gateway" : "unsupported";
  return {
    status,
    completion_id: verification.completionId,
    signature_kind: verification.signingKind,
    signing_address: verification.signingAddress,
    signing_algorithm: verification.signingAlgorithm,
    signed_message: verification.signedMessage,
    signature: verification.signature,
    signature_digest: signatureDigest,
    evidence_summary: verification.reason,
    evidence: verification.evidence ? contractEvidenceFor(verification.evidence, verification.environment) : undefined,
    lanes: lanesForSuccessfulVerification(verification, mode)
  };
}

function failedVerificationForContract(mode: SecureInferenceMode | undefined, failureCode: string, evidenceSummary: string, streamed = false): GenerationVerification {
  return {
    status: "failed",
    failure_code: failureCode,
    evidence_summary: evidenceSummary,
    lanes: lanesForFailedVerification(mode, failureCode, streamed)
  };
}

export function contractEvidenceFor(evidence: SecureInferenceEvidence, environment?: SecureInferenceVerification["environment"]): VerificationEvidence {
  const related = evidence.kind === "model" ? environment?.gateway : environment?.model;
  return {
    kind: evidence.kind,
    signer_address: evidence.signerAddress,
    signing_algorithm: evidence.signingAlgorithm,
    tcb_status: evidence.tcbStatus,
    advisory_ids: evidence.advisoryIds,
    gpu_evidence: evidence.gpuEvidence,
    tls_binding: evidence.tlsBinding,
    deployment: {
      app_compose: evidence.deployment.appCompose,
      os_image_hash: evidence.deployment.osImageHash,
      compose_hash: evidence.deployment.composeHash
    },
    raw: evidence.raw,
    ...(related ? { [related.kind]: contractEvidenceFor(related) } : {})
  };
}

/** Convert a verified private result into the evidence shape consumed by the details dialog. */
export function verificationEvidenceForDialog(verification: SecureInferenceVerification): { kind: "model" | "gateway"; evidence: VerificationEvidence } | undefined {
  if (verification.status !== "verified_model" && verification.status !== "verified_gateway") return undefined;
  if (!verification.evidence) return undefined;
  return {
    kind: verification.evidence.kind,
    evidence: contractEvidenceFor(verification.evidence, verification.environment)
  };
}

function replaceBatchGeneration(batch: GenerationBatch, targetID: string, generation: Generation): GenerationBatch {
  return {
    ...batch,
    targets: batch.targets.map((target) => target.id === targetID ? {
      ...target,
      generation: {
        ...target.generation,
        ...generation,
        verification: generation.verification
      }
    } : target)
  };
}

export type ModelCatalogState = {
  status: "idle" | "loading" | "ready" | "error";
  models: string[];
  metadata?: Record<string, ProviderModelMetadata>;
};

export type ModelCatalogs = Record<string, ModelCatalogState>;

export type ProviderSelectionStatus = "ready" | "unconfigured" | "catalog-loading" | "catalog-error" | "no-models" | "model-required" | "model-unavailable";

export function providerCatalogQueryOptions(providerId: string) {
  return {
    queryKey: ["provider-catalog", providerId] as const,
    queryFn: () => getProviderCatalog(providerId),
    enabled: Boolean(providerId)
  };
}

export function modelMetadataForTarget(catalogs: ModelCatalogs, target: ActiveSelection): ProviderModelMetadata | undefined {
  return catalogs[target.providerId]?.metadata?.[target.modelId];
}

function secureTargetForCatalog(target: ActiveSelection, profiles: Pick<ProviderProfile, "id" | "kind" | "configured">[], catalogs: ModelCatalogs): boolean {
  const profile = profiles.find((candidate) => candidate.id === target.providerId);
  const metadata = modelMetadataForTarget(catalogs, target);
  if (profile?.kind !== "nearai" || profile.configured !== true) return false;
  return metadata?.privacy_mode === "private_tee" || metadata?.privacy_mode === "incognito" || metadata?.privacy_mode === "chutes";
}

export function inferenceModeForMetadata(metadata?: ProviderModelMetadata): SecureInferenceMode | undefined {
  if (metadata?.privacy_mode === "private_tee" || metadata?.privacy_mode === "incognito" || metadata?.privacy_mode === "chutes") {
    return metadata.privacy_mode;
  }
  return undefined;
}

export function inferenceModeForSnapshot(snapshot?: Pick<ProviderSnapshot, "privacy_mode">): SecureInferenceMode | undefined {
  if (snapshot?.privacy_mode === "private_tee" || snapshot?.privacy_mode === "incognito" || snapshot?.privacy_mode === "chutes") {
    return snapshot.privacy_mode;
  }
  return undefined;
}

function keepUnverifiedGatewayAnswer(mode: SecureInferenceMode | undefined, body: string): boolean {
  return (mode === "incognito" || mode === "chutes") && body.trim() !== "";
}

export function privacyModeLabel(mode: SecureInferenceMode | undefined, copy: ApplicationCopy): string {
  if (mode === "incognito") return copy.privacyModeIncognito;
  if (mode === "chutes") return copy.privacyModeChutes;
  return copy.privacyModePrivateTee;
}

export function verificationLaneStatus(kind: VerificationLaneKind, verification?: GenerationVerification, mode?: SecureInferenceMode): "pending" | "verified" | "failed" {
  const stored = verification?.lanes?.[kind];
  if (stored === "pending" || stored === "verified" || stored === "failed") return stored;
  if (kind === "model" && mode !== "private_tee" && verification?.signature_kind !== "provider_tee") {
    return "failed";
  }
  if (!verification || verification.status === "pending") return "pending";
  const providerTee = verification.status === "verified_model" && verification.signature_kind === "provider_tee";
  const gatewaySigned = verification.status === "verified_gateway" && verification.signature_kind === "gateway";
  const failureCode = verification.failure_code ?? "";
  if (kind === "gateway") {
    if (providerTee || gatewaySigned) return "verified";
    if (verification.status === "failed" || verification.status === "unsupported") {
      if (failureCode === "response_verification_failed" || failureCode === "timeout" || failureCode === "verification_stopped" || failureCode === "stream_failed") {
        return "verified";
      }
      return "failed";
    }
    return "pending";
  }
  if (kind === "model") {
    if (providerTee) return "verified";
    if (verification.status === "failed" || verification.status === "unsupported" || gatewaySigned) return "failed";
    return "pending";
  }
  if (providerTee || gatewaySigned) return "verified";
  if (verification.status === "failed" || verification.status === "unsupported") return "failed";
  return "pending";
}

export function modelTargetKey(target: ActiveSelection): string {
  return `${target.providerId}:${target.modelId}`;
}

export function isDuplicateModelTarget(targets: ActiveModelSet, next: ActiveSelection, exceptIndex?: number): boolean {
  return targets.some((target, index) => index !== exceptIndex && target.providerId === next.providerId && target.modelId === next.modelId);
}

export function availableModelsForAddedTarget(profile: ProviderProfile, targets: ActiveModelSet, catalog?: ModelCatalogState): string[] {
  if (catalog?.status !== "ready") {
    return [];
  }
  return catalog.models.filter((modelId) => !isDuplicateModelTarget(targets, { providerId: profile.id, modelId }));
}

export function providerSelectionStatus(profile: ProviderProfile | undefined, catalog: ModelCatalogState, modelId: string): ProviderSelectionStatus {
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
  if (catalog.status === "ready" && modelId !== "" && !catalog.models.includes(modelId)) {
    return "model-unavailable";
  }
  return "ready";
}

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("loading");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [conversationView, setConversationView] = useState<ConversationView>();
  const [titleDraft, setTitleDraft] = useState("");
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>([]);
	const [activeModelSet, setActiveModelSet] = useState<ActiveModelSet>([]);
	const activeSelection = activeModelSet[0] ?? { providerId: "", modelId: "" };
	const [workspaceVerification, setWorkspaceVerification] = useState<{ kind: "model" | "gateway"; evidence: VerificationEvidence }>();
	const [privateConnectionProgress, setPrivateConnectionProgress] = useState<PrivateConnectionProgressState>();
	const [privacyStatusOpen, setPrivacyStatusOpen] = useState(false);
	const [generationBatch, setGenerationBatch] = useState<GenerationBatch>();
  const [draft, setDraft] = useState("");
  const [liveTurn, setLiveTurn] = useState<LiveTurn>();
  const [isSending, setIsSending] = useState(false);
  const [isClearingChatData, setIsClearingChatData] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<WorkspaceSettings>(defaultWorkspaceSettings);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest>();
  const [resumeGenerationBatch, setResumeGenerationBatch] = useState<GenerationBatch>();
  const [showingArchived, setShowingArchived] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Conversation>();
  const [downloadTarget, setDownloadTarget] = useState<ConversationView>();
  const selectedIdRef = useRef<string | undefined>(undefined);
  const liveTurnRef = useRef<LiveTurn | undefined>(undefined);
  const secureInferenceAbortRef = useRef<AbortController | undefined>(undefined);
  const secureInferenceFinishedRef = useRef<Promise<unknown> | undefined>(undefined);
  const secureGenerationRunsRef = useRef(new Map<string, { batchID: string; controller: AbortController; finished: Promise<void> }>());
  const pendingBatchEventsRef = useRef<GenerationBatchEvent[]>([]);
  const streamingFrameRef = useRef<number | undefined>(undefined);
  const narrowLayout = useNarrowLayout();
  selectedIdRef.current = selectedId;
  liveTurnRef.current = liveTurn;

  function flushPendingBatchEvents() {
    if (streamingFrameRef.current !== undefined) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(streamingFrameRef.current);
      else window.clearTimeout(streamingFrameRef.current);
      streamingFrameRef.current = undefined;
    }
    const events = pendingBatchEventsRef.current;
    pendingBatchEventsRef.current = [];
    if (events.length > 0) setLiveTurn((current) => current ? events.reduce(applyLiveTurnEvent, current) : current);
  }

  function queueBatchDelta(event: GenerationBatchEvent) {
    pendingBatchEventsRef.current.push(event);
    if (streamingFrameRef.current !== undefined) return;
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback: FrameRequestCallback) => window.setTimeout(callback, 16);
    streamingFrameRef.current = schedule(() => {
      streamingFrameRef.current = undefined;
      flushPendingBatchEvents();
    });
  }
  const copy = applicationMessages(settings.locale);

  useEffect(() => {
    const controller = new AbortController();
    void loadWorkspace(controller.signal).then(({ connection, conversations, providerProfiles, settings }) => {
      setConnection(connection);
      setConversations(conversations);
      setSelectedId(conversations[0]?.id);
      setProviderProfiles(providerProfiles);
      setSettings(settings);
		setActiveModelSet(activeModelSetFromWorkspaceSettings(settings, providerProfiles));
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    applyDocumentTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    if (!narrowLayout) setMobileSidebarOpen(false);
  }, [narrowLayout]);

  const configuredProfiles = providerProfiles.filter((profile) => profile.configured);
  const catalogQueries = useQueries({
    queries: configuredProfiles.map((profile) => providerCatalogQueryOptions(profile.id))
  });
  const catalogs = configuredProfiles.reduce<ModelCatalogs>((current, profile, index) => {
    const query = catalogQueries[index];
    current[profile.id] = query?.isPending
        ? { status: "loading", models: [], metadata: {} }
        : query?.isError
          ? { status: "error", models: [], metadata: {} }
          : { status: "ready", models: query?.data?.models ?? [], metadata: Object.fromEntries((query?.data?.model_metadata ?? []).map((metadata) => [metadata.id, metadata])) };
    return current;
  }, {});
  const catalog = catalogs[activeSelection.providerId] ?? { status: "idle", models: [], metadata: {} };
  const selectionStatus = activeModelSet.length === 0
    ? "unconfigured"
    : activeModelSet.map((target) => providerSelectionStatus(
      providerProfiles.find((profile) => profile.id === target.providerId),
      catalogs[target.providerId] ?? { status: "idle", models: [], metadata: {} },
      target.modelId
    )).find((status) => status !== "ready") ?? "ready";

  useEffect(() => {
    if (!selectedId) {
      setConversationView(undefined);
      setTitleDraft("");
      return;
    }
    let active = true;
    setIsLoadingConversation(true);
    void getConversation(selectedId)
      .then((view) => {
        if (!active) {
          return;
        }
        setConversationView(view);
        setTitleDraft(view.title);
		setResumeGenerationBatch(view.active_generation_batch);
        setIsLoadingConversation(false);
      })
      .catch(() => {
        if (active) {
          setConversationView(undefined);
          setIsLoadingConversation(false);
          setFeedback(copy.unavailable);
        }
      });
    return () => {
      active = false;
    };
  }, [copy.unavailable, selectedId]);

  useEffect(() => {
		setGenerationBatch(undefined);
    setLiveTurn(undefined);
		setResumeGenerationBatch(undefined);
    setDraft("");
    setIsSending(false);
  }, [selectedId]);

  useEffect(() => () => {
    secureInferenceAbortRef.current?.abort();
    for (const run of secureGenerationRunsRef.current.values()) run.controller.abort();
    flushPendingBatchEvents();
  }, []);

  useEffect(() => {
    if (!resumeGenerationBatch || !conversationView || resumeGenerationBatch.conversation_id !== conversationView.id) {
      return;
    }
    const catalogStillLoading = resumeGenerationBatch.targets.some((target) => {
      const profile = providerProfiles.find((candidate) => candidate.id === target.provider_id);
      const catalogState = catalogs[target.provider_id];
      return profile?.kind === "nearai" && (!catalogState || catalogState.status === "idle" || catalogState.status === "loading");
    });
    if (catalogStillLoading) return;
    const userBody = conversationView.messages.find((message) => message.id === resumeGenerationBatch.user_message_id)?.body ?? "";
		setLiveTurn(liveTurnFromBatch(conversationView.id, userBody, resumeGenerationBatch));
		setGenerationBatch(resumeGenerationBatch);
		setIsSending(true);
		setResumeGenerationBatch(undefined);
		const secureTargets = resumeGenerationBatch.targets.filter((target) => secureTargetForCatalog({ providerId: target.provider_id, modelId: target.model_id }, providerProfiles, catalogs));
		if (secureTargets.length > 0) {
			void Promise.all(secureTargets.filter((target) => !isTerminalGenerationState(target.generation.state)).map((target) => cancelGeneration(target.generation.id))).then(() => {
				if (secureTargets.length === resumeGenerationBatch.targets.length) setIsSending(false);
				return refreshCurrentConversation();
			}).catch(() => { setIsSending(false); });
			if (secureTargets.length < resumeGenerationBatch.targets.length) void streamGenerationBatch(resumeGenerationBatch);
		} else {
			void streamGenerationBatch(resumeGenerationBatch);
		}
  }, [catalogs, conversationView, providerProfiles, resumeGenerationBatch]);

  async function handleCreateConversation() {
    setFeedback(undefined);
    try {
      const conversation = await createConversation();
      const refreshed = await getConversations();
      setShowingArchived(false);
      setConversations(refreshed);
      setSelectedId(conversation.id);
      setConnection("ready");
      setMobileSidebarOpen(false);
    } catch {
      setFeedback(copy.createFailed);
    }
  }

  async function saveConversationTitle(conversationID: string, title: string) {
    if (!title.trim()) {
      return;
    }
    setIsSavingTitle(true);
    setFeedback(undefined);
    try {
      await renameConversation(conversationID, title);
      const [refreshed, view] = await Promise.all([getConversations({ archived: showingArchived }), getConversation(conversationID)]);
      setConversations(refreshed);
      if (selectedIdRef.current === conversationID) {
        setConversationView(view);
        setTitleDraft(view.title);
      }
      setRenameTarget(undefined);
    } catch {
      setFeedback(copy.renameFailed);
    } finally {
      setIsSavingTitle(false);
    }
  }

  async function handleRenameConversation() {
    if (selectedId) {
      await saveConversationTitle(selectedId, titleDraft);
    }
  }

  async function handleRequestDownload(conversationID: string) {
    setFeedback(undefined);
    try {
      setDownloadTarget(await getConversation(conversationID));
    } catch {
      setFeedback(copy.downloadFailed);
    }
  }

  async function handleUpdateConversation(conversationID: string, input: { pinned?: boolean; archived?: boolean }) {
    if (isSending) {
      return;
    }
    setFeedback(undefined);
    try {
      await updateConversation(conversationID, input);
      const refreshed = await getConversations({ archived: showingArchived });
      setConversations(refreshed);
      if (conversationID === selectedIdRef.current && input.archived !== undefined && input.archived !== showingArchived) {
        setSelectedId(refreshed[0]?.id);
        setConversationView(undefined);
      } else if (conversationID === selectedIdRef.current) {
        const view = await getConversation(conversationID);
        setConversationView(view);
      }
    } catch {
      setFeedback(copy.conversationUpdateFailed);
    }
  }

  async function handleConversationListMode(nextShowingArchived: boolean) {
    if (isSending || nextShowingArchived === showingArchived) {
      return;
    }
    setFeedback(undefined);
    try {
      const refreshed = await getConversations({ archived: nextShowingArchived });
      setShowingArchived(nextShowingArchived);
      setConversations(refreshed);
      setSelectedId(refreshed[0]?.id);
      setMobileSidebarOpen(false);
    } catch {
      setFeedback(copy.conversationUpdateFailed);
    }
  }

  async function streamGenerationBatch(next: GenerationBatch) {
    const ownsConversation = () => selectedIdRef.current === next.conversation_id;
    if (ownsConversation()) setGenerationBatch(next);
    let finalBatch: GenerationBatch | undefined;
    try {
      for await (const event of subscribeGenerationBatch(next.id)) {
        if (!ownsConversation()) continue;
        if (event.type === "delta") queueBatchDelta(event);
        else {
          flushPendingBatchEvents();
          setLiveTurn((current) => current ? applyLiveTurnEvent(current, event) : current);
        }
      }
      flushPendingBatchEvents();
      finalBatch = await getGenerationBatch(next.id);
      if (ownsConversation()) {
        setGenerationBatch(finalBatch);
        setLiveTurn((current) => current ? hydrateLiveTurnBatch(current, finalBatch!) : current);
      }
    } catch {
      flushPendingBatchEvents();
      if (ownsConversation()) {
        setFeedback(copy.generationUnavailable);
        setLiveTurn((current) => current ? { ...current, targets: (current.targets ?? []).map((target) => ({ ...target, phase: target.phase === "pending" || target.phase === "verifying_environment" || target.phase === "streaming" || target.phase === "verifying_response" ? "unknown" : target.phase })) } : current);
      }
    } finally {
      const [refreshed, conversations] = await Promise.all([
        getConversation(next.conversation_id).catch(() => undefined),
        getConversations({ archived: showingArchived }).catch(() => undefined)
      ]);
      if (refreshed && selectedIdRef.current === next.conversation_id) {
        setConversationView(refreshed);
        const authoritativeBatch = refreshed.generation_batches?.find((batch) => batch.id === next.id) ?? finalBatch;
        if (authoritativeBatch) {
          setLiveTurn((current) => current ? reconcileLiveTurn(hydrateLiveTurnBatch(current, authoritativeBatch), refreshed) : current);
        }
      }
      if (conversations) setConversations(conversations);
      if (ownsConversation()) setIsSending(false);
    }
  }

  async function handleVerifyPrivateConnection() {
    const targets = activeModelSet.map((target) => ({ target, profile: providerProfiles.find((candidate) => candidate.id === target.providerId) })).filter((entry): entry is { target: ActiveSelection; profile: ProviderProfile } => Boolean(entry.profile));
    if (isSending || targets.length === 0 || !secureInferenceTargetSelected(activeModelSet, providerProfiles, catalogs)) return;
    const controller = new AbortController();
    secureInferenceAbortRef.current = controller;
    setPrivateConnectionProgress({
      phase: "environment",
      providerName: targets.map(({ profile }) => profile.name).filter((name, index, names) => names.indexOf(name) === index).join(" + "),
      modelIds: targets.map(({ target }) => target.modelId)
    });
    setFeedback(undefined);
    setIsSending(true);
    let verifiedProbe: SecureInferenceVerification | undefined;
    let probeFailureReason: string | undefined;
    const verification = import("./secure-inference").then(({ createSecureInferenceTransport }) => Promise.all(targets.map(({ target, profile }) => runPrivateConnectionProbe({
      transport: createSecureInferenceTransport(),
      target,
      profile,
      signal: controller.signal,
      onStatus(status) {
        const phase: PrivateConnectionProgressPhase = status === "verifying_environment"
          ? "environment"
          : status === "streaming"
            ? "encrypted_path"
            : "response";
        setPrivateConnectionProgress((current) => current ? { ...current, phase } : current);
      },
      onVerification(result) {
        if (!verifiedProbe) verifiedProbe = result;
      },
      onFailure(reason) {
        probeFailureReason = reason;
      }
    }))).then((results) => results.every((result) => result === "verified") ? "verified" : results.some((result) => result === "stopped") ? "stopped" : "failed" as PrivateConnectionProbeResult));
    secureInferenceFinishedRef.current = verification;
    try {
      const result = await verification;
      if (!controller.signal.aborted) {
        const dialogState = result === "verified" && verifiedProbe ? verificationEvidenceForDialog(verifiedProbe) : undefined;
        if (dialogState) {
          setPrivateConnectionProgress((current) => current ? { ...current, phase: "complete", verification: dialogState } : current);
          setFeedback(copy.privateConnectionVerified);
        } else {
          const message = privateInferenceFailureMessage(probeFailureReason, copy);
          setPrivateConnectionProgress((current) => current ? { ...current, failedAt: activePrivateConnectionPhase(current.phase), phase: "failed", message } : current);
          setFeedback(message);
        }
      }
    } catch {
      const message = privateInferenceFailureMessage(probeFailureReason, copy);
      setPrivateConnectionProgress((current) => current ? { ...current, failedAt: activePrivateConnectionPhase(current.phase), phase: "failed", message } : current);
      setFeedback(message);
    } finally {
      if (controller.signal.aborted) {
        setPrivateConnectionProgress(undefined);
        setFeedback(copy.generationStopped);
      }
      if (secureInferenceAbortRef.current === controller) {
        secureInferenceAbortRef.current = undefined;
        setIsSending(false);
      }
      if (secureInferenceFinishedRef.current === verification) secureInferenceFinishedRef.current = undefined;
    }
  }

  async function verifyEnvironmentForTarget(target: ActiveSelection, profile: ProviderProfile, kind: "model" | "gateway"): Promise<VerificationEvidence> {
    const { createSecureInferenceTransport } = await import("./secure-inference");
    const transport = createSecureInferenceTransport();
    if (!transport.verifyEnvironment) throw new Error("environment verification is unavailable");
    const mode = inferenceModeForMetadata(modelMetadataForTarget(catalogs, target));
    if (!mode) throw new Error("environment verification is unavailable");
    const environment = await transport.verifyEnvironment({
      target: { id: profile.id, kind: profile.kind, model_id: target.modelId, configured: profile.configured },
      mode
    });
    setFeedback(copy.privateConnectionVerified);
    if (kind === "model") {
      if (!environment.model) throw new Error("model attestation is unavailable for this model");
      return contractEvidenceFor(environment.model, environment);
    }
    return contractEvidenceFor(environment.gateway, environment);
  }

  async function handleVerifyAgain(targetID: string, kind: "model" | "gateway"): Promise<VerificationEvidence | undefined> {
    const target = [
      ...(generationBatch?.targets ?? []),
      ...(conversationView?.generation_batches?.flatMap((batch) => batch.targets) ?? [])
    ].find((candidate) => candidate.id === targetID);
    const profile = target ? providerProfiles.find((candidate) => candidate.id === target.provider_id) : undefined;
    if (!target || !profile || !secureTargetForCatalog({ providerId: target.provider_id, modelId: target.model_id }, providerProfiles, catalogs) || isSending) return;
    setFeedback(copy.privateInferenceVerifying);
    try {
      return await verifyEnvironmentForTarget({ providerId: target.provider_id, modelId: target.model_id }, profile, kind);
    } catch (error) {
      setFeedback(privateInferenceFailureMessage(error, copy));
      return undefined;
    }
  }

  async function handleVerifySelectedModel(): Promise<void> {
    const profile = providerProfiles.find((candidate) => candidate.id === activeSelection.providerId);
    if (isSending || !profile || !secureTargetForCatalog(activeSelection, providerProfiles, catalogs) || !activeSelection.modelId) return;
    setFeedback(copy.privateInferenceVerifying);
    try {
      const evidence = await verifyEnvironmentForTarget(activeSelection, profile, "model");
      setWorkspaceVerification({ kind: "model", evidence });
    } catch (error) {
      setFeedback(privateInferenceFailureMessage(error, copy));
    }
  }

  async function handleVerifyWorkspaceAgain(kind: "model" | "gateway"): Promise<VerificationEvidence | undefined> {
    const profile = providerProfiles.find((candidate) => candidate.id === activeSelection.providerId);
    if (!profile || !secureTargetForCatalog(activeSelection, providerProfiles, catalogs) || !activeSelection.modelId) return undefined;
    try {
      const evidence = await verifyEnvironmentForTarget(activeSelection, profile, kind);
      setWorkspaceVerification({ kind, evidence });
      return evidence;
    } catch (error) {
      setFeedback(privateInferenceFailureMessage(error, copy));
      return undefined;
    }
  }

  async function streamSecureGeneration(next: GenerationBatch, target: GenerationBatch["targets"][number], profile: ProviderProfile, body: string): Promise<void> {
    if (!target) return;
    const generationID = target.generation.id;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PRIVATE_GENERATION_TIMEOUT_MS);
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => { releaseReady = resolve; });
    let releaseVerification!: () => void;
    const verificationFinished = new Promise<void>((resolve) => { releaseVerification = resolve; });
    let verificationPending = false;
    let run: Promise<void>;
    run = (async () => {
      let assistantBody = "";
      let settled = false;
      const mode = inferenceModeForSnapshot(target.generation.snapshot) ?? inferenceModeForMetadata(modelMetadataForTarget(catalogs, { providerId: target.provider_id, modelId: target.model_id }));
      const updatePhase = (phase: LiveTurnPhase) => {
        setLiveTurn((current) => current ? {
          ...current,
          targets: (current.targets ?? []).map((candidate) => candidate.targetId === target.id ? { ...candidate, phase } : candidate)
        } : current);
      };
      try {
        if (!mode) {
          const failedGeneration = await settleSecureGeneration(generationID, "", failedVerificationForContract(undefined, "environment_verification_failed", "This model does not have a supported verification mode."));
          settled = true;
          setGenerationBatch((current) => current?.id === next.id ? replaceBatchGeneration(current, target.id, failedGeneration) : current);
          updatePhase("failed");
          return;
        }
        await markSecureGenerationEnvironment(generationID);
        updatePhase("verifying_environment");
        const context = (conversationView?.messages ?? [])
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => ({ role: message.role as "user" | "assistant", content: message.body }));
        const configuration = target.generation.configuration_snapshot;
        const { createSecureInferenceTransport } = await import("./secure-inference");
        const transport = createSecureInferenceTransport();
        const settleVerification = async (event: SecureInferenceVerificationEvent) => {
          if (settled) {
            releaseVerification();
            return;
          }
          try {
            if (event.type === "completed") {
              const verification = await secureVerificationForContract(event.verification, mode);
              const settledGeneration = await settleSecureGeneration(generationID, assistantBody, verification);
              settled = true;
              setGenerationBatch((current) => current?.id === next.id ? replaceBatchGeneration(current, target.id, settledGeneration) : current);
              updatePhase(settledGeneration.state === "completed" ? "completed" : "failed");
            } else {
              const failureCode = timedOut ? "timeout" : controller.signal.aborted ? "verification_stopped" : event.code;
              const keepAnswer = keepUnverifiedGatewayAnswer(mode, assistantBody);
              const settledGeneration = await settleSecureGeneration(generationID, keepAnswer ? assistantBody : "", failedVerificationForContract(mode, failureCode, timedOut ? "Private response verification timed out." : controller.signal.aborted ? "Private response verification was stopped." : "Private response verification failed.", Boolean(assistantBody)));
              settled = true;
              setGenerationBatch((current) => current?.id === next.id ? replaceBatchGeneration(current, target.id, settledGeneration) : current);
              updatePhase(settledGeneration.state === "completed" ? "completed" : "failed");
            }
          } catch {
            const failedGeneration = await settleSecureGeneration(generationID, "", failedVerificationForContract(mode, timedOut ? "timeout" : "secure_transport_error", timedOut ? "Private response verification timed out." : "Private response verification failed.", Boolean(assistantBody))).catch(() => undefined);
            if (failedGeneration) {
              settled = true;
              setGenerationBatch((current) => current?.id === next.id ? replaceBatchGeneration(current, target.id, failedGeneration) : current);
              updatePhase(failedGeneration.state === "completed" ? "completed" : "failed");
            }
          } finally {
            releaseVerification();
            void refreshCurrentConversation().catch(() => undefined);
          }
        };
        const stream = transport.generate({
          target: { id: profile.id, kind: profile.kind, model_id: target.model_id, configured: profile.configured },
          mode,
          configuration: { systemPrompt: configuration.system_prompt, temperature: configuration.temperature, topP: configuration.top_p, maxTokens: configuration.max_tokens },
          context,
          message: body
        }, controller.signal, { onVerification: (event) => { void settleVerification(event); } });
        for await (const event of stream) {
          if (controller.signal.aborted) break;
          if (event.type === "verifying_environment") {
            updatePhase("verifying_environment");
          } else if (event.type === "streaming") {
            await markSecureGenerationStreaming(generationID);
            updatePhase("streaming");
          } else if (event.type === "delta") {
            assistantBody += event.delta;
            setLiveTurn((current) => current ? {
              ...current,
              targets: (current.targets ?? []).map((candidate) => candidate.targetId === target.id ? { ...candidate, phase: "streaming", assistantBody: candidate.assistantBody + event.delta } : candidate)
            } : current);
          } else if (event.type === "response_ready") {
            await markSecureGenerationResponseVerification(generationID);
            verificationPending = true;
            updatePhase("verifying_response");
          } else if (event.type === "verifying_response") {
            updatePhase("verifying_response");
          } else if (event.type === "completed") {
            const verification = await secureVerificationForContract(event.verification, mode);
            const settledGeneration = await settleSecureGeneration(generationID, assistantBody, verification);
            settled = true;
			releaseVerification();
            setGenerationBatch((current) => current?.id === next.id ? replaceBatchGeneration(current, target.id, settledGeneration) : current);
            updatePhase(settledGeneration.state === "completed" ? "completed" : "failed");
          } else if (event.type === "failed") {
            const keepAnswer = keepUnverifiedGatewayAnswer(mode, assistantBody);
            const failedGeneration = await settleSecureGeneration(generationID, keepAnswer ? assistantBody : "", failedVerificationForContract(mode, timedOut ? "timeout" : event.code, timedOut ? "Private response verification timed out." : "Private response verification failed.", Boolean(assistantBody)));
            settled = true;
			releaseVerification();
            setGenerationBatch((current) => current?.id === next.id ? replaceBatchGeneration(current, target.id, failedGeneration) : current);
			updatePhase(failedGeneration.state === "completed" ? "completed" : "failed");
          }
        }
        releaseReady();
        if (verificationPending) {
          await verificationFinished;
        } else {
          releaseVerification();
        }
        if (controller.signal.aborted && !settled) {
          if (timedOut) {
            const keepAnswer = keepUnverifiedGatewayAnswer(mode, assistantBody);
            const failedGeneration = await settleSecureGeneration(generationID, keepAnswer ? assistantBody : "", failedVerificationForContract(mode, "timeout", "Private response verification timed out.", Boolean(assistantBody))).catch(() => undefined);
            if (failedGeneration) setGenerationBatch((current) => current?.id === next.id ? replaceBatchGeneration(current, target.id, failedGeneration) : current);
			updatePhase(failedGeneration?.state === "completed" ? "completed" : "failed");
			settled = Boolean(failedGeneration);
          } else {
            await cancelGeneration(generationID).catch(() => undefined);
            updatePhase("stopped");
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
			const failedGeneration = await settleSecureGeneration(generationID, keepUnverifiedGatewayAnswer(mode, assistantBody) ? assistantBody : "", failedVerificationForContract(mode, "secure_transport_error", error instanceof Error ? error.message : "Private response verification failed.", Boolean(assistantBody))).catch(() => undefined);
			updatePhase(failedGeneration?.state === "completed" ? "completed" : "failed");
        }
        releaseReady();
		releaseVerification();
      } finally {
        clearTimeout(timeout);
        const [view, batches] = await Promise.all([
          getConversation(next.conversation_id).catch(() => undefined),
          getConversations({ archived: showingArchived }).catch(() => undefined)
        ]);
        if (view && selectedIdRef.current === next.conversation_id) setConversationView(view);
        if (batches) setConversations(batches);
        const finalBatch = view?.generation_batches?.find((batch) => batch.id === next.id);
        if (finalBatch && (finalBatch.state === "completed" || finalBatch.state === "completed_with_errors" || finalBatch.state === "stopped" || finalBatch.state === "failed") && next.targets.every((candidate) => providerProfiles.find((profile) => profile.id === candidate.provider_id)?.kind === "nearai")) {
          setIsSending(false);
        }
        secureGenerationRunsRef.current.delete(generationID);
      }
    })();
    secureGenerationRunsRef.current.set(generationID, { batchID: next.id, controller, finished: run });
    await ready;
  }

  async function handleSend() {
    const selectedTargets = activeModelSet.filter((target) => providerProfiles.some((profile) => profile.id === target.providerId && profile.configured));
    if (isSending || !selectedId || !draft.trim() || selectionStatus !== "ready" || selectedTargets.length !== activeModelSet.length || selectedTargets.length === 0) {
      return;
    }
    const body = draft.trim();
    const clientRequestId = crypto.randomUUID();
    setDraft("");
    setFeedback(undefined);
    setIsSending(true);
    setLiveTurn(createLiveTurn(selectedId, body, clientRequestId, selectedTargets));
    try {
      const selection = { clientRequestId, body };
		let next: GenerationBatch;
      try {
			next = await createGenerationBatch(selectedId, selection);
      } catch (error) {
        if (error instanceof LocalServiceError) throw error;
			next = await createGenerationBatch(selectedId, selection);
      }
      if (selectedIdRef.current !== selectedId) {
			await cancelGenerationBatch(next.id).catch(() => undefined);
        return;
      }
      setGenerationBatch(next);
		setLiveTurn((current) => current ? hydrateLiveTurnBatch(current, next) : current);
      void Promise.all([getConversation(selectedId), getConversations({ archived: showingArchived })]).then(([view, list]) => {
        if (selectedIdRef.current === selectedId) {
          setConversationView(view);
        }
        setConversations(list);
      }).catch(() => undefined);
      const secureTargets = next.targets.filter((target) => secureTargetForCatalog({ providerId: target.provider_id, modelId: target.model_id }, providerProfiles, catalogs));
      const hasNonSecureTargets = secureTargets.length < next.targets.length;
      const secureRuns = secureTargets.flatMap((target) => {
        const profile = providerProfiles.find((candidate) => candidate.id === target.provider_id);
        return profile ? [streamSecureGeneration(next, target, profile, body)] : [];
      });
      await Promise.all([hasNonSecureTargets ? streamGenerationBatch(next) : Promise.resolve(), ...secureRuns]);
    } catch (error) {
      setDraft(body);
      setIsSending(false);
		setLiveTurn((current) => current ? { ...current, targets: (current.targets ?? []).map((target) => ({ ...target, phase: error instanceof LocalServiceError ? "failed" : "unknown" })) } : current);
      setFeedback(generationErrorMessage(error, copy));
    }
  }

  function handleProviderChange(providerId: string) {
    if (isSending) {
      return;
    }
		setActiveModelSet(providerId ? [{ providerId, modelId: "" }] : []);
    setFeedback(undefined);
  }

  async function handleModelChange(modelId: string) {
    await handleTargetModelChange(0, modelId);
  }

  async function handleTargetModelChange(targetIndex: number, modelId: string) {
    const target = activeModelSet[targetIndex];
    const targetCatalog = target ? catalogs[target.providerId] : undefined;
    if (isSending || !target || targetCatalog?.status !== "ready" || !targetCatalog.models.includes(modelId)) {
      return;
    }
    const nextTarget = { ...target, modelId };
    if (isDuplicateModelTarget(activeModelSet, nextTarget, targetIndex)) {
      setFeedback(copy.modelAlreadyInComparison);
      return;
    }
    try {
      const nextModelSet = activeModelSet.map((candidate, index) => index === targetIndex ? nextTarget : candidate);
		const updated = await updateSettings({ ...settings, active_model_set: nextModelSet.map((candidate) => ({ provider_id: candidate.providerId, model_id: candidate.modelId })) });
      setSettings(updated);
		setActiveModelSet(activeModelSetFromWorkspaceSettings(updated, providerProfiles));
      setFeedback(undefined);
    } catch (error) {
      setFeedback(providerErrorMessage(error, copy));
    }
  }

	async function handleAddModel(profile: ProviderProfile, modelId: string) {
		const availableModels = availableModelsForAddedTarget(profile, activeModelSet, catalogs[profile.id]);
		if (isSending || !profile.configured || !availableModels.includes(modelId) || activeModelSet.length >= 4) return;
		const nextModelSet = [...activeModelSet, { providerId: profile.id, modelId }];
		try {
			const updated = await updateSettings({ ...settings, active_model_set: nextModelSet.map((target) => ({ provider_id: target.providerId, model_id: target.modelId })) });
			setSettings(updated);
			setActiveModelSet(activeModelSetFromWorkspaceSettings(updated, providerProfiles));
		} catch (error) {
			setFeedback(providerErrorMessage(error, copy));
		}
	}

	async function handleRemoveModel(target: ActiveSelection) {
		if (isSending) return;
		const nextModelSet = activeModelSet.filter((candidate) => candidate.providerId !== target.providerId || candidate.modelId !== target.modelId);
		try {
			const updated = await updateSettings({ ...settings, active_model_set: nextModelSet.map((candidate) => ({ provider_id: candidate.providerId, model_id: candidate.modelId })) });
			setSettings(updated);
			setActiveModelSet(activeModelSetFromWorkspaceSettings(updated, providerProfiles));
		} catch (error) {
			setFeedback(providerErrorMessage(error, copy));
		}
	}

  async function handleCancel() {
    const activeBatchID = generationBatch?.id;
    const runs = [...secureGenerationRunsRef.current.values()].filter((run) => run.batchID === activeBatchID);
    if (runs.length > 0) {
      for (const run of runs) run.controller.abort();
      const batchCancellation = generationBatch ? cancelGenerationBatch(generationBatch.id).catch(() => undefined) : Promise.resolve();
      await Promise.allSettled([...runs.map((run) => run.finished), batchCancellation]);
      return;
    }
    if (secureInferenceAbortRef.current) {
      secureInferenceAbortRef.current.abort();
      await secureInferenceFinishedRef.current;
      return;
    }
    if (!generationBatch) {
      return;
    }
    try {
		const stopped = await cancelGenerationBatch(generationBatch.id);
		setGenerationBatch(stopped);
    } catch (error) {
      setFeedback(generationErrorMessage(error, copy));
    }
  }

  async function handleCancelTarget(batchID: string, generationID: string) {
    try {
      const secureRun = secureGenerationRunsRef.current.get(generationID);
      if (secureRun) {
        secureRun.controller.abort();
        await secureRun.finished;
        return;
      }
      await cancelGeneration(generationID);
      const batch = await getGenerationBatch(batchID);
      if (generationBatch?.id === batchID) setGenerationBatch(batch);
      setLiveTurn((current) => current?.batchId === batchID ? hydrateLiveTurnBatch(current, batch) : current);
    } catch (error) {
      setFeedback(generationErrorMessage(error, copy));
    }
  }

  async function handleRetry(batchID: string, targetID: string) {
    const clientRequestId = crypto.randomUUID();
    setIsSending(true);
    try {
      const next = await retryGenerationTarget(targetID, clientRequestId);
      const batch = await getGenerationBatch(batchID);
      setGenerationBatch(batch);
      const userBody = conversationView?.messages.find((message) => message.id === batch.user_message_id)?.body ?? "";
      setLiveTurn((current) => current?.batchId === batchID
        ? replaceLiveTargetAttempt(current, targetID, next)
        : replaceLiveTargetAttempt(liveTurnFromBatch(batch.conversation_id, userBody, batch), targetID, next));
      const retryProfile = providerProfiles.find((profile) => profile.id === batch.targets.find((target) => target.id === targetID)?.provider_id);
		if (retryProfile && secureTargetForCatalog({ providerId: retryProfile.id, modelId: batch.targets.find((target) => target.id === targetID)?.model_id ?? "" }, providerProfiles, catalogs)) {
			await Promise.all([streamGenerationBatch(batch), streamSecureGeneration(batch, batch.targets.find((target) => target.id === targetID)!, retryProfile, userBody)]);
		} else {
			await streamGenerationBatch(batch);
		}
    } catch (error) {
      setIsSending(false);
      setFeedback(generationErrorMessage(error, copy));
    }
  }

  async function refreshCurrentConversation() {
    if (!selectedIdRef.current) return;
    const refreshed = await getConversation(selectedIdRef.current);
    if (refreshed.id === selectedIdRef.current) setConversationView(refreshed);
  }

  async function handleSelectAnswer(batchID: string, generationID: string) {
    try {
      await selectGenerationAnswer(generationID);
      if (generationBatch?.id === batchID) setGenerationBatch(await getGenerationBatch(batchID));
      await refreshCurrentConversation();
    } catch (error) {
      setFeedback(generationErrorMessage(error, copy));
    }
  }

  async function handleSkipContext(batchID: string) {
    try {
      await skipGenerationBatchContext(batchID);
      if (generationBatch?.id === batchID) setGenerationBatch(await getGenerationBatch(batchID));
      await refreshCurrentConversation();
    } catch (error) {
      setFeedback(generationErrorMessage(error, copy));
    }
  }

  async function handleSelectConversation(id: string) {
    if (id === selectedId) return;
		const activeGeneration = generationBatch && (generationBatch.state === "pending" || generationBatch.state === "streaming");
    if (isSending || activeGeneration) {
      setConfirmation({ kind: "switch", conversationId: id });
      return;
    }
    setSelectedId(id);
    setMobileSidebarOpen(false);
  }

  function handleDeleteConversation(id: string) {
    if (isSending) return;
    setConfirmation({ kind: "delete", conversationId: id });
  }

  async function deleteConfirmedConversation(id: string) {
    setFeedback(undefined);
    try {
      await deleteConversation(id);
      const refreshed = await getConversations({ archived: showingArchived });
      setConversations(refreshed);
      if (id === selectedId) {
        setSelectedId(refreshed[0]?.id);
      }
    } catch {
      setFeedback(copy.deleteFailed);
    }
  }

  function handleClearChatData() {
    if (!isClearingChatData) setConfirmation({ kind: "clear" });
  }

  async function clearConfirmedChatData() {
    setIsClearingChatData(true);
    setFeedback(undefined);
    try {
      if (secureInferenceAbortRef.current || secureGenerationRunsRef.current.size > 0) await handleCancel();
      await clearChatData();
      setConversations([]);
      setShowingArchived(false);
      setSelectedId(undefined);
      setConversationView(undefined);
      setTitleDraft("");
		setGenerationBatch(undefined);
      setDraft("");
      setFeedback(copy.chatDataCleared);
    } catch {
      setFeedback(copy.clearChatDataFailed);
    } finally {
      setIsClearingChatData(false);
    }
  }

  async function confirmRequestedAction() {
    const request = confirmation;
    if (!request) return;
    setConfirmation(undefined);
    if (request.kind === "switch" && request.conversationId) {
      const activeGeneration = generationBatch && (generationBatch.state === "pending" || generationBatch.state === "streaming");
      if (secureInferenceAbortRef.current || secureGenerationRunsRef.current.size > 0 || activeGeneration) await handleCancel();
      setSelectedId(request.conversationId);
      setMobileSidebarOpen(false);
      return;
    }
    if (request.kind === "delete" && request.conversationId) {
      await deleteConfirmedConversation(request.conversationId);
      return;
    }
    if (request.kind === "clear") await clearConfirmedChatData();
  }

  async function handleExportChatData(format: ConversationExportFormat) {
    try {
      const views = await loadWorkspaceExportViews(
        (archived) => getConversations({ archived }),
        getConversation
      );
      downloadWorkspaceExport(views, format);
    } catch {
      setFeedback(copy.downloadFailed);
    }
  }

  async function handleSaveSettings(next: WorkspaceSettings) {
    const updated = await updateSettings({
      ...next,
      active_model_set: activeModelSet.map((target) => ({ provider_id: target.providerId, model_id: target.modelId }))
    });
    setSettings(updated);
		setActiveModelSet(activeModelSetFromWorkspaceSettings(updated, providerProfiles));
  }

  async function handleToggleTheme() {
    const effective = settings.theme === "system"
      ? typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      : settings.theme;
    const next = effective === "dark" ? "light" : "dark";
    try {
      await handleSaveSettings({ ...settings, theme: next });
    } catch {
      setFeedback(copy.settingsFailed);
    }
  }

  async function clearActiveSelectionForProvider(providerId: string) {
		const nextModelSet = activeModelSet.filter((selection) => selection.providerId !== providerId);
		const nextSettings = { ...settings, active_model_set: nextModelSet.map((selection) => ({ provider_id: selection.providerId, model_id: selection.modelId })) };
		setActiveModelSet(nextModelSet);
    try {
      const updated = await updateSettings(nextSettings);
      setSettings(updated);
    } catch {
      setSettings(nextSettings);
      setFeedback(copy.settingsFailed);
    }
  }

  const privacySummary = privacyStatusFromConversation(conversationView, generationBatch, providerProfiles);
  const sidebarContents = <>
    <div className="workspace-sidebar__brand">
      <div className="workspace-sidebar__identity">
        <div className="brand-mark" aria-hidden="true">C</div>
        <div>
          <strong>Cove Private Chat</strong>
          <p className="eyebrow">{copy.privateLocalFirst}</p>
        </div>
      </div>
      <SidebarToggle collapsed={narrowLayout ? !mobileSidebarOpen : sidebarCollapsed} onToggle={() => narrowLayout ? setMobileSidebarOpen(false) : setSidebarCollapsed((current) => !current)} copy={copy} />
    </div>
    <ConversationList
      conversations={conversations}
      selectedId={selectedId}
      showingArchived={showingArchived}
      onSelect={(id) => void handleSelectConversation(id)}
      onCreate={() => void handleCreateConversation()}
      onRename={(conversation) => {
        setTitleDraft(conversation.title);
        setRenameTarget(conversation);
        setMobileSidebarOpen(false);
      }}
      onPin={(conversation) => void handleUpdateConversation(conversation.id, { pinned: !conversation.pinned })}
      onArchive={(conversation) => void handleUpdateConversation(conversation.id, { archived: !conversation.archived })}
      onDownload={(conversation) => { void handleRequestDownload(conversation.id); setMobileSidebarOpen(false); }}
      onDelete={handleDeleteConversation}
      onShowArchived={(archived) => void handleConversationListMode(archived)}
      onOpenSettings={() => { setSettingsOpen(true); setMobileSidebarOpen(false); }}
      onOpenPrivacyStatus={() => { setPrivacyStatusOpen(true); setMobileSidebarOpen(false); }}
      deleteDisabled={isSending}
      copy={copy}
    />
  </>;

  return (
    <main className="surface surface--focused surface--nearai" aria-label={copy.chatSurface}>
      <section className="workspace workspace--focused workspace--nearai" aria-label={copy.chatSurface}>
        <div className={`workspace__body workspace__body--nearai${sidebarCollapsed ? " workspace__body--sidebar-collapsed" : ""}`}>
          {narrowLayout ? <Dialog className="mobile-sidebar-dialog" open={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)}>
            <DialogBackdrop className="mobile-sidebar-dialog__backdrop" />
            <DialogPanel as="aside" className="conversation-sidebar conversation-sidebar--nearai mobile-sidebar-dialog__panel" id="conversation-sidebar">{sidebarContents}</DialogPanel>
          </Dialog> : <aside className={`conversation-sidebar conversation-sidebar--nearai${sidebarCollapsed ? " conversation-sidebar--collapsed" : ""}`} id="conversation-sidebar">{sidebarContents}</aside>}
          <div className="workspace__main">
            <WorkspaceHeader
              profiles={providerProfiles}
              activeProviderId={activeSelection.providerId}
              activeModelId={activeSelection.modelId}
	activeModelSet={activeModelSet}
              catalog={catalog}
				catalogs={catalogs}
              title={conversationView?.title ?? copy.newChat}
              theme={settings.theme}
              onToggleTheme={() => void handleToggleTheme()}
              privacyLabel={privacySummary.status === "confidential" ? copy.chatConfidential : privacySummary.status === "gateway" ? copy.verificationGateway : privacySummary.status === "partial" ? copy.chatPartiallyVerified : privacySummary.status === "empty" ? copy.privacyNoData : copy.chatUnverified}
              privacyTone={privacySummary.status}
              onProviderChange={handleProviderChange}
              onModelChange={(modelId) => void handleModelChange(modelId)}
				onTargetModelChange={(targetIndex, modelId) => void handleTargetModelChange(targetIndex, modelId)}
              onAddModel={(profile, modelId) => void handleAddModel(profile, modelId)}
				onRemoveModel={(target) => void handleRemoveModel(target)}
              onVerifyPrivateConnection={secureInferenceTargetSelected(activeModelSet, providerProfiles, catalogs) ? () => void handleVerifyPrivateConnection() : undefined}
              onOpenPrivateVerification={secureInferenceTargetSelected(activeModelSet, providerProfiles, catalogs) ? () => void handleVerifySelectedModel() : undefined}
              onOpenPrivacyStatus={() => setPrivacyStatusOpen(true)}
              connection={connection}
              disabled={isSending}
              onOpenSidebar={narrowLayout ? () => setMobileSidebarOpen(true) : undefined}
              copy={copy}
            />
            <ConversationPanel
              view={isLoadingConversation ? undefined : conversationView}
              titleDraft={titleDraft}
              onTitleChange={setTitleDraft}
              onRename={handleRenameConversation}
              isSaving={isSavingTitle}
              copy={copy}
              isLoading={isLoadingConversation}
              onSend={() => void handleSend()}
              onCancel={() => void handleCancel()}
              onRetry={(batchID, targetID) => void handleRetry(batchID, targetID)}
              onCreateConversation={() => void handleCreateConversation()}
              onOpenSettings={() => setSettingsOpen(true)}
              generationBatch={generationBatch}
              generationBatches={conversationView?.generation_batches ?? []}
              liveTurn={liveTurn}
              draft={draft}
              onDraftChange={setDraft}
              privateMode={secureInferenceTargetSelected(activeModelSet, providerProfiles, catalogs)}
              isSending={isSending}
              providerStatus={selectionStatus}
              activeModelSet={activeModelSet}
              profiles={providerProfiles}
              catalogs={catalogs}
              onCancelTarget={(batchID, generationID) => void handleCancelTarget(batchID, generationID)}
              onSelectAnswer={(batchID, generationID) => void handleSelectAnswer(batchID, generationID)}
              onSkipContext={(batchID) => void handleSkipContext(batchID)}
              onVerifyAgain={(targetID, kind) => handleVerifyAgain(targetID, kind)}
            />
            {privateConnectionProgress ? <PrivateConnectionProgress
              providerName={privateConnectionProgress.providerName}
              modelIds={privateConnectionProgress.modelIds}
              phase={privateConnectionProgress.phase}
              failedAt={privateConnectionProgress.failedAt}
              message={privateConnectionProgress.message}
              copy={copy}
              onClose={() => {
                if (privateConnectionProgress.phase !== "complete" && privateConnectionProgress.phase !== "failed") {
                  secureInferenceAbortRef.current?.abort();
                }
                setPrivateConnectionProgress(undefined);
              }}
              onOpenDetails={privateConnectionProgress.verification ? () => {
                setWorkspaceVerification(privateConnectionProgress.verification);
                setPrivateConnectionProgress(undefined);
              } : undefined}
            /> : null}
            {feedback ? <p className="workspace__feedback" role="status">{feedback}</p> : null}
          </div>
        </div>
      </section>
      {workspaceVerification ? <VerificationDialog
        kind={workspaceVerification.kind}
        evidence={workspaceVerification.evidence}
        providerName={providerProfiles.find((profile) => profile.id === activeSelection.providerId)?.name}
        modelId={activeSelection.modelId}
        copy={copy}
        onVerifyAgain={handleVerifyWorkspaceAgain}
        onClose={() => setWorkspaceVerification(undefined)}
      /> : null}
      <PrivacyStatusPanel
        open={privacyStatusOpen}
        summary={privacyStatusFromConversation(conversationView, generationBatch, providerProfiles)}
        copy={copy}
        onClose={() => setPrivacyStatusOpen(false)}
        onVerifyAgain={(targetID, kind) => handleVerifyAgain(targetID, kind)}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} copy={copy}>
        <div aria-labelledby="settings-tab-general" className="settings-dialog__section settings-section" data-settings-section="general" id="settings-general" role="tabpanel">
          <header className="settings-section__head">
            <span className="settings-section__no">01</span>
            <span className="settings-section__title">{copy.general}</span>
            <span className="settings-section__en">{copy.settingsGeneralEn}</span>
          </header>
          <WorkspaceSettingsPanel settings={settings} onSave={handleSaveSettings} copy={copy} />
        </div>
        <div aria-labelledby="settings-tab-provider" className="settings-dialog__section settings-section" data-settings-section="provider" id="settings-provider" role="tabpanel">
          <header className="settings-section__head">
            <span className="settings-section__no">02</span>
            <span className="settings-section__title">{copy.providerSettings}</span>
            <span className="settings-section__en">{copy.settingsProviderEn}</span>
          </header>
          <ProviderSettings
            id="provider-settings"
            copy={copy}
            profiles={providerProfiles}
            onSave={async (input) => {
              const saved = await saveProviderProfile(input);
              const nextProfiles = [saved, ...providerProfiles.filter((profile) => profile.id !== saved.id)];
              setProviderProfiles(nextProfiles);
              if (activeModelSet.length === 0 && saved.configured && saved.model_id) {
				const nextModelSet = [{ providerId: saved.id, modelId: saved.model_id }];
				setActiveModelSet(nextModelSet);
                try {
                  const updated = await updateSettings({
                    ...settings,
					active_model_set: nextModelSet.map((target) => ({ provider_id: target.providerId, model_id: target.modelId }))
				});
                  setSettings(updated);
					setActiveModelSet(activeModelSetFromWorkspaceSettings(updated, nextProfiles));
                } catch {
                  setFeedback(copy.settingsFailed);
                }
              }
              if (shouldDismissProviderDialog(saved)) setSettingsOpen(false);
              return saved;
            }}
            onTest={async (input) => (await testProviderConnection(input)).models}
            onDelete={async (id) => {
              await deleteProviderProfile(id);
              setProviderProfiles((current) => current.filter((profile) => profile.id !== id));
              await clearActiveSelectionForProvider(id);
            }}
            onDeleteKey={async (id) => {
              await deleteProviderKey(id);
              setProviderProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, configured: false } : profile));
              await clearActiveSelectionForProvider(id);
            }}
          />
        </div>
        <div aria-labelledby="settings-tab-chat-data" className="settings-dialog__section settings-section" data-settings-section="chat-data" id="settings-chat-data" role="tabpanel">
          <header className="settings-section__head">
            <span className="settings-section__no">03</span>
            <span className="settings-section__title">{copy.chatData}</span>
            <span className="settings-section__en">{copy.settingsChatDataEn}</span>
          </header>
          <ChatDataPanel
            conversations={conversations}
            generationCount={(conversationView?.generation_batches ?? []).length}
            onDelete={(id) => void handleDeleteConversation(id)}
            deleteDisabled={isSending}
            onClear={() => void handleClearChatData()}
            onExport={(format) => void handleExportChatData(format)}
            isClearing={isClearingChatData}
            copy={copy}
          />
        </div>
      </SettingsDialog>
      <ConfirmationDialog
        open={Boolean(confirmation)}
        title={confirmation?.kind === "delete" ? copy.deleteConversation : confirmation?.kind === "clear" ? copy.clearChatData : copy.switchConversation}
        description={confirmation?.kind === "delete" ? copy.confirmDeleteConversation : confirmation?.kind === "clear" ? copy.confirmClearChatData : copy.confirmSwitchConversation}
        confirmLabel={confirmation?.kind === "delete" ? copy.deleteConversation : confirmation?.kind === "clear" ? copy.clearChatData : copy.switchConversation}
        destructive={confirmation?.kind !== "switch"}
        onCancel={() => setConfirmation(undefined)}
        onConfirm={() => void confirmRequestedAction()}
        copy={copy}
      />
      <ConversationRenameDialog
        conversation={renameTarget}
        copy={copy}
        isSaving={isSavingTitle}
        onClose={() => setRenameTarget(undefined)}
        onSave={(title) => {
          if (renameTarget) {
            void saveConversationTitle(renameTarget.id, title);
          }
        }}
      />
      <ConversationDownloadDialog
        conversation={downloadTarget}
        copy={copy}
        onClose={() => setDownloadTarget(undefined)}
        onDownload={(format) => {
          if (downloadTarget) {
            downloadConversationExport(downloadTarget, format);
            setDownloadTarget(undefined);
          }
        }}
      />
    </main>
  );
}

async function loadWorkspace(signal: AbortSignal): Promise<{ connection: ConnectionState; conversations: Conversation[]; providerProfiles: ProviderProfile[]; settings: WorkspaceSettings }> {
  try {
    if (signal.aborted) {
      return { connection: "loading", conversations: [], providerProfiles: [], settings: defaultWorkspaceSettings };
    }
    const [session, conversations, providerProfiles, settings] = await Promise.all([getSession(), getConversations(), getProviderProfiles(), getSettings()]);
    return { connection: session.csrf_token ? "ready" : "unavailable", conversations, providerProfiles, settings };
  } catch {
    return { connection: signal.aborted ? "loading" : "unavailable", conversations: [], providerProfiles: [], settings: defaultWorkspaceSettings };
  }
}

export function SettingsDialog({
  open,
  onClose,
  children,
  copy = englishConversationCopy
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  copy?: ApplicationCopy;
}) {
  return (
    <Dialog className="settings-dialog settings-dialog--nearai" open={open} onClose={onClose}>
      <DialogBackdrop className="settings-dialog__backdrop" />
      <div className="settings-dialog__viewport">
        <DialogPanel className="settings-dialog__panel">
          <SettingsDialogContent copy={copy} onClose={onClose} title={<DialogTitle as="h2">{copy.settings}</DialogTitle>}>{children}</SettingsDialogContent>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export function SettingsDialogContent({
  children,
  onClose = () => {},
  copy = englishConversationCopy,
  title
}: {
  children: ReactNode;
  onClose?: () => void;
  copy?: ApplicationCopy;
  title?: ReactNode;
}) {
  const heading = title ?? <h2>{copy.settings}</h2>;
  const [activeSection, setActiveSection] = useState<SettingsDialogSection>("general");
  const sections = [
    { id: "general" as const, label: copy.general },
    { id: "provider" as const, label: copy.providerSettings },
    { id: "chat-data" as const, label: copy.chatData }
  ];
  const sectionNumbers: Record<SettingsDialogSection, string> = { general: "01", provider: "02", "chat-data": "03" };

  const sectionEnglish: Record<SettingsDialogSection, string> = { general: "GENERAL", provider: "PROVIDERS", "chat-data": "CHAT DATA" };

  return <>
    <header className="settings-dialog__header">
      <span aria-hidden="true" className="settings-dialog__mark">T</span>
      <div>
        <p className="eyebrow">{copy.settingsAppendix} · {copy.settingsAppendixContents}</p>
        {heading}
      </div>
      <button aria-label={copy.closeSettings} className="settings-dialog__close" onClick={onClose} type="button">
        {copy.closeSettings}
      </button>
    </header>
    <div className="settings-dialog__content">
      <nav aria-label={copy.settingsSections} className="settings-dialog__navigation" role="tablist">
        <p className="settings-dialog__navigation-label">{copy.settingsAppendixContents}</p>
        {sections.map((section) => <button
          id={`settings-tab-${section.id}`}
          aria-controls={`settings-${section.id}`}
          aria-selected={activeSection === section.id}
          aria-pressed={activeSection === section.id}
          data-section-no={sectionNumbers[section.id]}
          key={section.id}
          onClick={() => setActiveSection(section.id)}
          role="tab"
          type="button"
        ><b>{sectionNumbers[section.id]}</b><span>{section.label}</span><em>{sectionEnglish[section.id]}</em></button>)}
        <p className="settings-dialog__navigation-note">{copy.settingsAppendixNote}</p>
      </nav>
      <div className="settings-dialog__sections" data-active-settings-section={activeSection}>{children}</div>
    </div>
    <footer className="settings-dialog__colophon"><LockKeyhole aria-hidden="true" size={11} strokeWidth={1.8} />{copy.settingsColophon}</footer>
  </>;
}

export type PrivateConnectionProgressPhase = "environment" | "encrypted_path" | "response" | "complete" | "failed";
type ActivePrivateConnectionProgressPhase = Exclude<PrivateConnectionProgressPhase, "complete" | "failed">;

type PrivateConnectionProgressState = {
  phase: PrivateConnectionProgressPhase;
  failedAt?: ActivePrivateConnectionProgressPhase;
  providerName: string;
  modelIds: string[];
  message?: string;
  verification?: { kind: "model" | "gateway"; evidence: VerificationEvidence };
};

export function PrivateConnectionProgress({
  providerName,
  modelIds,
  phase,
  failedAt,
  message,
  copy,
  onClose,
  onOpenDetails
}: {
  providerName: string;
  modelIds: string[];
  phase: PrivateConnectionProgressPhase;
  failedAt?: ActivePrivateConnectionProgressPhase;
  message?: string;
  copy: ApplicationCopy;
  onClose: () => void;
  onOpenDetails?: () => void;
}) {
  const steps = [
    { id: "environment", label: copy.privateConnectionStepEnvironment },
    { id: "encrypted_path", label: copy.privateConnectionStepEncryptedPath },
    { id: "response", label: copy.privateConnectionStepResponse }
  ] as const;
  const activePhase = phase === "failed" ? failedAt ?? "environment" : activePrivateConnectionPhase(phase);
  const activeIndex = activePhase === "environment" ? 0 : activePhase === "encrypted_path" ? 1 : 2;
  const headline = phase === "environment"
    ? copy.privateConnectionCheckingEnvironment
    : phase === "encrypted_path"
      ? copy.privateConnectionTestingEncryptedPath
      : phase === "response"
        ? copy.privateConnectionCheckingResponse
        : phase === "complete"
          ? copy.privateConnectionVerified
          : message ?? copy.privateInferenceFailed;
  const identity = [providerName, ...modelIds].filter(Boolean).join(" · ");

  return <section className={`private-connection-progress private-connection-progress--${phase}`} aria-live="polite" aria-label={copy.privateConnectionProgressTitle} data-private-connection-progress={phase} role="status">
    <button aria-label={phase === "complete" || phase === "failed" ? copy.closeVerification : copy.cancel} className="private-connection-progress__close" onClick={onClose} type="button">×</button>
    <div className="private-connection-progress__content">
      <p className="private-connection-progress__identity">{identity}</p>
      <h2>{headline}</h2>
      <ol className="private-connection-progress__steps">
        {steps.map((step, index) => {
          const state = phase === "complete" ? "complete" : phase === "failed" && index === activeIndex ? "failed" : index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending";
          return <li data-progress-step={step.id} data-state={state} key={step.id}>
            <span aria-hidden="true" className="private-connection-progress__marker">{state === "complete" ? "✓" : state === "failed" ? "!" : ""}</span>
            <span>{step.label}</span>
          </li>;
        })}
      </ol>
      {phase === "complete" && onOpenDetails ? <button className="private-connection-progress__details" onClick={onOpenDetails} type="button">{copy.privateConnectionViewDetails}</button> : null}
    </div>
  </section>;
}

function activePrivateConnectionPhase(phase: PrivateConnectionProgressPhase): ActivePrivateConnectionProgressPhase {
  return phase === "environment" || phase === "encrypted_path" || phase === "response" ? phase : "environment";
}

export function WorkspaceHeader({
  profiles,
  activeProviderId,
  activeModelId,
	activeModelSet = [],
  catalog,
	catalogs,
  title,
  theme = "system",
  onToggleTheme,
  privacyLabel,
  privacyTone = "empty",
  onProviderChange,
  onModelChange,
	onTargetModelChange,
	onAddModel,
  onRemoveModel,
  onVerifyPrivateConnection,
  onOpenPrivateVerification,
  onOpenPrivacyStatus,
  onOpenSidebar,
  connection,
  disabled = false,
  copy = englishConversationCopy
}: {
  profiles: ProviderProfile[];
  activeProviderId: string;
  activeModelId: string;
	activeModelSet?: ActiveModelSet;
  catalog: ModelCatalogState;
	catalogs?: ModelCatalogs;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
	onTargetModelChange?: (targetIndex: number, modelId: string) => void;
	onAddModel?: (profile: ProviderProfile, modelId: string) => void;
  onRemoveModel?: (target: ActiveSelection) => void;
  onVerifyPrivateConnection?: () => void;
  onOpenPrivateVerification?: () => void;
  onOpenPrivacyStatus?: () => void;
  onOpenSidebar?: () => void;
  title?: string;
  theme?: ThemePreference;
  onToggleTheme?: () => void;
  privacyLabel?: string;
  privacyTone?: string;
  connection: ConnectionState;
  disabled?: boolean;
  copy?: ApplicationCopy;
}) {
  const mastheadTargets = activeModelSet.length > 0
    ? activeModelSet
    : activeProviderId && activeModelId
      ? [{ providerId: activeProviderId, modelId: activeModelId }]
      : [];
  const effectiveTheme = theme === "system"
    ? typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : theme;
  return <header className="workspace__header workspace__header--nearai masthead" data-workspace-region="workspace-header">
    <span aria-hidden="true" className="masthead__rule" />
    {onOpenSidebar ? <button aria-controls="conversation-sidebar" aria-expanded="false" aria-label={copy.expandSidebar} className="masthead__sidebar-open" onClick={onOpenSidebar} type="button"><PanelLeftOpen aria-hidden="true" size={17} strokeWidth={1.8} /></button> : null}
    <div className="workspace__header-identity">
      <div className="masthead__eyebrow"><span>{copy.conversationSection}</span><i>/</i><i>{copy.issueLine}</i></div>
      <div className="masthead__title" title={title}>{title ?? copy.chatSurface}</div>
    </div>
    <div className="masthead__spacer" />
    {mastheadTargets.length > 0 ? <div className="masthead__models">
      {mastheadTargets.map((target) => {
        const profile = profiles.find((candidate) => candidate.id === target.providerId);
        return <span className={`mchip${profile?.kind === "nearai" ? " mchip--verified" : ""}`} key={`${target.providerId}:${target.modelId}`}>
          <span className="dot" />
          <b>{profile?.name ?? target.providerId}</b>
          {target.modelId}
        </span>;
      })}
    </div> : null}
    <div className="workspace__header-model" data-workspace-model-controls="compact">
      <ModelSelector
        profiles={profiles}
        activeProviderId={activeProviderId}
        activeModelId={activeModelId}
		activeModelSet={activeModelSet}
        catalog={catalog}
		catalogs={catalogs}
        onProviderChange={onProviderChange}
        onModelChange={onModelChange}
		onTargetModelChange={onTargetModelChange}
		onAddModel={onAddModel}
		onRemoveModel={onRemoveModel}
        disabled={disabled}
        copy={copy}
      />
    </div>
    <div className="workspace__header-utilities">
      {onToggleTheme ? <button aria-label={copy.toggleTheme} className="theme-btn" data-theme-preference={theme} onClick={onToggleTheme} title={copy.toggleTheme} type="button">
        {effectiveTheme === "dark" ? <Moon aria-hidden="true" className="ic-moon" size={15} strokeWidth={1.8} /> : <Sun aria-hidden="true" className="ic-sun" size={15} strokeWidth={1.8} />}
      </button> : null}
      <div className={`status status--${connection} masthead__connection`}>
        <span aria-hidden="true" className="workspace__security-icon" />
        <span className="workspace__status-label">{copy[connection]}</span>
      </div>
      {onVerifyPrivateConnection || onOpenPrivateVerification ? <Menu as="div" className="workspace__verification-menu">
        <MenuButton aria-label={copy.modelVerification} className="workspace__private-connection" disabled={disabled} title={copy.modelVerification} type="button">
          <BadgeCheck aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{copy.modelVerification}</span>
          <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
        </MenuButton>
        <MenuItems static className="workspace__verification-menu-items" transition>
          {onVerifyPrivateConnection ? <MenuItem><button disabled={disabled} onClick={onVerifyPrivateConnection} type="button">{copy.verifyPrivateConnection}</button></MenuItem> : null}
          {onOpenPrivateVerification ? <MenuItem><button disabled={disabled} onClick={onOpenPrivateVerification} type="button">{copy.modelVerification}</button></MenuItem> : null}
        </MenuItems>
      </Menu> : null}
      {onOpenPrivacyStatus ? <button aria-label={copy.privacyStatus} className="pill workspace__privacy-status" data-privacy-tone={privacyTone} onClick={onOpenPrivacyStatus} type="button">
        <ShieldCheck aria-hidden="true" size={16} strokeWidth={1.8} />
        <span>{privacyLabel ?? copy.privacyStatus}</span>
      </button> : null}
    </div>
  </header>;
}

function ModelOptionLabel({ modelId, metadata, copy, showPrivacyMode = false }: { modelId: string; metadata?: ProviderModelMetadata; copy: ApplicationCopy; showPrivacyMode?: boolean }) {
  const mode = showPrivacyMode ? metadata?.privacy_mode : undefined;
  return <span className="model-option">
    <span className="model-option__id">{modelId}</span>
    {mode ? <span className={`model-option__badge model-option__badge--${mode}`} data-privacy-mode={mode}>{privacyModeLabel(mode, copy)}</span> : null}
  </span>;
}

export function ModelSelector({
  profiles,
  activeProviderId,
  activeModelId,
	activeModelSet = [],
  catalog,
	catalogs,
  onProviderChange,
  onModelChange,
	onTargetModelChange,
	onAddModel,
	onRemoveModel,
  disabled = false,
  copy = englishConversationCopy
}: {
  profiles: ProviderProfile[];
  activeProviderId: string;
  activeModelId: string;
	activeModelSet?: ActiveModelSet;
  catalog: ModelCatalogState;
	catalogs?: ModelCatalogs;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
	onTargetModelChange?: (targetIndex: number, modelId: string) => void;
	onAddModel?: (profile: ProviderProfile, modelId: string) => void;
	onRemoveModel?: (target: ActiveSelection) => void;
  disabled?: boolean;
  copy?: ApplicationCopy;
}) {
  const [editingTargetIndex, setEditingTargetIndex] = useState(0);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [addModelQuery, setAddModelQuery] = useState("");
  const configuredProfiles = profiles.filter((profile) => profile.configured);
  const targets = activeModelSet.length > 0
    ? activeModelSet
    : activeProviderId && activeModelId
      ? [{ providerId: activeProviderId, modelId: activeModelId }]
      : [];
  const targetCatalogs: ModelCatalogs = catalogs ?? (activeProviderId ? { [activeProviderId]: catalog } : {});
  const selectedTargetIndex = Math.min(editingTargetIndex, Math.max(targets.length - 1, 0));
  const selectedTarget = targets[selectedTargetIndex];
  const selectedProfile = configuredProfiles.find((profile) => profile.id === selectedTarget?.providerId);
  const selectedCatalog: ModelCatalogState = selectedTarget ? targetCatalogs[selectedTarget.providerId] ?? { status: "idle", models: [], metadata: {} } : { status: "idle", models: [], metadata: {} };
  const selectedModelUnavailable = selectedCatalog.status === "ready" && selectedTarget?.modelId !== "" && !selectedCatalog.models.includes(selectedTarget?.modelId ?? "");
  const activeModelInvalid = Boolean(selectedProfile) && (!selectedTarget?.modelId || selectedModelUnavailable);
  const modelPlaceholder = selectedCatalog.status === "loading"
    ? <span className="model-selector__placeholder model-selector__placeholder--loading"><LoaderCircle aria-hidden="true" size={14} strokeWidth={2} />{copy.loadingModels}</span>
    : selectedCatalog.status === "error"
      ? <span className="model-selector__placeholder model-selector__placeholder--error"><CircleAlert aria-hidden="true" size={14} strokeWidth={2} />{copy.modelsUnavailable}</span>
      : <span className="model-selector__placeholder"><CircleDashed aria-hidden="true" size={14} strokeWidth={1.8} />{copy.selectModel}</span>;
  const addableProfiles = configuredProfiles.map((profile) => ({
    profile,
    models: availableModelsForAddedTarget(profile, targets, targetCatalogs[profile.id])
  })).filter((entry) => entry.models.length > 0);
  const normalizedAddModelQuery = addModelQuery.trim().toLocaleLowerCase();
  const filteredAddableProfiles = addableProfiles.map(({ profile, models }) => ({
    profile,
    models: normalizedAddModelQuery ? models.filter((modelId) => modelId.toLocaleLowerCase().includes(normalizedAddModelQuery)) : models
  })).filter((entry) => entry.models.length > 0);
  const handleTargetChange = onTargetModelChange ?? ((targetIndex: number, modelId: string) => {
    if (targetIndex === 0) onModelChange(modelId);
  });

  return (
    <div className="model-selector model-selector--nearai" data-catalog-status={selectedCatalog.status} data-selection-valid={activeModelInvalid ? "false" : "true"}>
      <div className="model-selector__topline">
        <div className="model-selector__fields">
          <FrontSelect
            ariaLabel={copy.provider}
            className="model-selector__provider-select"
            label={copy.provider}
            options={configuredProfiles.map((profile) => ({ value: profile.id, label: profile.name }))}
            placeholder={copy.selectProvider}
            value={selectedTarget?.providerId ?? ""}
            onValueChange={onProviderChange}
            disabled={disabled || targets.length > 1 || configuredProfiles.length === 0}
          />
        <FrontSelect
          ariaLabel={copy.model}
          searchable
          searchPlaceholder={copy.searchModels}
          emptyText={copy.noMatchingModels}
          label={<span className="model-selector__field-label"><span>{copy.model}</span>{selectedCatalog.status === "loading" ? <span className="model-selector__field-state"><LoaderCircle aria-hidden="true" size={11} strokeWidth={2} />{copy.loadingModels}</span> : null}</span>}
          placeholder={modelPlaceholder}
          options={selectedCatalog.models.map((model) => ({
            value: model,
            keywords: model,
            label: <ModelOptionLabel copy={copy} modelId={model} metadata={selectedCatalog.metadata?.[model]} showPrivacyMode={configuredProfiles.find((profile) => profile.id === selectedTarget?.providerId)?.kind === "nearai"} />,
            disabled: selectedTarget ? isDuplicateModelTarget(targets, { providerId: selectedTarget.providerId, modelId: model }, selectedTargetIndex) : false
          }))}
          value={selectedTarget?.modelId ?? ""}
          onValueChange={(modelId) => handleTargetChange(selectedTargetIndex, modelId)}
          disabled={disabled || !selectedTarget || selectedCatalog.status !== "ready" || selectedCatalog.models.length === 0}
        />
        </div>
        <button aria-controls="model-comparison-panel" aria-expanded={comparisonOpen} className="model-selector__comparison-toggle" disabled={disabled} onClick={() => setComparisonOpen((open) => !open)} type="button">
          <GitCompareArrows aria-hidden="true" size={17} strokeWidth={1.8} />
          <span>{copy.modelComparison}</span>
          <strong aria-label={`${targets.length} / 4`}>{targets.length}/4</strong>
          <ChevronDown aria-hidden="true" className={comparisonOpen ? "is-open" : ""} size={15} strokeWidth={1.8} />
        </button>
      </div>
      <section aria-label={copy.activeModelSet} className="model-selector__comparison" hidden={!comparisonOpen} id="model-comparison-panel">
        <div className="model-selector__comparison-heading">
          <span>{copy.activeModelSet}</span>
          <span aria-label={`${targets.length} / 4`} className="model-selector__count">{targets.length}/4</span>
        </div>
        <div className="model-selector__chips" role="list">
          {targets.map((target, targetIndex) => {
            const profileName = configuredProfiles.find((profile) => profile.id === target.providerId)?.name ?? target.providerId;
            const chipCatalog = targetCatalogs[target.providerId] ?? { status: "idle" as const, models: [], metadata: {} };
            return <span className={`model-selector__chip${targetIndex === selectedTargetIndex ? " model-selector__chip--editing" : ""}`} key={`${target.providerId}:${target.modelId}:${targetIndex}`} role="listitem">
              <span className="model-selector__chip-provider">{profileName}</span>
              <FrontSelect
                ariaLabel={`${copy.model}: ${profileName} ${target.modelId}`}
                searchable
                searchPlaceholder={copy.searchModels}
                emptyText={copy.noMatchingModels}
                className="model-selector__chip-model-select"
                options={chipCatalog.models.map((model) => ({
                  value: model,
                  keywords: model,
                  label: <ModelOptionLabel copy={copy} modelId={model} metadata={chipCatalog.metadata?.[model]} showPrivacyMode={configuredProfiles.find((profile) => profile.id === target.providerId)?.kind === "nearai"} />,
                  disabled: isDuplicateModelTarget(targets, { providerId: target.providerId, modelId: model }, targetIndex)
                }))}
                placeholder={copy.selectModel}
                value={target.modelId}
                onValueChange={(modelId) => {
                  setEditingTargetIndex(targetIndex);
                  handleTargetChange(targetIndex, modelId);
                }}
                disabled={disabled || chipCatalog.status !== "ready" || chipCatalog.models.length === 0}
              />
              {onRemoveModel && targets.length > 1 ? <button aria-label={`${copy.removeModel}: ${profileName} ${target.modelId}`} className="model-selector__chip-remove" disabled={disabled} onClick={() => onRemoveModel(target)} title={copy.removeModel} type="button"><X aria-hidden="true" size={15} strokeWidth={2} /></button> : null}
            </span>;
          })}
          {targets.length === 0 ? <p className="model-selector__empty">{copy.selectProvider}</p> : null}
        </div>
        {onAddModel && targets.length < 4 && addableProfiles.length > 0 ? <Popover className="model-selector__add-menu">
          <PopoverButton className="model-selector__add-button" disabled={disabled} type="button"><Plus aria-hidden="true" size={16} strokeWidth={2} />{copy.addModel}</PopoverButton>
          <PopoverPanel static anchor="bottom start" portal className="model-selector__add-menu-items">
            {({ close }) => <Combobox value={null} onChange={(selection: { profile: ProviderProfile; modelId: string } | null) => {
              if (!selection) return;
              onAddModel(selection.profile, selection.modelId);
              setEditingTargetIndex(targets.length);
              setComparisonOpen(true);
              setAddModelQuery("");
              close();
            }} immediate nullable>
              <div className="model-selector__add-search"><Search aria-hidden="true" size={13} strokeWidth={1.8} /><ComboboxInput autoFocus aria-label={copy.searchModels} onChange={(event) => setAddModelQuery(event.target.value)} placeholder={copy.searchModels} /></div>
              <ComboboxOptions static className="model-selector__add-options">
                {filteredAddableProfiles.length > 0 ? filteredAddableProfiles.map(({ profile, models }) => <div aria-label={profile.name} className="model-selector__add-provider" key={profile.id} role="group">
                  <span className="model-selector__add-provider-name">{profile.name}</span>
                  {models.map((modelId) => <ComboboxOption key={modelId} value={{ profile, modelId }} className="model-selector__add-option"><ModelOptionLabel copy={copy} modelId={modelId} metadata={targetCatalogs[profile.id]?.metadata?.[modelId]} showPrivacyMode={profile.kind === "nearai"} /><Plus aria-hidden="true" size={14} strokeWidth={2} /></ComboboxOption>)}
                </div>) : <p className="model-selector__empty">{copy.noMatchingModels}</p>}
              </ComboboxOptions>
            </Combobox>}
          </PopoverPanel>
        </Popover> : null}
      </section>
      <div className="model-selector__status" aria-live="polite">
        {selectedCatalog.status === "loading" ? copy.loadingModels : null}
        {selectedCatalog.status === "error" ? copy.modelsUnavailable : null}
        {selectedCatalog.status === "ready" && selectedCatalog.models.length === 0 ? copy.noModels : null}
        {selectedModelUnavailable ? copy.modelUnavailable : null}
      </div>
    </div>
  );
}

export function ProviderSettings({
  id,
  profiles,
  onSave,
  onTest,
  onDelete,
  onDeleteKey,
  copy = englishConversationCopy
}: {
  id?: string;
  profiles: ProviderProfile[];
  onSave: (input: ProviderProfileInput) => Promise<ProviderProfile>;
  onTest: (input: ProviderProfileInput) => Promise<string[]>;
  onDelete: (id: string) => Promise<void>;
  onDeleteKey: (id: string) => Promise<void>;
  copy?: ApplicationCopy;
}) {
  const existing = profiles[0];
  const [selectedProviderId, setSelectedProviderId] = useState(existing?.id ?? "");
  const selectedProfile = profiles.find((profile) => profile.id === selectedProviderId);
  const [kind, setKind] = useState<"nearai" | "openai_compatible">(selectedProfile?.kind ?? "nearai");
  const [name, setName] = useState(selectedProfile?.name ?? "NearAI");
  const [endpoint, setEndpoint] = useState(selectedProfile?.endpoint ?? "https://cloud-stg-api.near.ai");
  const [authMethod, setAuthMethod] = useState<"bearer" | "x_api_key">(selectedProfile?.auth_method ?? "bearer");
  const [model, setModel] = useState(selectedProfile?.model_id ?? "");
  const [secret, setSecret] = useState("");
  const [models, setModels] = useState<string[]>(selectedProfile?.model_id ? [selectedProfile.model_id] : []);
  const [isTesting, setIsTesting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [connectionTest, setConnectionTest] = useState<"idle" | "verified" | "failed">("idle");
  const [feedback, setFeedback] = useState<ProviderFeedback>();
  const [rotateOpen, setRotateOpen] = useState(false);

  useEffect(() => {
    if (selectedProviderId === "__new__" || (selectedProviderId && selectedProfile)) {
      return;
    }
    if (profiles.length === 0) {
      return;
    }
    selectProvider(profiles[0].id);
  }, [profiles, selectedProfile, selectedProviderId]);

  const input = (): ProviderProfileInput => ({
    id: selectedProfile?.id,
    kind,
    name,
    endpoint,
    model_id: model,
    auth_method: authMethod,
    ...(secret ? { secret } : {})
  });

  function selectProvider(id: string) {
    const profile = profiles.find((candidate) => candidate.id === id);
    setSelectedProviderId(id);
    setKind(profile?.kind ?? "nearai");
    setName(profile?.name ?? "NearAI");
    setEndpoint(profile?.endpoint ?? "https://cloud-stg-api.near.ai");
    setAuthMethod(profile?.auth_method ?? "bearer");
    setModel(profile?.model_id ?? "");
    setModels(profile?.model_id ? [profile.model_id] : []);
    setSecret("");
    setConnectionTest("idle");
    setFeedback(undefined);
  }

  function startNewProvider() {
    setSelectedProviderId("__new__");
    setKind("openai_compatible");
    setName("");
    setEndpoint("");
    setAuthMethod("bearer");
    setModel("");
    setModels([]);
    setSecret("");
    setConnectionTest("idle");
    setFeedback(undefined);
  }

  async function testConnection() {
    setIsTesting(true);
    setFeedback(undefined);
    try {
      const availableModels = await onTest(input());
      setModels(availableModels);
      const nextModel = defaultModelAfterTest(availableModels, model);
      if (nextModel !== model) {
        setModel(nextModel);
      }
      setConnectionTest("verified");
      setFeedback({ text: copy.providerTested, tone: "success" });
    } catch (error) {
      setConnectionTest("failed");
      setFeedback(providerErrorFeedback(error, copy));
    } finally {
      setIsTesting(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setFeedback({ text: copy.providerNameRequired, tone: "error" });
      return;
    }
    if (!model.trim()) {
      setFeedback({ text: copy.modelRequired, tone: "error" });
      return;
    }
    try {
      const saved = await onSave(input());
      setSelectedProviderId(saved.id);
      setKind(saved.kind);
      setName(saved.name);
      setEndpoint(saved.endpoint);
      setAuthMethod(saved.auth_method);
      setModel(saved.model_id);
      setModels(saved.model_id ? [saved.model_id] : models);
      setSecret("");
      setConnectionTest("verified");
      setFeedback({ text: copy.providerSaved, tone: "success" });
    } catch (error) {
      setFeedback(providerErrorFeedback(error, copy));
    }
  }

  async function removeKey() {
    if (!selectedProfile) {
      return;
    }
    setIsDeleting(true);
    setFeedback(undefined);
    try {
      await onDeleteKey(selectedProfile.id);
      setSecret("");
      setFeedback({ text: copy.keyDeleted, tone: "success" });
    } catch (error) {
      setFeedback(providerErrorFeedback(error, copy, copy.keyDeleteFailed));
    } finally {
      setIsDeleting(false);
    }
  }

  async function removeProvider() {
    if (!selectedProfile) {
      return;
    }
    setIsDeleting(true);
    setFeedback(undefined);
    try {
      await onDelete(selectedProfile.id);
      startNewProvider();
      setFeedback({ text: copy.providerDeleted, tone: "success" });
    } catch (error) {
      setFeedback(providerErrorFeedback(error, copy, copy.providerDeleteFailed));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="provider-settings" id={id} aria-label={copy.providerSettings}>
      <div className="provider-settings__heading">
        <div>
          <h2>{copy.providerSettings}</h2>
        </div>
        <span className={`provider-status provider-status--${providerConnectionStatus(connectionTest, selectedProfile?.configured)}`} data-connection-test={connectionTest}>
          {providerConnectionLabel(connectionTest, selectedProfile?.configured, copy)}
        </span>
      </div>
      <p className="settings-section__lede">{copy.settingsProviderLede}</p>
      <form className="provider-settings__form" onSubmit={save}>
        <div className={`prov${selectedProfile?.configured ? " prov--configured" : ""}`}>
          <div className="prov__head">
            <span className={`prov__sq${kind === "nearai" ? " prov__sq--sig" : ""}`} />
            <span className="prov__name">{name || copy.newProvider}</span>
            <span className={`prov__kind${kind === "nearai" ? " prov__kind--sig" : ""}`}>{kind === "nearai" ? copy.presetConfidential : copy.customEndpoint}</span>
            <span className="prov__status"><span className={`dot${selectedProfile?.configured ? "" : " dot--grey"}`} />{selectedProfile?.configured ? copy.keyInKeychainConfigured : copy.unconfigured}</span>
          </div>
          <div className="prov__body">
            {profiles.length > 0 ? <FrontSelect
              ariaLabel={copy.provider}
              label={copy.provider}
              options={[...profiles.map((profile) => ({ value: profile.id, label: profile.name })), { value: "__new__", label: copy.newProvider }]}
              value={selectedProviderId}
              onValueChange={(providerId) => providerId === "__new__" ? startNewProvider() : selectProvider(providerId)}
            /> : null}
            {selectedProfile ? <dl className="spec-line"><dt>{copy.provider}</dt><dd>{kind === "nearai" ? copy.nearai : copy.openaiCompatible}</dd></dl> : <FrontSelect
              ariaLabel={copy.provider}
              label={copy.provider}
              options={[{ value: "nearai", label: copy.nearai }, { value: "openai_compatible", label: copy.openaiCompatible }]}
              value={kind}
              onValueChange={(value) => {
                const nextKind = value as "nearai" | "openai_compatible";
                setKind(nextKind);
                if (nextKind === "nearai") {
                  setName("NearAI");
                  setEndpoint("https://cloud-stg-api.near.ai");
                  setAuthMethod("bearer");
                }
              }}
            />}
            <label>
              {copy.displayName}
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              {copy.endpoint}
              <input readOnly={kind === "nearai"} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
            </label>
            <FrontSelect
              ariaLabel={copy.authentication}
              label={copy.authentication}
              options={[{ value: "bearer", label: copy.bearer }, { value: "x_api_key", label: copy.apiKeyHeader }]}
              value={authMethod}
              onValueChange={(value) => setAuthMethod(value as "bearer" | "x_api_key")}
            />
            <FrontSelect
              ariaLabel={copy.model}
              label={copy.model}
              searchable
              searchPlaceholder={copy.searchModels}
              emptyText={copy.noMatchingModels}
              options={[{ value: "", label: copy.selectModel }, ...models.map((availableModel) => ({ value: availableModel, label: availableModel }))]}
              value={model}
              onValueChange={setModel}
            />
          </div>
          <div className={`rotate${rotateOpen ? " is-open" : ""}`}>
            <div className="rotate__label">{copy.keyRotation}</div>
            <label>
              {copy.secret}
              <input autoComplete="new-password" type="password" value={secret} onChange={(event) => { setSecret(event.target.value); setConnectionTest("idle"); }} />
            </label>
            <p className="rotate__hint">{copy.keyRotationHint}</p>
          </div>
          <div className="prov__foot provider-settings__actions">
            <button type="button" onClick={() => void testConnection()} disabled={isTesting || isDeleting}>{isTesting ? copy.testing : copy.testConnection}</button>
            <button type="button" onClick={() => setRotateOpen((open) => !open)} disabled={isDeleting}><KeyRound aria-hidden="true" size={13} strokeWidth={1.8} />{copy.rotateKey}</button>
            <button type="submit" disabled={isDeleting}>{copy.saveProvider}</button>
            {selectedProfile ? <button type="button" onClick={() => void removeKey()} disabled={isDeleting}>{copy.removeKey}</button> : null}
            {selectedProfile ? <button className="btn--danger" type="button" onClick={() => void removeProvider()} disabled={isDeleting}>{copy.removeProvider}</button> : null}
          </div>
        </div>
      </form>
      {feedback ? <p className={`provider-settings__message provider-settings__message--${feedback.tone}`} role="status">{feedback.text}</p> : null}
    </section>
  );
}

export function WorkspaceSettingsPanel({
  settings,
  onSave,
  copy = englishConversationCopy
}: {
  settings: WorkspaceSettings;
  onSave: (settings: WorkspaceSettings) => Promise<void>;
  copy?: ApplicationCopy;
}) {
  const [theme, setTheme] = useState<ThemePreference>(settings.theme);
  const locale = "en" as const;
  const [systemPrompt, setSystemPrompt] = useState(settings.system_prompt);
  const [temperature, setTemperature] = useState(modelParameterFormValue(settings.temperature));
  const [topP, setTopP] = useState(modelParameterFormValue(settings.top_p));
  const [maxTokens, setMaxTokens] = useState(modelParameterFormValue(settings.max_tokens));
  const [feedback, setFeedback] = useState<ProviderFeedback>();

  useEffect(() => {
    setTheme(settings.theme);
    setSystemPrompt(settings.system_prompt);
    setTemperature(modelParameterFormValue(settings.temperature));
    setTopP(modelParameterFormValue(settings.top_p));
    setMaxTokens(modelParameterFormValue(settings.max_tokens));
  }, [settings]);

  async function persistAppearance(next: { theme?: ThemePreference }) {
    const nextTheme = next.theme ?? theme;
    if (next.theme !== undefined) {
      setTheme(nextTheme);
      applyDocumentTheme(nextTheme);
    }
    if (!isSystemPromptWithinLimit(systemPrompt)) {
      return;
    }
    const parameters = parseModelParameters({ temperature, topP, maxTokens });
    if (!parameters) {
      return;
    }
    try {
      await onSave({
        theme: nextTheme,
        locale,
        system_prompt: systemPrompt,
        ...parameters,
        active_model_set: settings.active_model_set
      });
    } catch {
      setFeedback({ text: copy.settingsFailed, tone: "error" });
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!isSystemPromptWithinLimit(systemPrompt)) {
      setFeedback({ text: copy.promptTooLong, tone: "error" });
      return;
    }
		const parameters = parseModelParameters({ temperature, topP, maxTokens });
		if (!parameters) {
			setFeedback({ text: copy.modelParametersInvalid, tone: "error" });
			return;
		}
    try {
      await onSave({
        theme,
        locale,
        system_prompt: systemPrompt,
				...parameters,
		active_model_set: settings.active_model_set
      });
      setFeedback({ text: applicationMessages(locale).settingsSaved, tone: "success" });
    } catch {
      setFeedback({ text: copy.settingsFailed, tone: "error" });
    }
  }

  return <section className="workspace-settings" id="workspace-settings" aria-label={copy.settings}>
    <div className="workspace-settings__heading">
      <div>
        <h2>{copy.settings}</h2>
      </div>
    </div>
    <p className="settings-section__lede">{copy.settingsGeneralLede}</p>
    <form className="workspace-settings__form" onSubmit={save}>
      <div className="workspace-settings__row">
        <div className="workspace-settings__row-key"><span>{copy.language}</span><small>Interface</small></div>
        <p className="workspace-settings__row-detail">{copy.settingsLanguageDetail}</p>
        <div className="workspace-settings__row-control">
          <span aria-label={copy.language}>{copy.english}</span>
        </div>
      </div>
      <div className="workspace-settings__row">
        <div className="workspace-settings__row-key"><span>{copy.theme}</span><small>{copy.appearance}</small></div>
        <p className="workspace-settings__row-detail">{copy.settingsThemeDetail}</p>
        <div className="workspace-settings__row-control">
          <div className="seg" role="group" aria-label={copy.theme}>
            {([["light", copy.light], ["dark", copy.dark], ["system", copy.followSystem]] as const).map(([value, label]) => <button aria-pressed={theme === value} className={theme === value ? "is-on" : ""} key={value} onClick={() => void persistAppearance({ theme: value })} type="button">{label}</button>)}
          </div>
        </div>
      </div>
      <label className="workspace-settings__prompt">
        {copy.systemPrompt}
        <textarea
          value={systemPrompt}
          rows={4}
          aria-describedby="system-prompt-hint"
          onChange={(event) => {
            if (isSystemPromptWithinLimit(event.target.value)) {
              setSystemPrompt(event.target.value);
            }
          }}
        />
        <small id="system-prompt-hint">{copy.systemPromptHint}</small>
      </label>
			<fieldset className="workspace-settings__parameters">
				<legend>{copy.modelParameters}</legend>
				<small id="model-parameters-hint">{copy.modelParametersHint}</small>
				<div className="workspace-settings__parameter-fields">
					<label>
						{copy.temperature}
						<input aria-describedby="model-parameters-hint" inputMode="decimal" max="2" min="0" onChange={(event) => setTemperature(event.target.value)} step="0.1" type="number" value={temperature} />
					</label>
					<label>
						{copy.topP}
						<input aria-describedby="model-parameters-hint" inputMode="decimal" max="1" min="0" onChange={(event) => setTopP(event.target.value)} step="0.01" type="number" value={topP} />
					</label>
					<label>
						{copy.maxTokens}
						<input aria-describedby="model-parameters-hint" inputMode="numeric" min="1" onChange={(event) => setMaxTokens(event.target.value)} step="1" type="number" value={maxTokens} />
					</label>
				</div>
			</fieldset>
      <div className="workspace-settings__actions">
        <button type="submit">{copy.saveSettings}</button>
      </div>
    </form>
    {feedback ? <p className={`workspace-settings__message workspace-settings__message--${feedback.tone}`} role="status">{feedback.text}</p> : null}
  </section>;
}

export function ChatDataPanel({
  conversations = [],
  generationCount = 0,
  onDelete,
  deleteDisabled = false,
  onClear,
  onExport,
  isClearing = false,
  copy = englishConversationCopy
}: {
  conversations?: Conversation[];
  generationCount?: number;
  onDelete?: (id: string) => void;
  deleteDisabled?: boolean;
  onClear: () => void;
  onExport?: (format: ConversationExportFormat) => void;
  isClearing?: boolean;
  copy?: ApplicationCopy;
}) {
  return <section className="chat-data" aria-label={copy.chatData}>
    <div className="chat-data__heading">
      <div>
        <h2>{copy.chatData}</h2>
      </div>
    </div>
    <p className="settings-section__lede">{copy.settingsChatDataLede}</p>
    <p className="chat-data__scope">{copy.clearChatDataScope}</p>
    <div className="data-stats">
      <div className="data-stats__cell">
        <div className="data-stats__k">{copy.localConversationsStat}</div>
        <div className="data-stats__v">{conversations.length}</div>
        <div className="data-stats__s">{copy.includingComparisons}</div>
      </div>
      <div className="data-stats__cell">
        <div className="data-stats__k">{copy.generationRecords}</div>
        <div className="data-stats__v">{generationCount}</div>
        <div className="data-stats__s">{copy.eachWithSnapshot}</div>
      </div>
      <div className="data-stats__cell">
        <div className="data-stats__k">{copy.cloudStorage}</div>
        <div className="data-stats__v">0<i>bytes</i></div>
        <div className="data-stats__s">{copy.coveHasNoCloudStore}</div>
      </div>
    </div>
    <div className="workspace-settings__row chat-data__export">
      <div className="workspace-settings__row-key"><span>{copy.exportConversationHistory}</span><small>{copy.conversations}</small></div>
      <p className="workspace-settings__row-detail">{copy.workspaceExportHint}</p>
      <div className="workspace-settings__row-control">
        <button className="btn" disabled={!onExport} onClick={() => onExport?.("json")} type="button"><Download aria-hidden="true" size={13} strokeWidth={1.8} />{copy.exportAsJson}</button>
        <button className="btn" disabled={!onExport} onClick={() => onExport?.("markdown")} type="button"><Download aria-hidden="true" size={13} strokeWidth={1.8} />{copy.exportAsMarkdown}</button>
      </div>
    </div>
    <div className="chat-data__conversations">
      <h3>{copy.conversations}</h3>
      {conversations.length === 0 ? <p className="chat-data__empty">{copy.noConversations}</p> : <ul>
        {conversations.map((conversation, index) => <li key={conversation.id}>
          <span aria-hidden="true" className="chat-data__conversation-index">{String(index + 1).padStart(2, "0")}</span>
          <span className="chat-data__conversation-copy">
            <strong title={conversation.title}>{conversation.title}</strong>
            <time dateTime={conversation.updated_at}>{formatDate(conversation.updated_at)}</time>
          </span>
          {onDelete ? <button
            aria-label={`${copy.deleteConversation}: ${conversation.title}`}
            disabled={isClearing || deleteDisabled}
            onClick={() => onDelete(conversation.id)}
            type="button"
          ><Trash2 aria-hidden="true" size={13} strokeWidth={1.8} /><span>{copy.deleteConversation}</span></button> : null}
        </li>)}
      </ul>}
    </div>
    <div className="danger">
      <div>
        <div className="danger__t">{copy.clearChatData}</div>
        <div className="danger__d">{copy.clearChatDataScope}</div>
      </div>
      <button className="chat-data__clear btn btn--danger" disabled={isClearing} onClick={onClear} type="button">
        <Trash2 aria-hidden="true" size={13} strokeWidth={1.8} />
        <span>{isClearing ? copy.clearingChatData : copy.clearChatData}</span>
      </button>
    </div>
  </section>;
}

export function ConversationList({
  conversations,
  selectedId,
  showingArchived = false,
  onSelect,
  onCreate,
  onRename,
  onPin,
  onArchive,
  onDownload,
  onDelete,
  onShowArchived,
  onOpenSettings,
  onOpenPrivacyStatus,
  deleteDisabled = false,
  copy = englishConversationCopy
}: {
  conversations: Conversation[];
  selectedId: string | undefined;
  showingArchived?: boolean;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  onRename?: (conversation: Conversation) => void;
  onPin?: (conversation: Conversation) => void;
  onArchive?: (conversation: Conversation) => void;
  onDownload?: (conversation: Conversation) => void;
  onDelete?: (id: string) => void;
  onShowArchived?: (archived: boolean) => void;
  onOpenSettings?: () => void;
  onOpenPrivacyStatus?: () => void;
  deleteDisabled?: boolean;
  copy?: ApplicationCopy;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    if (typeof window !== "undefined") window.addEventListener("keydown", handleKeyDown);
    return () => {
      if (typeof window !== "undefined") window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleConversations = normalizedQuery
    ? conversations.filter((conversation) => conversation.title.toLowerCase().includes(normalizedQuery))
    : conversations;
  const groups = groupConversations(visibleConversations, !showingArchived);

  return (
    <div className="conversation-list-shell" data-workspace-region="conversation-list">
      <div className="conversation-list__header">
        <button aria-label={copy.newConversation} className="conversation-list__new" disabled={deleteDisabled} onClick={onCreate} type="button">
          <Plus aria-hidden="true" size={17} strokeWidth={1.9} />
          <span>{copy.newChat}</span>
        </button>
      </div>
      <label className="conversation-list__search">
        <Search aria-hidden="true" size={12} strokeWidth={1.8} />
        <input aria-label={copy.searchPlaceholder} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} ref={searchRef} type="text" value={query} />
        <kbd>⌘K</kbd>
      </label>
      {conversations.length === 0 ? <p className="conversation-list__empty">{copy.noConversations}</p> : visibleConversations.length === 0 ? <p className="conversation-list__empty">{copy.searchNoResults}</p> : (
        <nav className="conversation-list" aria-label={copy.chats}>
          {(() => {
            let visibleIndex = 0;
            return groups.map((group) => <section className="conversation-list__group" key={group.id}>
              <p className="conversation-list__section-label">{group.label(copy)}</p>
              {group.conversations.map((conversation) => {
                visibleIndex += 1;
                const entryIndex = String(visibleIndex).padStart(2, "0");
                return <div className="conversation-row" key={conversation.id}>
                  <button
                    className={conversation.id === selectedId ? "conversation conversation--selected" : "conversation"}
                    aria-current={conversation.id === selectedId ? "page" : undefined}
                    onClick={() => onSelect(conversation.id)}
                    type="button"
                  >
                    <span className="conversation__no">{entryIndex}</span>
                    <span className="conversation__title">{conversation.title}</span>
                    <span aria-hidden="true" className="conversation__dots" />
                    <time className="conversation__time" dateTime={conversation.updated_at}>{formatDate(conversation.updated_at)}</time>
                  </button>
                  {onRename || onPin || onArchive || onDownload || onDelete ? <ConversationActions
                    conversation={conversation}
                    disabled={deleteDisabled}
                    onArchive={onArchive}
                    onDelete={onDelete}
                    onDownload={onDownload}
                    onPin={onPin}
                    onRename={onRename}
                    copy={copy}
                  /> : null}
                </div>;
              })}
            </section>)})()}
        </nav>
      )}
      <div className="conversation-list__footer">
        {onOpenPrivacyStatus ? <button className="conversation-list__privacy" onClick={onOpenPrivacyStatus} type="button">
          <ShieldCheck aria-hidden="true" size={15} strokeWidth={1.8} />
          <span>{copy.privacyStatus}</span>
          <em>{copy.privateLocalFirst}</em>
        </button> : null}
        <p className="conversation-list__note">{copy.privacyFootNote}</p>
        {onShowArchived ? <button
          aria-pressed={showingArchived}
          className="conversation-list__archive-toggle"
          disabled={deleteDisabled}
          onClick={() => onShowArchived(!showingArchived)}
          type="button"
        >{showingArchived ? copy.allChats : copy.archivedChats}</button> : null}
        <a className="conversation-list__feedback" href="https://github.com/tokenfunplus/cove/issues/new/choose" rel="noreferrer" target="_blank">
          <MessageCircleMore aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{copy.feedback}</span>
        </a>
        <button aria-label={copy.settingsNav} className="conversation-list__settings" onClick={onOpenSettings} type="button">
          <Settings2 aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{copy.settings}</span>
        </button>
      </div>
    </div>
  );
}

function ConversationActions({
  conversation,
  disabled,
  onRename,
  onPin,
  onArchive,
  onDownload,
  onDelete,
  copy
}: {
  conversation: Conversation;
  disabled: boolean;
  onRename?: (conversation: Conversation) => void;
  onPin?: (conversation: Conversation) => void;
  onArchive?: (conversation: Conversation) => void;
  onDownload?: (conversation: Conversation) => void;
  onDelete?: (id: string) => void;
  copy: ApplicationCopy;
}) {
  return <Menu as="div" className="conversation-actions">
    <MenuButton aria-label={`${copy.conversationActions}: ${conversation.title}`} className="conversation-actions__trigger" disabled={disabled} type="button"><MoreHorizontal aria-hidden="true" size={17} strokeWidth={2} /></MenuButton>
    <MenuItems anchor="bottom end" portal className="conversation-actions__menu" transition>
      {onPin ? <MenuItem><button onClick={() => onPin(conversation)} type="button">{conversation.pinned ? copy.unpinConversation : copy.pinConversation}</button></MenuItem> : null}
      {onRename ? <MenuItem><button onClick={() => onRename(conversation)} type="button">{copy.renameConversation}</button></MenuItem> : null}
      {onArchive ? <MenuItem><button onClick={() => onArchive(conversation)} type="button">{conversation.archived ? copy.unarchiveConversation : copy.archiveConversation}</button></MenuItem> : null}
      {onDownload ? <MenuItem><button onClick={() => onDownload(conversation)} type="button">{copy.downloadConversation}</button></MenuItem> : null}
      {onDelete ? <MenuItem><button className="conversation-actions__delete" onClick={() => onDelete(conversation.id)} type="button">{copy.deleteConversation}</button></MenuItem> : null}
    </MenuItems>
  </Menu>;
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  onCancel,
  onConfirm,
  copy = englishConversationCopy
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  copy?: ApplicationCopy;
}) {
  return <Dialog className="conversation-dialog confirmation-dialog" onClose={onCancel} open={open}>
    <DialogBackdrop className="conversation-dialog__backdrop" />
    <div className="conversation-dialog__viewport">
      <DialogPanel className="conversation-dialog__panel confirmation-dialog__panel">
        <div className="confirmation-dialog__icon" aria-hidden="true"><TriangleAlert size={20} strokeWidth={1.8} /></div>
        <DialogTitle as="h2">{title}</DialogTitle>
        <p>{description}</p>
        <div className="conversation-dialog__actions">
          <button onClick={onCancel} type="button">{copy.cancel}</button>
          <button autoFocus className={destructive ? "confirmation-dialog__confirm confirmation-dialog__confirm--danger" : "confirmation-dialog__confirm"} onClick={onConfirm} type="button">{confirmLabel}</button>
        </div>
      </DialogPanel>
    </div>
  </Dialog>;
}

export function ConversationRenameDialog({
  conversation,
  isSaving,
  onClose,
  onSave,
  copy = englishConversationCopy
}: {
  conversation: Conversation | undefined;
  isSaving: boolean;
  onClose: () => void;
  onSave: (title: string) => void;
  copy?: ApplicationCopy;
}) {
  const [title, setTitle] = useState(conversation?.title ?? "");
  useEffect(() => setTitle(conversation?.title ?? ""), [conversation?.id, conversation?.title]);

  return <Dialog className="conversation-dialog" onClose={onClose} open={Boolean(conversation)}>
    <DialogBackdrop className="conversation-dialog__backdrop" />
    <div className="conversation-dialog__viewport">
      <DialogPanel className="conversation-dialog__panel">
        <DialogTitle as="h2">{copy.renameConversation}</DialogTitle>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) onSave(title);
        }}>
          <label htmlFor="conversation-title">{copy.conversationTitle}</label>
          <input autoFocus disabled={isSaving} id="conversation-title" onChange={(event) => setTitle(event.target.value)} value={title} />
          <div className="conversation-dialog__actions">
            <button disabled={isSaving} onClick={onClose} type="button">{copy.cancel}</button>
            <button disabled={isSaving || !title.trim()} type="submit">{isSaving ? copy.saving : copy.saveTitle}</button>
          </div>
        </form>
      </DialogPanel>
    </div>
  </Dialog>;
}

export function ConversationDownloadDialog({
  conversation,
  onClose,
  onDownload,
  copy = englishConversationCopy
}: {
  conversation: ConversationView | undefined;
  onClose: () => void;
  onDownload: (format: ConversationExportFormat) => void;
  copy?: ApplicationCopy;
}) {
  return <Dialog className="conversation-dialog" onClose={onClose} open={Boolean(conversation)}>
    <DialogBackdrop className="conversation-dialog__backdrop" />
    <div className="conversation-dialog__viewport">
      <DialogPanel className="conversation-dialog__panel">
        <DialogTitle as="h2">{copy.downloadConversation}</DialogTitle>
        <p>{copy.downloadConversationHint}</p>
        <div className="conversation-dialog__actions conversation-dialog__actions--download">
          <button onClick={() => onDownload("markdown")} type="button">{copy.downloadAsMarkdown}</button>
          <button onClick={() => onDownload("json")} type="button">{copy.downloadAsJSON}</button>
          <button onClick={onClose} type="button">{copy.cancel}</button>
        </div>
      </DialogPanel>
    </div>
  </Dialog>;
}

export function SidebarToggle({ collapsed, onToggle, copy = englishConversationCopy }: {
  collapsed: boolean;
  onToggle: () => void;
  copy?: ApplicationCopy;
}) {
  return <button
    aria-controls="conversation-sidebar"
    aria-expanded={!collapsed}
    aria-label={collapsed ? copy.expandSidebar : copy.collapseSidebar}
    className="workspace-sidebar__toggle"
    onClick={onToggle}
    type="button"
  >{collapsed ? <PanelLeftOpen aria-hidden="true" size={16} strokeWidth={1.8} /> : <PanelLeftClose aria-hidden="true" size={16} strokeWidth={1.8} />}</button>;
}

type ConversationGroup = {
  id: "pinned" | "today" | "previous7Days" | "older";
  label: (copy: ApplicationCopy) => string;
  conversations: Conversation[];
};

export function groupConversations(conversations: Conversation[], includePinned = true): ConversationGroup[] {
  const buckets: Record<ConversationGroup["id"], Conversation[]> = { pinned: [], today: [], previous7Days: [], older: [] };
  const today = startOfLocalDay(new Date());

  for (const conversation of conversations) {
    if (includePinned && conversation.pinned) {
      buckets.pinned.push(conversation);
      continue;
    }
    const updated = startOfLocalDay(new Date(conversation.updated_at));
    const ageInDays = Math.floor((today.getTime() - updated.getTime()) / 86_400_000);
    const group = ageInDays <= 0 ? "today" : ageInDays <= 7 ? "previous7Days" : "older";
    buckets[group].push(conversation);
  }

  const definitions: Array<Pick<ConversationGroup, "id" | "label">> = [
    ...(includePinned ? [{ id: "pinned" as const, label: (copy: ApplicationCopy) => copy.pinned }] : []),
    { id: "today", label: (copy) => copy.today },
    { id: "previous7Days", label: (copy) => copy.previous7Days },
    { id: "older", label: (copy) => copy.older }
  ];
  return definitions.filter(({ id }) => buckets[id].length > 0).map(({ id, label }) => ({ id, label, conversations: buckets[id] }));
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

type ModelAnswerPhase = "pending" | "verifying_environment" | "streaming" | "verifying_response" | "completed" | "stopped" | "failed" | "unknown";

function verificationLabel(verification: GenerationVerification | undefined, copy: ApplicationCopy): string | undefined {
  if (verification?.status === "verified_model") return copy.verificationVerified;
  if (verification?.status === "verified_gateway") return copy.verificationGateway;
  if (verification?.status === "pending") return copy.verificationPending;
  if (verification?.status === "failed") return copy.verificationFailed;
  if (verification?.status === "unsupported") return copy.verificationUnsupported;
  return undefined;
}

function generationFailureMessage(errorCode: string | undefined, copy: ApplicationCopy): string {
  if (errorCode === "output_limit") return copy.generationOutputLimit;
  if (errorCode === "empty_response") return copy.generationEmptyResponse;
  return copy.generationFailed;
}

function StopGenerationButton({ onClick, copy }: { onClick: () => void; copy: ApplicationCopy }) {
  return <button aria-label={copy.stopGeneration} className="generation-stop" onClick={onClick} title={copy.stopGeneration} type="button">
    <Square aria-hidden="true" fill="currentColor" size={12} strokeWidth={0} />
    <span className="generation-stop__label">{copy.stopGeneration}</span>
  </button>;
}

function PrivateGenerationProgress({ phase, copy, compact = false }: {
  phase: Extract<ModelAnswerPhase, "pending" | "verifying_environment" | "streaming" | "verifying_response">;
  copy: ApplicationCopy;
  compact?: boolean;
}) {
  const activeIndex = phase === "pending" || phase === "verifying_environment" ? 0 : phase === "streaming" ? 1 : 2;
  const headline = activeIndex === 0
    ? copy.privateConnectionCheckingEnvironment
    : activeIndex === 1
      ? copy.privateConnectionTestingEncryptedPath
      : copy.privateConnectionCheckingResponse;
  const steps = [copy.privateConnectionStepEnvironment, copy.privateConnectionStepEncryptedPath, copy.privateConnectionStepResponse];

  return <div aria-label={copy.privateGenerationProgressTitle} className={`private-generation-progress${compact ? " private-generation-progress--compact" : ""}`} data-secure-generation-progress={phase} role="status">
    <p><span aria-hidden="true" className="private-generation-progress__spinner" />{headline}</p>
    <ol aria-hidden={compact || undefined}>
      {steps.map((label, index) => <li data-state={index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending"} key={label}>
        <span aria-hidden="true">{index < activeIndex ? "✓" : index + 1}</span>
        {label}
      </li>)}
    </ol>
  </div>;
}

type VerificationRefresh = (kind: "model" | "gateway") => Promise<VerificationEvidence | undefined> | void;

async function invokeVerificationRefresh(refresh: VerificationRefresh | undefined, kind: "model" | "gateway"): Promise<VerificationEvidence | undefined> {
  return await refresh?.(kind) as VerificationEvidence | undefined;
}

function ModelAnswerCard({
  targetId,
  position,
  providerName,
  modelId,
  snapshot,
  verification,
  mode,
  body,
  phase,
  errorCode,
  createdAt,
  actions,
  selected = false,
  copy,
  onVerifyAgain
}: {
  targetId: string;
  position: number;
  providerName?: string;
  modelId: string;
  snapshot?: ProviderSnapshot;
  verification?: GenerationVerification;
  mode?: SecureInferenceMode;
  body: string;
  phase: ModelAnswerPhase;
  errorCode?: string;
  createdAt?: string;
  actions?: ReactNode;
  selected?: boolean;
  copy: ApplicationCopy;
  onVerifyAgain?: VerificationRefresh;
}) {
  const waiting = phase === "pending" || phase === "verifying_environment" || phase === "streaming" || phase === "verifying_response";
  const privateProgress = waiting && (verification?.status === "pending" || phase === "verifying_environment" || phase === "verifying_response");
  const stateMessage = phase === "verifying_environment"
    ? copy.privateInferenceVerifying
    : phase === "verifying_response"
      ? copy.privateInferenceVerifyingResponse
      : waiting
        ? copy.generationPending
    : phase === "stopped"
      ? copy.generationStopped
      : phase === "failed"
        ? generationFailureMessage(errorCode, copy)
        : phase === "unknown"
          ? copy.generationDeliveryUnknown
          : "";
  return <article className={`model-answer-card model-answer-card--${phase}${selected ? " model-answer-card--selected" : ""}`} data-generation-target={targetId}>
    <header className="model-answer-card__header">
      <span aria-hidden="true" className="model-answer-card__ordinal">{String(position + 1).padStart(2, "0")}</span>
      <div>
        <p>{copy.provider}</p>
        <h3 title={providerName || modelId}>{providerName || modelId}</h3>
      </div>
      <div className="model-answer-card__identity">
        <span className="model-answer-card__model" title={modelId}>{modelId}</span>
        {mode || verification ? <VerificationLanes copy={copy} mode={mode} verification={verification} /> : null}
        {selected ? <span className="model-answer-card__selected">{copy.selectedAnswer}</span> : null}
      </div>
      {createdAt ? <time className="model-answer-card__time" dateTime={createdAt}>{formatTime(createdAt)}</time> : null}
    </header>
    <div className="model-answer-card__body">
      {privateProgress ? <PrivateGenerationProgress phase={phase as Extract<ModelAnswerPhase, "pending" | "verifying_environment" | "streaming" | "verifying_response">} copy={copy} /> : null}
      {body ? <MarkdownMessage content={body} /> : !privateProgress && stateMessage ? <p className={`message__body${waiting ? " message__body--pending" : " message__state"}`}>{waiting ? <span aria-hidden="true" className="pending-dots">...</span> : null}{stateMessage}</p> : null}
    </div>
    {snapshot ? <ProviderSnapshotView copy={copy} snapshot={snapshot} /> : null}
    <VerificationDetailsButton verification={verification} providerName={providerName} modelId={modelId} copy={copy} onVerifyAgain={onVerifyAgain} />
    {actions ? <footer className="model-answer-card__actions">{actions}</footer> : null}
  </article>;
}

export function VerificationDialog({ kind, evidence, providerName, modelId, copy = englishConversationCopy, onVerifyAgain, onClose }: { kind: "model" | "gateway"; evidence: NonNullable<GenerationVerification["evidence"]>; providerName?: string; modelId?: string; copy?: ApplicationCopy; onVerifyAgain: (kind: "model" | "gateway") => Promise<VerificationEvidence | undefined>; onClose: () => void }) {
  const [activeKind, setActiveKind] = useState(kind);
  const [currentEvidence, setCurrentEvidence] = useState(evidence);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState(false);
  const [copiedQuote, setCopiedQuote] = useState(false);
  useEffect(() => setCurrentEvidence(evidence), [evidence]);
  useEffect(() => setActiveKind(kind), [kind]);
  const evidenceForKind = (nextKind: "model" | "gateway") => currentEvidence.kind === nextKind
    ? currentEvidence
    : nextKind === "gateway"
      ? (evidence.kind === "gateway" ? evidence : evidence.gateway ?? currentEvidence.gateway)
      : (evidence.kind === "model" ? evidence : evidence.model ?? currentEvidence.model);
  const displayedEvidence = evidenceForKind(activeKind);
  const changeKind = (nextKind: "model" | "gateway") => {
    if (nextKind === activeKind) return;
    const nextEvidence = evidenceForKind(nextKind);
    setActiveKind(nextKind);
    setVerificationError(false);
    setCopiedQuote(false);
    if (nextEvidence) {
      setCurrentEvidence(nextEvidence);
    }
  };
  const copyQuote = async (value: string) => {
    setCopiedQuote(false);
    const copied = await copyVerificationValue(value);
    setCopiedQuote(copied);
  };
  const refresh = async () => {
    setIsVerifying(true);
    setVerificationError(false);
    try {
      const refreshed = await onVerifyAgain(activeKind);
      if (refreshed) setCurrentEvidence(refreshed);
      else setVerificationError(true);
    } catch {
      setVerificationError(true);
    } finally {
      setIsVerifying(false);
    }
  };
  return <Dialog className="conversation-dialog verification-dialog" open onClose={onClose}>
    <DialogBackdrop className="conversation-dialog__backdrop" />
    <div className="conversation-dialog__viewport"><DialogPanel className="conversation-dialog__panel verification-dialog__panel" data-verification-dialog={kind}>
      <div className="verification-dialog__body">
        <VerificationDialogContent kind={activeKind} evidence={displayedEvidence} providerName={providerName} modelId={modelId} copy={copy} onClose={onClose} onKindChange={changeKind} onCopyQuote={copyQuote} copiedQuote={copiedQuote} hasModelEvidence hasGatewayEvidence />
        {isVerifying ? <p role="status">{copy.privateInferenceVerifying}</p> : null}
        {verificationError ? <p role="alert">{copy.privateInferenceFailed}</p> : null}
      </div>
      <div className="conversation-dialog__actions"><button type="button" disabled={isVerifying} onClick={() => void refresh()}>{copy.verifyAgain}</button><button type="button" onClick={onClose}>{copy.closeVerification}</button></div>
    </DialogPanel></div>
  </Dialog>;
}

export function VerificationDialogContent({ kind, evidence, providerName, modelId, copy = englishConversationCopy, onClose, onKindChange, onCopyQuote, copiedQuote = false, hasModelEvidence = true, hasGatewayEvidence = true }: { kind: "model" | "gateway"; evidence?: NonNullable<GenerationVerification["evidence"]>; providerName?: string; modelId?: string; copy?: ApplicationCopy; onClose?: () => void; onKindChange?: (kind: "model" | "gateway") => void; onCopyQuote?: (value: string) => void; copiedQuote?: boolean; hasModelEvidence?: boolean; hasGatewayEvidence?: boolean }) {
  const model = kind === "model";
  const relatedModel = evidence?.model ?? (model ? evidence : undefined);
  const relatedGateway = evidence?.gateway ?? (!model ? evidence : undefined);
  const rawValue = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
  return <div data-verification-dialog={kind}>
    <div className="verification-dialog__topline">
      <div className="verification-dialog__tabs" role="tablist" aria-label={copy.attestationEvidence}>
        <button role="tab" aria-selected={model} className={model ? "is-active" : ""} disabled={!hasModelEvidence} onClick={() => onKindChange?.("model")} type="button">{copy.modelVerification}</button>
        <button role="tab" aria-selected={!model} className={!model ? "is-active" : ""} disabled={!hasGatewayEvidence} onClick={() => onKindChange?.("gateway")} type="button">{copy.gatewayVerification}</button>
      </div>
      <button className="verification-dialog__close" type="button" aria-label={copy.closeVerification} onClick={onClose}>×</button>
    </div>
    <div className="verification-dialog__identity">
      <p>{model ? copy.privateModel : copy.privateGateway}</p>
      <h2>{model ? modelId || providerName || copy.privateModel : copy.nearAiCloudGateway}</h2>
      {model && providerName ? <span className="verification-dialog__provider">{providerName}</span> : null}
    </div>
    <p className="verification-dialog__hint">{model ? copy.modelVerificationHint : copy.gatewayVerificationHint}</p>
    {evidence ? <div className="verification-dialog__evidence-list">
      {model ? <details className="verification-dialog__evidence-card" data-verification-card="gpu">
        <summary><span>{copy.gpuAttestation.replace("NVIDIA ", "")}</span><strong>NVIDIA</strong></summary>
        <p>{evidence.gpu_evidence === "verified" ? copy.verificationVerified : copy.noGpuEvidence}</p>
        <pre>{rawValue({ gpu_evidence: evidence.gpu_evidence, deployment: evidence.deployment, raw: evidence.raw })}</pre>
      </details> : null}
      <details className="verification-dialog__evidence-card" data-verification-card="tdx">
        <summary><span>{copy.tdxAttestation}</span><strong>intel.</strong></summary>
        <p>{copy.verificationVerified}</p>
        <dl className="verification-dialog__facts">
          <div><dt>{copy.signer}</dt><dd>{evidence.signer_address ?? "—"}</dd></div>
          <div><dt>{copy.signingAlgorithm}</dt><dd>{evidence.signing_algorithm ?? "—"}</dd></div>
          <div><dt>{copy.tcbStatus}</dt><dd>{evidence.tcb_status ?? "—"}</dd></div>
          <div><dt>{copy.advisories}</dt><dd>{evidence.advisory_ids?.join(", ") || "—"}</dd></div>
        </dl>
        {!model ? <p>{copy.tlsPeerBinding}: {evidence.tls_binding === "attested" ? copy.verificationVerified : copy.tlsPeerBindingUnavailable}</p> : null}
        <label className="verification-dialog__quote-label"><span>{copy.quote}</span><button type="button" onClick={() => onCopyQuote?.(rawValue(evidence.raw))}>{copiedQuote ? copy.copied : copy.copy}</button><pre>{rawValue(evidence.raw)}</pre></label>
      </details>
    </div> : <p className="verification-dialog__empty" role="status">{copy.verificationEvidenceUnavailable}</p>}
    {model && relatedGateway ? <span className="verification-dialog__related" hidden>{relatedGateway.kind}</span> : null}
    {model && relatedModel ? <span className="verification-dialog__related" hidden>{relatedModel.kind}</span> : null}
  </div>;
}

export function signatureVerificationAvailable(verification: GenerationVerification | undefined): boolean {
  return Boolean(
    verification &&
    (verification.status === "verified_model" || verification.status === "verified_gateway") &&
    verification.signature_kind &&
    verification.signing_address &&
    verification.signing_algorithm &&
    verification.signed_message &&
    verification.signature
  );
}

export async function copyVerificationValue(value: string, clipboard: Pick<Clipboard, "writeText"> | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard): Promise<boolean> {
  if (!value || !clipboard?.writeText) return false;
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function SignatureVerificationDialog({ verification, copy = englishConversationCopy, onClose }: { verification: GenerationVerification; copy?: ApplicationCopy; onClose: () => void }) {
  const [copied, setCopied] = useState<string>();
  const [copyError, setCopyError] = useState(false);
  const copyValue = async (id: string, value: string | undefined) => {
    if (!value) return;
    const copiedValue = await copyVerificationValue(value);
    setCopied(copiedValue ? id : undefined);
    setCopyError(!copiedValue);
  };
  return <Dialog className="conversation-dialog signature-dialog" open onClose={onClose}>
    <DialogBackdrop className="conversation-dialog__backdrop" />
    <div className="conversation-dialog__viewport"><DialogPanel className="conversation-dialog__panel signature-dialog__panel" data-signature-verification="saved">
      <SignatureVerificationContent verification={verification} copy={copy} onCopy={copyValue} copied={copied} onClose={onClose} />
      {copyError ? <p role="alert">{copy.copyFailed}</p> : null}
    </DialogPanel></div>
  </Dialog>;
}

export function SignatureVerificationContent({ verification, copy = englishConversationCopy, onCopy, copied, onClose }: { verification: GenerationVerification; copy?: ApplicationCopy; onCopy?: (id: string, value: string | undefined) => void; copied?: string; onClose?: () => void }) {
  const values = [
    { id: "signer", label: copy.signatureAddress, value: verification.signing_address },
    { id: "signed-message", label: copy.signatureMessage, value: verification.signed_message },
    { id: "signature", label: copy.signature, value: verification.signature }
  ] as const;
  const providerTEE = verification.signature_kind === "provider_tee";
  return <div data-signature-verification="saved" data-signature-status={signatureVerificationAvailable(verification) ? "verified" : "unavailable"}>
    <div className="signature-dialog__heading"><h2>{copy.signatureVerification}</h2><button className="signature-dialog__close" aria-label={copy.closeVerification} onClick={onClose} type="button">×</button></div>
      {signatureVerificationAvailable(verification) ? <>
        <p className="signature-dialog__success" role="status"><BadgeCheck aria-hidden="true" size={18} strokeWidth={2} /><span><strong>{copy.messageSignatureVerified}</strong><small>{copy.messageSignatureConfirmed}</small></span><code>{verification.signing_algorithm}</code></p>
        <dl className="signature-dialog__fields">
          <div className="signature-dialog__fact"><dt>{copy.signingKind}</dt><dd><code>{verification.signature_kind}</code></dd></div>
          <div className="signature-dialog__fact"><dt>{copy.signingAlgorithm}</dt><dd><code>{verification.signing_algorithm}</code></dd></div>
          {values.map(({ id, label, value }) => <div className="signature-dialog__field" key={id} data-signature-field={id}><dt><span>{label}</span><button aria-label={`${copy.copy}: ${label}`} title={`${copy.copy}: ${label}`} type="button" onClick={() => onCopy?.(id, value)}>{copied === id ? <Check aria-hidden="true" size={15} strokeWidth={2} /> : <Copy aria-hidden="true" size={15} strokeWidth={2} />}<span className="signature-dialog__copy-label">{copied === id ? copy.copied : copy.copy}</span></button></dt><dd><pre>{value}</pre></dd></div>)}
        </dl>
        <footer className="signature-dialog__notes"><p>{providerTEE ? copy.providerTeeScope : copy.gatewayScope}</p><p>{copy.historicalSignature}</p></footer>
      </> : <p role="status">{copy.signatureUnavailable}</p>}
    </div>;
}

export function privacyStatusPresentation(status: PrivacyStatus, copy: ApplicationCopy = englishConversationCopy) {
  const statusLabel = status === "empty"
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
    sealDetail: attested ? copy.privacySealDetail : copy.privacyStatusHint
  };
}

export function PrivacyStatusPanel({
  open,
  summary,
  copy = englishConversationCopy,
  onClose,
  onVerifyAgain
}: {
  open: boolean;
  summary: PrivacyStatusSummary;
  copy?: ApplicationCopy;
  onClose: () => void;
  onVerifyAgain?: (targetID: string, kind: "model" | "gateway") => Promise<VerificationEvidence | undefined> | void;
}) {
  const [detail, setDetail] = useState<{ message: PrivacyVerifiedMessage; kind: "model" | "gateway" | "signature" }>();
  const { statusLabel, attested, sealTitle, sealDetail } = privacyStatusPresentation(summary.status, copy);
  const evidence = detail?.message.verification.evidence;
  const detailEvidence = detail && detail.kind !== "signature" && evidence
    ? detail.kind === "gateway" ? (evidence.gateway ?? evidence) : (evidence.model ?? evidence)
    : undefined;
  const detailDialog = detail?.kind === "model" && detailEvidence ? <VerificationDialog
    kind="model"
    evidence={detailEvidence}
    providerName={detail.message.providerName}
    modelId={detail.message.modelId}
    copy={copy}
    onVerifyAgain={(kind) => invokeVerificationRefresh(onVerifyAgain ? (nextKind) => onVerifyAgain(detail.message.targetId, nextKind) : undefined, kind)}
    onClose={() => setDetail(undefined)}
  /> : detail?.kind === "gateway" && detailEvidence ? <VerificationDialog
    kind="gateway"
    evidence={detailEvidence}
    providerName={detail.message.providerName}
    modelId={detail.message.modelId}
    copy={copy}
    onVerifyAgain={(kind) => invokeVerificationRefresh(onVerifyAgain ? (nextKind) => onVerifyAgain(detail.message.targetId, nextKind) : undefined, kind)}
    onClose={() => setDetail(undefined)}
  /> : detail?.kind === "signature" && signatureVerificationAvailable(detail.message.verification) ? <SignatureVerificationDialog verification={detail.message.verification} copy={copy} onClose={() => setDetail(undefined)} /> : null;
  return <>
    <Dialog className="conversation-dialog privacy-status-dialog" open={open} onClose={onClose}>
      <DialogBackdrop className="conversation-dialog__backdrop" />
      <div className="conversation-dialog__viewport"><DialogPanel className="conversation-dialog__panel privacy-status-panel" data-privacy-status={summary.status}>
        <header className="privacy-status-panel__head">
          <div>
            <p className="privacy-status-panel__eyebrow">{copy.privacyStatus} · {copy.specSheet}</p>
            <DialogTitle className="privacy-status-panel__title">{copy.privacyStatus}</DialogTitle>
          </div>
          <button aria-label={copy.closeVerification} className="privacy-status-panel__close" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </header>
        <div className="privacy-status-panel__body">
          <div className="seal" data-attested={attested}>
            <div className="seal__row">
              <span aria-hidden="true" className="seal__icon">{attested ? <ShieldCheck size={17} strokeWidth={1.8} /> : <CircleDashed size={17} strokeWidth={1.8} />}</span>
              <div>
                <div className="seal__t">{sealTitle}</div>
                <div className="seal__d">{sealDetail}</div>
              </div>
            </div>
            <div className="seal__fp"><span>{statusLabel}</span><span>{summary.status.toUpperCase()}</span></div>
          </div>
          <div className="dsec">
            <div className="dsec__no"><b>01</b><span>{copy.verifiedAssistantMessages}</span></div>
            <div className="dsec__stat"><b>{summary.verifiedAssistantMessageCount}<i>/</i>{Math.max(summary.privateModelCount, summary.verifiedAssistantMessageCount)}</b><span>{summary.verifiedAssistantMessageCount > 0 ? copy.proofChainsIntact : copy.noVerifiedMessages}</span></div>
            <div className="drow"><BadgeCheck aria-hidden="true" size={13} strokeWidth={2} /><b>{copy.privateModels}</b><code>{summary.privateModelCount}</code></div>
            <div className="drow"><BadgeCheck aria-hidden="true" size={13} strokeWidth={2} /><b>{copy.nvidiaEvidence}</b><code>{summary.nvidia.count}</code></div>
            <div className="drow"><BadgeCheck aria-hidden="true" size={13} strokeWidth={2} /><b>{copy.intelEvidence}</b><code>{summary.intel.count}</code></div>
          </div>
          <div className="dsec">
            <div className="dsec__no"><b>02</b><span>{copy.whereDataGoes}</span></div>
            <div className="dsec__stat"><b>0 <i>bytes</i></b><span>{copy.egressThroughOwnServers}</span></div>
            {attested ? <div className="drow"><LockKeyhole aria-hidden="true" size={13} strokeWidth={1.8} />{copy.computedInTee}<code>TEE</code></div> : null}
            <div className="drow"><LockKeyhole aria-hidden="true" size={13} strokeWidth={1.8} />{copy.keychainOnly}<code>local</code></div>
            <div className="drow"><LockKeyhole aria-hidden="true" size={13} strokeWidth={1.8} />{copy.noRelay}<code>no relay</code></div>
          </div>
          <div className="dsec">
            <div className="dsec__no"><b>03</b><span>{copy.contextSnapshot}</span></div>
            <details className="privacy-status-panel__messages">
              <summary>{copy.verifiedAssistantMessages} ({summary.verifiedAssistantMessageCount})</summary>
              {summary.verifiedMessages.length === 0 ? <p>{copy.noVerifiedMessages}</p> : <ul>
                {summary.verifiedMessages.map((message) => {
                  const messageEvidence = message.verification.evidence;
                  return <li key={message.messageId} className="privacy-status-panel__message">
                    <details>
                      <summary><span>{message.providerName}</span><span>{message.modelId}</span><span role="status">{verificationLabel(message.verification, copy) ?? copy.chatUnverified}</span></summary>
                      {message.body ? <p className="privacy-status-panel__message-body">{message.body}</p> : null}
                      <div className="privacy-status-panel__message-actions">
                        {messageEvidence ? <>
                          {(messageEvidence.kind === "model" || messageEvidence.model) ? <button aria-label={copy.openModelVerification} type="button" onClick={() => setDetail({ message, kind: "model" })}>{copy.modelVerification}</button> : null}
                          {(messageEvidence.kind === "gateway" || messageEvidence.gateway) ? <button aria-label={copy.openGatewayVerification} type="button" onClick={() => setDetail({ message, kind: "gateway" })}>{copy.gatewayVerification}</button> : null}
                        </> : null}
                        {signatureVerificationAvailable(message.verification) ? <button type="button" onClick={() => setDetail({ message, kind: "signature" })}>{copy.signatureVerification}</button> : null}
                      </div>
                    </details>
                  </li>;
                })}
              </ul>}
            </details>
          </div>
          <p className="privacy-status-panel__hint">{copy.privacyStatusHint}</p>
        </div>
        <footer className="privacy-status-panel__foot">{copy.specFooter}</footer>
      </DialogPanel></div>
    </Dialog>
    {detailDialog}
  </>;
}

function VerificationDetailsButton({ verification, providerName, modelId, copy, onVerifyAgain }: { verification?: GenerationVerification; providerName?: string; modelId?: string; copy: ApplicationCopy; onVerifyAgain?: VerificationRefresh }) {
  const [open, setOpen] = useState(false);
  const [openKind, setOpenKind] = useState<"model" | "gateway">();
  const [signatureOpen, setSignatureOpen] = useState(false);
  const evidence = verification?.evidence;
  if (!evidence) return null;
  const primaryKind = evidence.kind === "gateway" ? "gateway" : "model";
  return <>
    <Menu as="div" className="message__verification-menu">
      <MenuButton aria-label={copy.modelVerification} className="message__verification-trigger" title={copy.modelVerification} type="button">
        <BadgeCheck aria-hidden="true" size={15} strokeWidth={1.8} />
        <span>{copy.modelVerification}</span>
        <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
      </MenuButton>
      <MenuItems static className="message__verification-menu-items" transition>
        <MenuItem><button onClick={() => { setOpenKind(primaryKind); setOpen(true); }} type="button">{primaryKind === "gateway" ? copy.gatewayVerification : copy.modelVerification}</button></MenuItem>
        {evidence.kind === "model" && evidence.gateway ? <MenuItem><button onClick={() => { setOpenKind("gateway"); setOpen(true); }} type="button">{copy.gatewayVerification}</button></MenuItem> : null}
        {evidence.kind === "gateway" && evidence.model ? <MenuItem><button onClick={() => { setOpenKind("model"); setOpen(true); }} type="button">{copy.modelVerification}</button></MenuItem> : null}
        {onVerifyAgain ? <MenuItem><button onClick={() => void onVerifyAgain(primaryKind)} type="button">{copy.verifyAgain}</button></MenuItem> : null}
        {signatureVerificationAvailable(verification) ? <MenuItem><button onClick={() => setSignatureOpen(true)} type="button">{copy.signatureVerification}</button></MenuItem> : null}
      </MenuItems>
    </Menu>
    {open ? <VerificationDialog kind={openKind ?? evidence.kind} evidence={openKind === "gateway" ? (evidence.gateway ?? evidence) : openKind === "model" ? (evidence.model ?? evidence) : evidence} providerName={providerName} modelId={modelId} copy={copy} onVerifyAgain={(kind) => invokeVerificationRefresh(onVerifyAgain, kind)} onClose={() => { setOpen(false); setOpenKind(undefined); }} /> : null}
    {signatureOpen && verification ? <SignatureVerificationDialog verification={verification} copy={copy} onClose={() => setSignatureOpen(false)} /> : null}
  </>;
}

function ModelComparisonResultGrid({
  batch,
  messages,
  liveTargets,
  onCancelTarget,
  onRetry,
  onSelectAnswer,
  onVerifyAgain,
  copy,
  prompt,
  catalogs,
  profiles
}: {
  batch: GenerationBatch;
  messages: ConversationView["messages"];
  liveTargets?: NonNullable<LiveTurn["targets"]>;
  onCancelTarget?: (batchID: string, generationID: string) => void;
  onRetry?: (batchID: string, targetID: string) => void;
  onSelectAnswer?: (batchID: string, generationID: string) => void;
  onVerifyAgain?: (targetID: string, kind: "model" | "gateway") => Promise<VerificationEvidence | undefined> | void;
  copy: ApplicationCopy;
  prompt?: string;
  catalogs?: ModelCatalogs;
  profiles?: ProviderProfile[];
}) {
  const messagesByID = new Map(messages.map((message) => [message.id, message]));
  const terminal = batch.state === "completed" || batch.state === "completed_with_errors" || batch.state === "stopped" || batch.state === "failed";
  const verifiedCount = batch.targets.filter((target) => target.generation.verification?.status === "verified_model" || target.generation.verification?.status === "verified_gateway").length;
  const spreadLetters = ["A", "B", "C", "D"];
  const promptText = prompt ?? comparisonPromptForMessages(messages, batch.targets.map((target) => target.generation.assistant_message_id));

  return <section aria-label={copy.modelComparison} className="model-comparison-grid" data-generation-batch={batch.id}>
    {promptText ? <div className="lede"><div className="lede__label">{copy.comparisonPromptLabel}</div><p className="lede__text"><span className="q">"</span>{promptText}<span className="q">"</span></p></div> : null}
    <div className="model-comparison-grid__cards">
      {[...batch.targets].sort((left, right) => left.position - right.position).map((target) => {
        const message = target.generation.assistant_message_id ? messagesByID.get(target.generation.assistant_message_id) : undefined;
        const liveTarget = liveTargets?.find((candidate) => candidate.targetId === target.id);
        const phase = message ? "completed" : liveTarget?.phase ?? target.generation.state;
        const canSelectAnswer = terminal && !batch.context_frozen && phase === "completed";
        const selected = batch.selected_generation_id === target.generation.id;
        const actions = <>
          {(phase === "pending" || phase === "verifying_environment" || phase === "streaming" || phase === "verifying_response") && liveTarget?.generationId && onCancelTarget ? <StopGenerationButton copy={copy} onClick={() => onCancelTarget(batch.id, liveTarget.generationId!)} /> : null}
          {(phase === "failed" || phase === "stopped") && onRetry ? <button onClick={() => onRetry(batch.id, target.id)} type="button">{copy.retryGeneration}</button> : null}
          {canSelectAnswer && onSelectAnswer ? <button className="pick" aria-pressed={batch.selected_generation_id === target.generation.id} onClick={() => onSelectAnswer(batch.id, target.generation.id)} type="button">{selected ? copy.answerOfRecord : copy.useForNextTurn}</button> : null}
        </>;
        return <div className={`model-comparison-grid__page${selected ? " is-selected" : ""}`} data-page-position={target.position} key={target.id}>
          <span className="stamp">{copy.answerOfRecord}</span>
          <div className="page-col__folio"><b>{spreadLetters[target.position] ?? String(target.position + 1)}</b><span>{target.generation.snapshot.provider_name}</span><em>P.{String(21 + target.position).padStart(2, "0")}</em></div>
          <ModelAnswerCard
            actions={actions}
            body={message?.body ?? liveTarget?.assistantBody ?? ""}
            copy={copy}
            createdAt={message?.created_at ?? batch.updated_at}
            errorCode={liveTarget?.errorCode ?? target.generation.error_code}
            modelId={target.model_id}
            mode={inferenceModeForSnapshot(target.generation.snapshot)}
            phase={phase}
            position={target.position}
            providerName={liveTarget?.snapshot?.provider_name ?? target.generation.snapshot.provider_name}
            selected={selected}
            snapshot={liveTarget?.snapshot ?? target.generation.snapshot}
            verification={target.generation.verification}
            onVerifyAgain={(kind) => onVerifyAgain?.(target.id, kind) ?? Promise.resolve(undefined)}
            targetId={target.id}
          />
        </div>;
      })}
    </div>
    <div className="model-comparison-grid__spec">
      <div className="spec__cell"><div className="spec__k">{copy.specTargets}</div><div className="spec__v">{batch.targets.length}<i>×</i></div><div className="spec__s">{copy.modelComparison}</div></div>
      <div className="spec__cell"><div className="spec__k">{copy.specProofChains}</div><div className="spec__v">{verifiedCount}<i>✓</i></div><div className="spec__s">{copy.verificationVerified}</div></div>
      <div className="spec__cell"><div className="spec__k">{copy.specSelectedAnswer}</div><div className="spec__v">{batch.selected_generation_id ? "✓" : "—"}</div><div className="spec__s">{copy.contextDispositionNote}</div></div>
      <div className="spec__cell"><div className="spec__k">{copy.specDataEgress}</div><div className="spec__v">0<i>bytes</i></div><div className="spec__s">{copy.noRelay}</div></div>
    </div>
  </section>;
}

function LiveModelComparisonGrid({
  batch,
  targets,
  onCancelTarget,
  onRetry,
  onSelectAnswer,
  onVerifyAgain,
  copy,
  prompt,
  catalogs,
  profiles
}: {
  batch?: GenerationBatch;
  targets: NonNullable<LiveTurn["targets"]>;
  onCancelTarget?: (batchID: string, generationID: string) => void;
  onRetry?: (batchID: string, targetID: string) => void;
  onSelectAnswer?: (batchID: string, generationID: string) => void;
  onVerifyAgain?: (targetID: string, kind: "model" | "gateway") => Promise<VerificationEvidence | undefined> | void;
  copy: ApplicationCopy;
  prompt?: string;
  catalogs?: ModelCatalogs;
  profiles?: ProviderProfile[];
}) {
  const terminal = Boolean(batch && (batch.state === "completed" || batch.state === "completed_with_errors" || batch.state === "stopped" || batch.state === "failed"));
  const verifiedCount = targets.filter((target) => {
    const verification = batch?.targets.find((candidate) => candidate.id === target.targetId)?.generation.verification;
    return verification?.status === "verified_model" || verification?.status === "verified_gateway";
  }).length;
  const spreadLetters = ["A", "B", "C", "D"];
  return <section aria-label={copy.modelComparison} className="model-comparison-grid model-comparison-grid--live" data-generation-batch={batch?.id}>
    {prompt ? <div className="lede"><div className="lede__label">{copy.comparisonPromptLabel}</div><p className="lede__text"><span className="q">"</span>{prompt}<span className="q">"</span></p></div> : null}
    <div className="model-comparison-grid__cards">
      {targets.map((target, index) => {
        const selected = batch?.selected_generation_id === target.generationId;
        const actions = <>
          {(target.phase === "pending" || target.phase === "verifying_environment" || target.phase === "streaming" || target.phase === "verifying_response") && batch && target.generationId && onCancelTarget ? <StopGenerationButton copy={copy} onClick={() => onCancelTarget(batch.id, target.generationId!)} /> : null}
          {(target.phase === "failed" || target.phase === "stopped") && (target.targetId || target.generationId) && onRetry ? <button onClick={() => onRetry(batch?.id ?? "", target.targetId ?? target.generationId!)} type="button">{copy.retryGeneration}</button> : null}
          {terminal && !batch?.context_frozen && target.phase === "completed" && target.generationId && onSelectAnswer ? <button className="pick" aria-pressed={batch?.selected_generation_id === target.generationId} onClick={() => onSelectAnswer(batch!.id, target.generationId!)} type="button">{selected ? copy.answerOfRecord : copy.useForNextTurn}</button> : null}
        </>;
        return <div className={`model-comparison-grid__page${selected ? " is-selected" : ""}`} data-page-position={index} key={target.key}>
          <span className="stamp">{copy.answerOfRecord}</span>
          <div className="page-col__folio"><b>{spreadLetters[index] ?? String(index + 1)}</b><span>{target.snapshot?.provider_name ?? target.providerId}</span><em>P.{String(21 + index).padStart(2, "0")}</em></div>
          <ModelAnswerCard
            actions={actions}
            body={target.assistantBody}
            copy={copy}
            errorCode={target.errorCode}
            modelId={target.modelId}
            mode={inferenceModeForSnapshot(target.snapshot)}
            phase={target.phase}
            position={index}
            providerName={target.snapshot?.provider_name}
            selected={selected}
            snapshot={target.snapshot}
            verification={batch?.targets.find((candidate) => candidate.id === target.targetId)?.generation.verification}
            onVerifyAgain={(kind) => onVerifyAgain?.(target.targetId ?? target.key, kind) ?? Promise.resolve(undefined)}
            targetId={target.targetId ?? target.key}
          />
        </div>;
      })}
    </div>
    <div className="model-comparison-grid__spec">
      <div className="spec__cell"><div className="spec__k">{copy.specTargets}</div><div className="spec__v">{targets.length}<i>×</i></div><div className="spec__s">{copy.modelComparison}</div></div>
      <div className="spec__cell"><div className="spec__k">{copy.specProofChains}</div><div className="spec__v">{verifiedCount}<i>✓</i></div><div className="spec__s">{copy.verificationVerified}</div></div>
      <div className="spec__cell"><div className="spec__k">{copy.specSelectedAnswer}</div><div className="spec__v">{batch?.selected_generation_id ? "✓" : "—"}</div><div className="spec__s">{copy.contextDispositionNote}</div></div>
      <div className="spec__cell"><div className="spec__k">{copy.specDataEgress}</div><div className="spec__v">0<i>bytes</i></div><div className="spec__s">{copy.noRelay}</div></div>
    </div>
  </section>;
}

export function ConversationPanel({
  view,
  titleDraft,
  onTitleChange,
  onRename,
  isSaving,
  copy = englishConversationCopy,
  isLoading = false,
  onSend,
  onCancel,
  onRetry,
  onCreateConversation,
  onOpenSettings,
  generationBatch,
  generationBatches = [],
  activeModelSet = [],
  profiles = [],
  generation,
  liveAssistantBody = "",
  liveTurn,
  draft = "",
  onDraftChange,
  privateMode = true,
  isSending = false,
  providerStatus = "ready",
  catalogs = {},
  onCancelTarget,
  onSelectAnswer,
  onSkipContext,
  onVerifyAgain
}: {
  view: ConversationView | undefined;
  titleDraft: string;
  onTitleChange: (title: string) => void;
  onRename: () => void;
  isSaving: boolean;
  copy?: ApplicationCopy;
  isLoading?: boolean;
  onSend?: () => void;
  onCancel?: () => void;
  onRetry?: (batchID: string, targetID: string) => void;
  onCreateConversation?: () => void;
  onOpenSettings?: () => void;
  generationBatch?: GenerationBatch;
  generationBatches?: GenerationBatch[];
  /** @deprecated retained for one-target shell tests during the Batch migration. */
  generation?: Generation;
  liveAssistantBody?: string;
  liveTurn?: LiveTurn;
  draft?: string;
  onDraftChange?: (value: string) => void;
  privateMode?: boolean;
  isSending?: boolean;
  providerStatus?: ProviderSelectionStatus;
  onCancelTarget?: (batchID: string, generationID: string) => void;
  onSelectAnswer?: (batchID: string, generationID: string) => void;
  onSkipContext?: (batchID: string) => void;
  onVerifyAgain?: (targetID: string, kind: "model" | "gateway") => Promise<VerificationEvidence | undefined> | void;
  activeModelSet?: ActiveModelSet;
  profiles?: ProviderProfile[];
  catalogs?: ModelCatalogs;
}) {
  const messageListRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const followLatestRef = useRef(true);
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const [showReturnToLatest, setShowReturnToLatest] = useState(false);

  useEffect(() => {
    const node = messageListRef.current;
    if (!node || !view) return;
    const saved = scrollPositionsRef.current[view.id];
    if (saved !== undefined) {
      node.scrollTop = saved;
      followLatestRef.current = saved >= node.scrollHeight - node.clientHeight - 120;
      setShowReturnToLatest(!followLatestRef.current);
    } else {
      followLatestRef.current = true;
      node.scrollTop = node.scrollHeight;
    }
  }, [view?.id]);

  useEffect(() => {
    if (!liveTurn) return;
    const node = messageListRef.current;
    followLatestRef.current = true;
    setShowReturnToLatest(false);
    if (node) node.scrollTop = node.scrollHeight;
    composerRef.current?.focus();
  }, [liveTurn?.clientRequestId]);

  useEffect(() => {
    const node = messageListRef.current;
    if (!node || !followLatestRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [view?.messages.length, liveTurn, generationBatch?.state, generation?.state]);

  function handleMessageScroll() {
    const node = messageListRef.current;
    if (!node || !view) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    scrollPositionsRef.current[view.id] = node.scrollTop;
    const nearLatest = distance <= 120;
    followLatestRef.current = nearLatest;
    setShowReturnToLatest(!nearLatest && Boolean(liveTurn || generationBatch || generation));
  }

  function returnToLatest() {
    const node = messageListRef.current;
    if (!node) return;
    followLatestRef.current = true;
    setShowReturnToLatest(false);
    const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    node.scrollTo({ top: node.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  }

  if (isLoading) {
    return <section className="conversation-panel" data-workspace-chat-style="nearai"><p className="conversation-panel__empty">{copy.loadingConversation}</p></section>;
  }
  if (!view) {
    return <section className="conversation-panel" data-workspace-chat-style="nearai">
      <div className="conversation-empty-state" data-workspace-empty="true">
        <div className="empty-state__mark" aria-hidden="true">T</div>
        <p className="eyebrow">{copy.chatSurface}</p>
        <h2>{copy.noConversationSelected}</h2>
        <p>{copy.emptyConversationHint}</p>
        {onCreateConversation ? <button className="empty-state__action" onClick={onCreateConversation} type="button">{copy.startConversation}</button> : null}
      </div>
      {providerStatus !== "ready" ? <ProviderStatusNotice onOpenSettings={onOpenSettings} status={providerStatus} copy={copy} /> : null}
    </section>;
  }

  const allGenerationBatches = generationBatch && !generationBatches.some((batch) => batch.id === generationBatch.id)
    ? [...generationBatches, generationBatch]
    : generationBatches;
  const batchTargetByAssistantMessageID = new Map<string, { batch: GenerationBatch; target: GenerationBatch["targets"][number] }>();
  const assistantMessageIDByTargetOrGenerationID = new Map<string, string>();
  for (const batch of allGenerationBatches) {
    for (const target of batch.targets) {
      if (target.generation.assistant_message_id) {
        batchTargetByAssistantMessageID.set(target.generation.assistant_message_id, { batch, target });
        assistantMessageIDByTargetOrGenerationID.set(target.id, target.generation.assistant_message_id);
        assistantMessageIDByTargetOrGenerationID.set(target.generation.id, target.generation.assistant_message_id);
      }
    }
  }
  const hasMessages = view.messages.length > 0 || Boolean(liveTurn);
  const liveUserAlreadyPersisted = Boolean(liveTurn?.userMessageId && view.messages.some((message) => message.id === liveTurn.userMessageId));
  const rawLiveTargets = liveTurn?.targets?.length
    ? liveTurn.targets
    : generation
      ? [{ key: generation.id, generationId: generation.id, providerId: generation.snapshot.provider_id, modelId: generation.snapshot.model_id, snapshot: generation.snapshot, assistantBody: liveAssistantBody || liveTurn?.assistantBody || "", phase: liveTurn?.phase ?? generation.state, errorCode: generation.error_code, errorMessage: generation.error_message }]
      : liveTurn
        ? [{ key: "legacy-live", generationId: liveTurn.generationId, providerId: "", modelId: "", assistantBody: liveTurn.assistantBody ?? "", phase: liveTurn.phase ?? "pending" }]
        : [];
  // Completed assistant bodies are authoritative Conversation History as soon
  // as they are saved. Keep only the non-persistent/failing cards in Live Turn
  // so a status refresh never shows the completed answer twice.
  const liveTargets = rawLiveTargets.filter((target) => {
    const assistantMessageID = target.assistantMessageId
      ?? (target.targetId ? assistantMessageIDByTargetOrGenerationID.get(target.targetId) : undefined)
      ?? (target.generationId ? assistantMessageIDByTargetOrGenerationID.get(target.generationId) : undefined);
    return !assistantMessageID || !view.messages.some((message) => message.id === assistantMessageID);
  });
  const liveBatch = liveTurn?.batchId ? allGenerationBatches.find((batch) => batch.id === liveTurn.batchId) : generationBatch;
  const generationActive = generationBatch?.state === "pending" || generationBatch?.state === "streaming" || generation?.state === "pending" || generation?.state === "verifying_environment" || generation?.state === "streaming" || generation?.state === "verifying_response";
  const isTerminalBatch = (batch: GenerationBatch) => batch.state === "completed" || batch.state === "completed_with_errors" || batch.state === "stopped" || batch.state === "failed";
  const contextDispositionBatch = allGenerationBatches.find((batch) => isTerminalBatch(batch) && !batch.context_frozen && !batch.selected_generation_id && !batch.context_skipped);
  const comparisonFirstAssistantMessageID = new Map<string, string>();
  for (const batch of allGenerationBatches) {
    if (batch.targets.length < 2) continue;
    const assistantMessageIDs = new Set(batch.targets.map((target) => target.generation.assistant_message_id).filter((messageID): messageID is string => Boolean(messageID)));
    const firstAssistantMessageID = view.messages.find((message) => assistantMessageIDs.has(message.id))?.id;
    if (firstAssistantMessageID) comparisonFirstAssistantMessageID.set(batch.id, firstAssistantMessageID);
  }
  const terminalFailedTargets = allGenerationBatches.flatMap((batch) => batch.targets
    .filter((target) => batch.targets.length === 1 && (target.generation.state === "failed" || target.generation.state === "stopped") && !liveTargets.some((live) => live.targetId === target.id))
    .map((target) => ({ batch, target })));
  const terminalFailedBatches = allGenerationBatches.filter((batch) => batch.targets.length > 1
    && batch.targets.every((target) => target.generation.state === "failed" || target.generation.state === "stopped")
    && !batch.targets.some((target) => liveTargets.some((live) => live.targetId === target.id)));
  const liveComparison = liveTargets.length > 1 || Boolean(liveBatch && liveBatch.targets.length > 1);
  const liveComparisonAlreadyInHistory = Boolean(liveBatch && comparisonFirstAssistantMessageID.has(liveBatch.id));

  return (
    <section className={`conversation-panel${hasMessages ? "" : " conversation-panel--empty"}`} aria-label={view.title} data-workspace-chat-style="nearai" data-workspace-region="conversation" data-workspace-empty={hasMessages ? undefined : "true"}>
      {view.archived ? <p className="conversation-panel__archived" role="status">{copy.archivedConversationNotice}</p> : providerStatus !== "ready" ? <ProviderStatusNotice onOpenSettings={onOpenSettings} status={providerStatus} copy={copy} /> : null}
      <div ref={messageListRef} onScroll={handleMessageScroll} className={`message-list${view.messages.length === 0 && liveTargets.length === 0 && !liveTurn ? " message-list--empty" : ""}`} aria-label={copy.conversationMessages} data-workspace-region="messages">
        {view.messages.length === 0 && liveTargets.length === 0 && !liveTurn ? (
          <ConversationWelcome copy={copy} onSelectPrompt={onDraftChange} />
        ) : view.messages.length === 0 ? null : (
          view.messages.map((message) => {
            const snapshot = message.provider_snapshot;
            const generationTarget = message.role === "assistant" ? batchTargetByAssistantMessageID.get(message.id) : undefined;
            if (generationTarget?.batch.targets.length && generationTarget.batch.targets.length > 1) {
              if (comparisonFirstAssistantMessageID.get(generationTarget.batch.id) !== message.id) return null;
              return <ModelComparisonResultGrid
                batch={generationTarget.batch}
                catalogs={catalogs}
                copy={copy}
                key={generationTarget.batch.id}
                liveTargets={generationTarget.batch.id === liveBatch?.id ? liveTargets : undefined}
                onCancelTarget={generationTarget.batch.id === liveBatch?.id ? onCancelTarget : undefined}
                messages={view.messages}
                onRetry={onRetry}
                onSelectAnswer={onSelectAnswer}
                onVerifyAgain={onVerifyAgain}
                profiles={profiles}
              />;
            }
            const canSelectAnswer = Boolean(generationTarget && generationTarget.batch.targets.length > 1 && !generationTarget.batch.context_frozen && isTerminalBatch(generationTarget.batch) && generationTarget.target.generation.state === "completed");
            const historyVerification = generationTarget?.target.generation.verification;
            return <article className={`message message--${message.role}`} data-generation-target={generationTarget?.target.id} key={message.id}>
              {message.role === "user" ? <span className="message__role message__role--user" data-message-meta="user">{copy.you}</span> : <MessageMeta role={message.role} modelId={snapshot?.model_id} providerName={snapshot?.provider_name} createdAt={message.created_at} copy={copy} verification={historyVerification} mode={inferenceModeForSnapshot(generationTarget?.target.generation.snapshot ?? snapshot)} />}
              {message.role === "assistant" ? <MarkdownMessage content={message.body} /> : <p className="message__body message__bubble">{message.body}</p>}
              {message.role === "user" && message.created_at ? <time className="message__timestamp" dateTime={message.created_at}>{formatTime(message.created_at)}</time> : null}
              {message.role === "assistant" && snapshot ? <MessageFootnote copy={copy} notice={snapshot.privacy_notice} providerName={snapshot.provider_name} /> : null}
              {snapshot ? <ProviderSnapshotView copy={copy} snapshot={snapshot} /> : null}
              {message.role === "assistant" ? <VerificationDetailsButton verification={historyVerification} providerName={snapshot?.provider_name} modelId={snapshot?.model_id} copy={copy} onVerifyAgain={generationTarget ? (kind) => onVerifyAgain?.(generationTarget.target.id, kind) ?? Promise.resolve(undefined) : undefined} /> : null}
              {canSelectAnswer && generationTarget && onSelectAnswer ? <button aria-pressed={generationTarget.batch.selected_generation_id === generationTarget.target.generation.id} type="button" onClick={() => onSelectAnswer(generationTarget.batch.id, generationTarget.target.generation.id)}>{copy.useForNextTurn}</button> : null}
            </article>;
          })
        )}
        {liveTurn && !liveUserAlreadyPersisted ? <article className="message message--user message--live">
          <p className="message__body message__bubble">{liveTurn.userBody}</p>
        </article> : null}
        {liveTargets.length > 0 && liveComparison && !liveComparisonAlreadyInHistory ? <LiveModelComparisonGrid
          batch={liveBatch}
          catalogs={catalogs}
          copy={copy}
          prompt={liveTurn?.userBody}
          onCancelTarget={onCancelTarget}
          onRetry={onRetry}
          onSelectAnswer={onSelectAnswer}
          onVerifyAgain={onVerifyAgain}
          profiles={profiles}
          targets={liveTargets}
        /> : !liveComparison ? liveTargets.map((target) => {
          const liveVerification = liveBatch?.targets.find((candidate) => candidate.id === target.targetId)?.generation.verification;
          const liveWaiting = target.phase === "pending" || target.phase === "verifying_environment" || target.phase === "streaming" || target.phase === "verifying_response";
          const privateProgress = liveWaiting && (liveVerification?.status === "pending" || target.phase === "verifying_environment" || target.phase === "verifying_response");
          const showInlineGenerationStatus = liveWaiting && !target.assistantBody;
          return <article className={`message message--assistant message--live-assistant${target.phase === "stopped" ? " message--stopped" : ""}`} data-generation-target={target.targetId ?? target.key} key={target.key}>
          <MessageMeta role="assistant" modelId={target.snapshot?.model_id ?? target.modelId} providerName={target.snapshot?.provider_name} copy={copy} verification={liveVerification} mode={inferenceModeForSnapshot(target.snapshot)} />
          {showInlineGenerationStatus ? <div className="message__generation-progress">
            {privateProgress ? <PrivateGenerationProgress compact phase={target.phase as Extract<ModelAnswerPhase, "pending" | "verifying_environment" | "streaming" | "verifying_response">} copy={copy} /> : <p className="message__body message__body--pending"><span aria-hidden="true" className="pending-dots">...</span>{copy.generationPending}</p>}
            {liveBatch && target.generationId && onCancelTarget ? <StopGenerationButton copy={copy} onClick={() => onCancelTarget(liveBatch.id, target.generationId!)} /> : null}
          </div> : null}
          {target.assistantBody ? <MarkdownMessage content={target.assistantBody} /> : null}
          {target.snapshot && Boolean(target.assistantBody) ? <MessageFootnote copy={copy} notice={target.snapshot.privacy_notice} providerName={target.snapshot.provider_name} /> : null}
          {target.phase === "stopped" ? <p className="message__state">{copy.generationStopped}</p> : null}
          {target.phase === "failed" ? <p className="message__state">{generationFailureMessage(target.errorCode, copy)}</p> : null}
          {target.phase === "unknown" ? <p className="message__state">{copy.generationDeliveryUnknown}</p> : null}
          {target.snapshot && (Boolean(target.assistantBody) || !liveWaiting) ? <ProviderSnapshotView copy={copy} snapshot={target.snapshot} /> : null}
          <VerificationDetailsButton verification={liveVerification} providerName={target.snapshot?.provider_name} modelId={target.snapshot?.model_id ?? target.modelId} copy={copy} onVerifyAgain={target.targetId ? (kind) => onVerifyAgain?.(target.targetId!, kind) ?? Promise.resolve(undefined) : undefined} />
          {liveWaiting && target.assistantBody && liveBatch && target.generationId && onCancelTarget ? <StopGenerationButton copy={copy} onClick={() => onCancelTarget(liveBatch.id, target.generationId!)} /> : null}
          {(target.phase === "failed" || target.phase === "stopped") && (target.targetId || target.generationId) && onRetry ? <button type="button" onClick={() => onRetry(liveBatch?.id ?? "", target.targetId ?? target.generationId!)}>{copy.retryGeneration}</button> : null}
          {liveBatch && liveBatch.targets.length > 1 && !liveBatch.context_frozen && isTerminalBatch(liveBatch) && target.phase === "completed" && target.generationId && onSelectAnswer ? <button aria-pressed={liveBatch.selected_generation_id === target.generationId} type="button" onClick={() => onSelectAnswer(liveBatch.id, target.generationId!)}>{copy.useForNextTurn}</button> : null}
        </article>;
        }) : null}
        {terminalFailedTargets.map(({ batch, target }) => <article className={`message message--assistant message--live-assistant${target.generation.state === "stopped" ? " message--stopped" : ""}`} data-generation-target={target.id} key={`${batch.id}:${target.id}`}>
          <MessageMeta role="assistant" modelId={target.model_id} providerName={target.generation.snapshot.provider_name} copy={copy} />
          <p className="message__state">{target.generation.state === "stopped" ? copy.generationStopped : generationFailureMessage(target.generation.error_code, copy)}</p>
          <ProviderSnapshotView copy={copy} snapshot={target.generation.snapshot} />
          {onRetry ? <button type="button" onClick={() => onRetry(batch.id, target.id)}>{copy.retryGeneration}</button> : null}
        </article>)}
        {terminalFailedBatches.map((batch) => <ModelComparisonResultGrid batch={batch} catalogs={catalogs} copy={copy} key={batch.id} messages={view.messages} onRetry={onRetry} onSelectAnswer={onSelectAnswer} onVerifyAgain={onVerifyAgain} profiles={profiles} />)}
      </div>
      {showReturnToLatest ? <button className="conversation-panel__latest" onClick={returnToLatest} type="button">↓ {copy.returnToLatest}</button> : null}
      <p className="chat-status-live" role="status" aria-live="polite">{generationActive ? copy.generationStreaming : contextDispositionBatch ? copy.modelComparison : ""}</p>
      {contextDispositionBatch && onSkipContext ? <div className="note-band">
        <div className="note-band__inner">
          <span className="note-band__no">※</span>
          <p className="note-band__text">{copy.contextDispositionNote}</p>
          <button className="conversation-panel__skip-context note-band__cta" type="button" onClick={() => onSkipContext(contextDispositionBatch.id)}><span>{copy.continueWithoutAnswer}</span><ArrowRight aria-hidden="true" size={15} strokeWidth={2} /></button>
        </div>
      </div> : null}
      {!view.archived && providerStatus === "ready" && onSend && onDraftChange ? <form className="generation-composer" data-composer-style="nearai" onSubmit={(event) => { event.preventDefault(); onSend(); }}>
        <div className="generation-composer__models">
          <span className="generation-composer__label">{copy.activeModelSet}</span>
          {activeModelSet.map((target) => {
            const profile = profiles.find((candidate) => candidate.id === target.providerId);
            return <span className="generation-composer__chip" key={`${target.providerId}:${target.modelId}`}>
              <span aria-hidden="true" className="dot" />
              <b>{profile?.name ?? target.providerId}</b>
              {target.modelId}
            </span>;
          })}
          {activeModelSet.length >= 2 ? <span className="generation-composer__hint">{copy.modelComparison}</span> : null}
        </div>
        <div className="generation-composer__box">
          <label htmlFor="generation-input">{copy.sendMessage}</label>
          <textarea
            id="generation-input"
            value={draft}
            placeholder={copy.composerPlaceholder}
            onChange={(event) => onDraftChange(event.target.value)}
            ref={composerRef}
            onKeyDown={(event) => {
              if (!isSending && shouldSubmitComposerKey({ ...event, isComposing: event.nativeEvent.isComposing })) {
                event.preventDefault();
                onSend();
              }
            }}
            disabled={false}
          />
          <div className="generation-composer__bar">
            <span className="generation-composer__context-note">{copy.contextSnapshot.toUpperCase()} · {(view.generation_batches ?? []).filter((batch) => batch.context_frozen).length} TURNS</span>
            <button aria-label={copy.sendMessage} className="generation-composer__send" type="submit" disabled={isSending || !draft.trim()}><ArrowUp aria-hidden="true" size={16} strokeWidth={2} /><span className="generation-composer__send-label">{copy.sendMessage}</span></button>
          </div>
        </div>
        <div className="generation-composer__actions">
          {privateMode ? <span className="generation-composer__mode"><span aria-hidden="true" />{copy.privateMode}</span> : null}
          {isSending && onCancel ? <button type="button" onClick={onCancel}>{copy.stopGeneration}</button> : null}
        </div>
        <p className="generation-composer__foot"><LockKeyhole aria-hidden="true" size={11} strokeWidth={1.8} />{copy.composerFoot}</p>
      </form> : null}
    </section>
  );
}

function ConversationWelcome({ copy, onSelectPrompt }: { copy: ApplicationCopy; onSelectPrompt?: (value: string) => void }) {
  return <div className="conversation-welcome">
    <p className="conversation-welcome__eyebrow">{copy.coverEyebrow}</p>
    <h2 className="conversation-welcome__title">{copy.coverTitleA}<br />{copy.coverTitleB} <span className="u">{copy.coverTitleC}</span><span className="pt">.</span></h2>
    <p className="conversation-welcome__sub">{copy.coverSubtitle}</p>
    {onSelectPrompt ? <SuggestedPrompts copy={copy} onSelect={onSelectPrompt} /> : null}
  </div>;
}

function SuggestedPrompts({ copy, onSelect }: { copy: ApplicationCopy; onSelect: (value: string) => void }) {
  return <section className="conversation-suggestions" aria-label={copy.suggested}>
    <p className="conversation-suggestions__heading"><span className="conversation-suggestions__label">{copy.suggested}</span></p>
    <div className="conversation-suggestions__list">
      <button className="suggest" type="button" onClick={() => onSelect(copy.suggest01Title)}>
        <span className="suggest__no">01</span>
        <span className="suggest__t">{copy.suggest01Title}</span>
        <span className="suggest__d">{copy.suggest01Detail}</span>
      </button>
      <button className="suggest" type="button" onClick={() => onSelect(copy.suggest02Title)}>
        <span className="suggest__no">02</span>
        <span className="suggest__t">{copy.suggest02Title}</span>
        <span className="suggest__d">{copy.suggest02Detail}</span>
      </button>
      <button className="suggest" type="button" onClick={() => onSelect(copy.suggest03Title)}>
        <span className="suggest__no">03</span>
        <span className="suggest__t">{copy.suggest03Title}</span>
        <span className="suggest__d">{copy.suggest03Detail}</span>
      </button>
    </div>
  </section>;
}

function MessageMeta({ role, providerName, modelId, createdAt, verification, copy, mode }: { role: string; providerName?: string; modelId?: string; createdAt?: string; verification?: GenerationVerification; copy: ApplicationCopy; mode?: SecureInferenceMode }) {
  const isAssistant = role === "assistant";
  return <div className={`message__role message__role--${role} byline`} data-message-meta={role}>
    <span className="message__role-name">{isAssistant ? <>via <b>{providerName ?? copy.assistant}</b></> : copy.you}</span>
    {modelId ? <code>{modelId}</code> : null}
    {isAssistant && (verification || mode) ? <VerificationLanes copy={copy} mode={mode} verification={verification} /> : null}
    {createdAt ? <time className="message__timestamp" dateTime={createdAt}>{formatTime(createdAt)}</time> : null}
  </div>;
}

function VerificationLanes({ verification, copy, mode }: { verification?: GenerationVerification; copy: ApplicationCopy; mode?: SecureInferenceMode }) {
  const showModelLane = mode === "private_tee" || verification?.lanes?.model !== undefined || verification?.signature_kind === "provider_tee";
  const lanes: Array<{ kind: "gateway" | "model" | "response"; label: string }> = [
    { kind: "gateway", label: copy.gatewayVerification },
    ...(showModelLane ? [{ kind: "model" as const, label: copy.modelVerification }] : []),
    { kind: "response", label: copy.responseVerification }
  ];
  return <ul className="message__verification-lanes" role="status">
    {lanes.map((lane) => {
      const status = verificationLaneStatus(lane.kind, verification, mode);
      return <li className={`message__verification-lane message__verification-lane--${status}`} data-verification-lane={lane.kind} data-status={status} key={lane.kind}>
        <span>{lane.label}</span>
        <strong>{status === "verified" ? copy.verificationVerified : status === "failed" ? copy.verificationFailed : copy.verificationPending}</strong>
      </li>;
    })}
  </ul>;
}

function MessageFootnote({ providerName, notice, copy }: { providerName?: string; notice?: string; copy: ApplicationCopy }) {
  const [open, setOpen] = useState(false);
  return <>
    <button aria-expanded={open} className="message__privacy-toggle" onClick={() => setOpen((current) => !current)} type="button">{copy.privacyNoticeToggle}<sup>1</sup></button>
    {open ? <div className="message__privacy-footnote">
      <span aria-hidden="true" className="message__privacy-footnote__no">1</span>
      <div><strong>{copy.privacyNotice} ·</strong> This turn's content was sent to <strong>{providerName ?? copy.assistant}</strong> for computation. {notice ? <span>{notice}</span> : null}</div>
      <span className="message__privacy-footnote__src">{copy.privacyNoticeSource}</span>
    </div> : null}
  </>;
}

function ProviderStatusNotice({ onOpenSettings, status, copy }: { onOpenSettings?: () => void; status: Exclude<ProviderSelectionStatus, "ready">; copy: ApplicationCopy }) {
  const icon = status === "catalog-loading"
    ? <LoaderCircle aria-hidden="true" size={17} strokeWidth={2} />
    : status === "catalog-error" || status === "model-unavailable"
      ? <CircleAlert aria-hidden="true" size={17} strokeWidth={2} />
      : status === "no-models"
        ? <TriangleAlert aria-hidden="true" size={17} strokeWidth={2} />
        : <CircleDashed aria-hidden="true" size={17} strokeWidth={1.8} />;
  if (status === "unconfigured") {
    return <div className="provider-required provider-required--unconfigured" data-provider-status={status} role="status">
      <span className="provider-required__icon" aria-hidden="true"><CircleAlert size={17} strokeWidth={2} /></span>
      <p>{copy.providerRequired}</p>
      {onOpenSettings ? <button onClick={onOpenSettings} type="button">{copy.openProviderSettings}</button> : <a href="#provider-settings">{copy.openProviderSettings}</a>}
    </div>;
  }

  const message = status === "catalog-loading"
    ? copy.loadingModels
    : status === "catalog-error"
      ? copy.modelsUnavailable
      : status === "no-models"
        ? copy.noModels
        : status === "model-required"
          ? copy.selectModel
          : copy.modelUnavailable;
  return <div className={`provider-required provider-required--${status}`} data-provider-status={status} role="status">
    <span className="provider-required__icon" aria-hidden="true">{icon}</span>
    <p>{message}</p>
  </div>;
}

export function shouldSubmitComposerKey(event: Pick<KeyboardEvent<HTMLTextAreaElement>, "key" | "shiftKey"> & { isComposing?: boolean }): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

export function isSystemPromptWithinLimit(value: string): boolean {
  return Array.from(value).length <= 8192;
}

export type ModelParameterFormValues = {
	temperature: string;
	topP: string;
	maxTokens: string;
};

export function modelParameterFormValue(value: number | null): string {
	return value === null ? "" : String(value);
}

export function parseModelParameters(values: ModelParameterFormValues): Pick<WorkspaceSettings, "temperature" | "top_p" | "max_tokens"> | undefined {
	const temperature = parseOptionalDecimal(values.temperature, 0, 2);
	const topP = parseOptionalDecimal(values.topP, 0, 1);
	const maxTokens = parseOptionalInteger(values.maxTokens, 1);
	if (temperature === undefined || topP === undefined || maxTokens === undefined) return undefined;
	return { temperature, top_p: topP, max_tokens: maxTokens };
}

function parseOptionalDecimal(value: string, minimum: number, maximum: number): number | null | undefined {
	if (value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

function parseOptionalInteger(value: string, minimum: number): number | null | undefined {
	if (value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= minimum ? parsed : undefined;
}

export function MarkdownMessage({ content }: { content: string }) {
  return <div className="message__body message__markdown">{renderMarkdownBlocks(content)}</div>;
}

function renderMarkdownBlocks(content: string): ReactNode[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]?.trim().startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const Heading = `h${heading[1].length}` as "h1" | "h2" | "h3";
      blocks.push(<Heading key={`heading-${blocks.length}`}>{renderInline(heading[2])}</Heading>);
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
        items.push(<li key={`item-${items.length}`}>{renderInline((lines[index] ?? "").replace(/^\s*[-*]\s+/, ""))}</li>);
        index += 1;
      }
      blocks.push(<ul key={`list-${blocks.length}`}>{items}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? "")) {
        items.push(<li key={`item-${items.length}`}>{renderInline((lines[index] ?? "").replace(/^\s*\d+\.\s+/, ""))}</li>);
        index += 1;
      }
      blocks.push(<ol key={`list-${blocks.length}`}>{items}</ol>);
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index]?.trim() !== "" && !/^(#{1,3})\s+/.test(lines[index] ?? "") && !/^\s*[-*]\s+/.test(lines[index] ?? "") && !/^\s*\d+\.\s+/.test(lines[index] ?? "") && !lines[index]?.trim().startsWith("```")) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push(<p key={`paragraph-${blocks.length}`}>{renderInline(paragraph.join("\n"))}</p>);
  }
  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\*([^*]+)\*|_([^_]+)_/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const key = `inline-${nodes.length}`;
    if (match[1] !== undefined) {
      nodes.push(<span className="markdown-image-alt" key={key}>{match[1]}</span>);
    } else if (match[3] !== undefined) {
      const href = safeMarkdownHref(match[4]);
      nodes.push(href ? <a href={href} key={key} rel="noreferrer" target="_blank">{match[3]}</a> : match[3]);
    } else if (match[5] !== undefined || match[6] !== undefined) {
      nodes.push(<strong key={key}>{match[5] ?? match[6]}</strong>);
    } else if (match[7] !== undefined) {
      nodes.push(<code key={key}>{match[7]}</code>);
    } else {
      nodes.push(<em key={key}>{match[8] ?? match[9]}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function safeMarkdownHref(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return /^(?:https?:\/\/|\/|#)/i.test(value) ? value : undefined;
}

function ProviderSnapshotView({ snapshot, copy }: { snapshot: ProviderSnapshot; copy: ApplicationCopy }) {
  return <details className="message__snapshot">
    <summary aria-label={`${copy.providerSnapshot}: ${snapshot.provider_name}, ${snapshot.model_id}`}>
      <span className="message__snapshot-summary">
        <span className="snapshot__icon" aria-hidden="true"><ShieldCheck size={16} strokeWidth={1.8} /></span>
        <span><strong>{snapshot.provider_name}</strong><small title={snapshot.model_id}>{snapshot.model_id}</small></span>
      </span>
      <span className="message__snapshot-security"><LockKeyhole aria-hidden="true" size={14} strokeWidth={1.8} />{snapshot.transport_security.toUpperCase()}<ChevronDown aria-hidden="true" className="message__snapshot-chevron" size={15} strokeWidth={1.8} /></span>
    </summary>
    <div className="message__snapshot-details">
    <dl>
      <div><dt>{copy.provider}</dt><dd>{snapshot.provider_id}</dd></div>
      <div><dt>{copy.model}</dt><dd>{snapshot.model_id}</dd></div>
      <div><dt>{copy.runtime}</dt><dd>{snapshot.runtime_location}</dd></div>
      <div><dt>{copy.destination}</dt><dd>{snapshot.destination}</dd></div>
      <div><dt>{copy.transport}</dt><dd>{snapshot.transport_security}</dd></div>
    </dl>
    <div className="message__snapshot-notice">
      <span>{copy.privacyNotice}</span>
      <small>{snapshot.privacy_notice}</small>
    </div>
    </div>
  </details>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

const englishConversationCopy: ApplicationCopy = applicationMessages("en");

function generationErrorMessage(error: unknown, copy: ApplicationCopy): string {
  if (error instanceof LocalServiceError) {
    if (error.envelope.error.code === "protocol_error") return copy.providerProtocolError;
    if (error.envelope.error.code === "provider_unconfigured") return copy.providerUnconfigured;
    if (error.envelope.error.code === "provider_unavailable") return copy.providerUnavailable;
    if (error.envelope.error.code === "generation_in_progress") return copy.generationInProgress;
		if (error.envelope.error.code === "context_disposition_required") return copy.selectAnswerBeforeNext;
  }
  return copy.generationFailed;
}

function privateInferenceFailureMessage(error: unknown, copy: ApplicationCopy): string {
  const reason = typeof error === "string" ? error : secureInferenceFailureReason(error);
  return reason ? `${copy.privateInferenceFailed}: ${reason}` : copy.privateInferenceFailed;
}

export function providerConnectionStatus(test: "idle" | "verified" | "failed", configured?: boolean): "configured" | "unconfigured" | "failed" {
  if (test === "verified") {
    return "configured";
  }
  if (test === "failed") {
    return "failed";
  }
  return configured ? "configured" : "unconfigured";
}

export function providerConnectionLabel(test: "idle" | "verified" | "failed", configured: boolean | undefined, copy: ApplicationCopy): string {
  if (test === "verified") {
    return copy.providerTested;
  }
  if (test === "failed") {
    return copy.providerFailed;
  }
  return configured ? copy.configured : copy.keyNotConfigured;
}

export function shouldDismissProviderDialog(saved: { configured?: boolean; model_id?: string }): boolean {
  return Boolean(saved.configured && saved.model_id);
}

export function resolvedThemePreference(theme: ThemePreference): "light" | "dark" {
  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyDocumentTheme(theme: ThemePreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolvedThemePreference(theme);
}

export function nextClearConfirmLabel(armed: boolean, copy: Pick<ApplicationCopy, "clearChatData" | "clickAgainToConfirm">): string {
  return armed ? copy.clickAgainToConfirm : copy.clearChatData;
}

export function comparisonPromptForMessages(
  messages: { role: string; body: string; id: string }[],
  assistantMessageIDs: Iterable<string | undefined> = [],
  fallback = ""
): string {
  const ids = new Set([...assistantMessageIDs].filter((id): id is string => Boolean(id)));
  const firstAssistant = ids.size > 0 ? messages.findIndex((message) => ids.has(message.id)) : -1;
  const searchFrom = firstAssistant > 0 ? firstAssistant - 1 : messages.length - 1;
  for (let index = searchFrom; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index].body;
  }
  return fallback;
}

export function defaultModelAfterTest(availableModels: string[], currentModel = ""): string {
  if (currentModel && availableModels.includes(currentModel)) {
    return currentModel;
  }
  const preferred = ["Qwen/Qwen3.8-27B", "z-ai/glm-5.3-flash"];
  return preferred.find((id) => availableModels.includes(id)) ?? availableModels[0] ?? "";
}

export function providerErrorMessage(
  error: unknown,
  copy: ApplicationCopy = englishConversationCopy,
  fallback = copy.providerFailed
): string {
  if (!(error instanceof LocalServiceError)) {
    return fallback;
  }
  switch (error.envelope.error.code) {
    case "service_unavailable":
      return copy.unavailable;
    case "provider_unconfigured":
      return copy.providerUnconfigured;
    case "authentication_failed":
      return copy.authenticationFailed;
    case "validation":
      return copy.providerValidationFailed;
    case "provider_unavailable":
      return copy.providerUnavailable;
    case "protocol_error":
      return copy.providerProtocolError;
    case "rate_limited":
      return copy.providerRateLimited;
    default:
      return fallback;
  }
}

export type ProviderFeedback = {
  text: string;
  tone: "success" | "error";
};

export function providerErrorFeedback(
  error: unknown,
  copy: ApplicationCopy = englishConversationCopy,
  fallback = copy.providerFailed
): ProviderFeedback {
  return { text: providerErrorMessage(error, copy, fallback), tone: "error" };
}
