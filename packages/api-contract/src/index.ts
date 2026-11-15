export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: unknown | null;
    request_id: string;
  };
}

export interface HealthResponse {
  status: "ok";
  schema_version: "v1";
}

export interface SessionResponse {
  csrf_token: string;
}

export type ThemePreference = "system" | "light" | "dark";
export type LocalePreference = "system" | "en" | "zh" | "ja";

export interface WorkspaceSettings {
  theme: ThemePreference;
  locale: LocalePreference;
  system_prompt: string;
  /** Omit a sampling parameter by setting it to null, which retains the Provider default. */
  temperature: number | null;
  top_p: number | null;
  max_tokens: number | null;
  active_model_set: ActiveModelTarget[];
}

export interface ActiveModelTarget {
  provider_id: string;
  model_id: string;
}

export interface Conversation {
  id: string;
  title: string;
  /** Present on every current Local Service response; optional for v1 compatibility. */
  pinned?: boolean;
  /** Archived conversations are kept locally but hidden from the active list. */
  archived?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationUpdateInput {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: string;
  body: string;
  provider_snapshot?: ProviderSnapshot;
  created_at: string;
}

export interface ConversationView extends Conversation {
  messages: Message[];
  active_generation_batch?: GenerationBatch;
  /** New submissions only; legacy Conversation History is intentionally not backfilled. */
  generation_batches?: GenerationBatch[];
}

export type ProviderKind = "nearai" | "openai_compatible";
export type ProviderAuthMethod = "bearer" | "x_api_key";

export interface ProviderProfile {
  id: string;
  kind: ProviderKind;
  name: string;
  endpoint: string;
  model_id: string;
  auth_method: ProviderAuthMethod;
  runtime_location: string;
  destination: string;
  transport_security: "tls" | "plaintext" | "unknown";
  privacy_notice: string;
  configured: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderProfileInput {
  id?: string;
  kind: ProviderKind;
  name: string;
  endpoint: string;
  model_id: string;
  auth_method: ProviderAuthMethod;
  secret?: string;
}

export interface ProviderValidationResponse {
  models: string[];
  /** Provider-advertised transport classification for each catalog model. */
  model_metadata?: ProviderModelMetadata[];
}

export type ProviderModelPrivacyMode = "private_tee" | "incognito" | "chutes";

export interface ProviderModelMetadata {
  id: string;
  privacy_mode: ProviderModelPrivacyMode;
  /** True only when the current SDK can verify this model's attestation format. */
  verifiable: boolean;
}

export type GenerationState = "pending" | "verifying_environment" | "streaming" | "verifying_response" | "completed" | "stopped" | "failed";

export type GenerationVerificationStatus = "pending" | "verified_model" | "verified_gateway" | "failed" | "unsupported";
export type VerificationLaneKind = "gateway" | "model" | "response";
export type VerificationLaneStatus = "pending" | "verified" | "failed";

export interface VerificationLanes {
  gateway: VerificationLaneStatus;
  model?: VerificationLaneStatus;
  response: VerificationLaneStatus;
}

export interface GenerationVerification {
  completion_id?: string;
  /** Legacy responses may omit or carry an untyped status; the API schema validates new responses. */
  status: GenerationVerificationStatus | string;
  verified_at?: string;
  signature_kind?: "provider_tee" | "gateway" | string;
  signing_address?: string;
  signing_algorithm?: string;
  signed_message?: string;
  signature?: string;
  signature_digest?: string;
  evidence_summary?: string;
  failure_code?: string;
  evidence?: VerificationEvidence;
  /** Independent Gateway, model, and response-signature outcomes for this attempt. */
  lanes?: VerificationLanes;
}

export interface VerificationEvidence {
  kind: "model" | "gateway";
  signer_address?: string;
  signing_algorithm?: string;
  tcb_status?: string;
  advisory_ids?: string[];
  gpu_evidence?: "not_provided" | "verified";
  tls_binding?: "none" | "attested";
  deployment?: {
    app_compose?: string;
    os_image_hash?: string;
    compose_hash?: string;
  };
  raw?: Record<string, unknown>;
  /** Related environment evidence captured alongside the signed response. */
  model?: VerificationEvidence;
  gateway?: VerificationEvidence;
}

export interface ProviderSnapshot {
  provider_id: string;
  provider_name: string;
  model_id: string;
  runtime_location: string;
  destination: string;
  transport_security: "tls" | "plaintext" | "unknown";
  privacy_notice: string;
  /** Immutable catalog classification captured with this Generation. */
  privacy_mode?: ProviderModelPrivacyMode;
}

/** The immutable workspace configuration actually used for one Generation attempt. */
export interface GenerationConfigurationSnapshot {
  system_prompt: string;
  /** Null keeps the Provider default; zero is an explicitly configured value. */
  temperature: number | null;
  top_p: number | null;
  max_tokens: number | null;
}

export interface Generation {
  id: string;
  conversation_id: string;
  client_request_id: string;
  state: GenerationState;
  snapshot: ProviderSnapshot;
  configuration_snapshot: GenerationConfigurationSnapshot;
  verification?: GenerationVerification;
  user_message_id?: string;
  assistant_message_id?: string;
  error_code?: string;
  error_message?: string;
  events_url: string;
  created_at: string;
  updated_at: string;
}

export interface GenerationInput {
  client_request_id: string;
  body: string;
  attachments?: AttachmentInput[];
}

export interface AttachmentInput {
  name: string;
  /** Base64-encoded original file bytes, retained locally when the turn is saved. */
  data: string;
}

export interface SourceSection {
  /** L<number> for text lines, P<number> for PDF pages. */
  id: string;
  text: string;
}

export interface AttachmentSnapshot {
  /** SHA-256 of the original bytes. */
  id: string;
  name: string;
  media_type: "text/plain" | "application/pdf";
  size: number;
  characters: number;
  extraction_version: string;
  sections: SourceSection[];
}

export type GenerationEventType = "started" | "delta" | "completed" | "stopped" | "failed";

export interface GenerationEvent {
  event_id: string;
  generation_id: string;
  type: GenerationEventType;
  delta?: string;
  error_code?: string;
  error_message?: string;
  snapshot?: ProviderSnapshot;
}

export type GenerationBatchState = "pending" | "streaming" | "completed" | "completed_with_errors" | "stopped" | "failed";

export interface GenerationTargetAttempt {
  id: string;
  state: GenerationState;
  snapshot: ProviderSnapshot;
  configuration_snapshot: GenerationConfigurationSnapshot;
  verification?: GenerationVerification;
  assistant_message_id?: string;
  error_code?: string;
  error_message?: string;
}

export interface GenerationTarget {
  id: string;
  provider_id: string;
  model_id: string;
  position: number;
  generation: GenerationTargetAttempt;
}

/** Frozen selected history; excludes the current prompt and System Prompt. */
export interface GenerationContextMessage {
  role: "user" | "assistant";
  content: string;
}

/** A Provider input item, including the System Prompt in a draft preview. */
export interface GenerationPromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerationBatch {
  id: string;
  conversation_id: string;
  client_request_id: string;
  user_message_id?: string;
  /** Exact current user input supplied to Providers when attachments are present. */
  input_content?: string;
  attachments?: AttachmentSnapshot[];
  state: GenerationBatchState;
  targets: GenerationTarget[];
  events_url: string;
  selected_generation_id?: string;
  context_skipped?: boolean;
  context_frozen?: boolean;
  created_at: string;
  updated_at: string;
}

export interface GenerationBatchEvent extends GenerationEvent {
  batch_id: string;
  target_id: string;
}
