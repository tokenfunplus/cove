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
	/** A separate continuous Debate Session, outside ordinary comparison context. */
	debate_id?: string;
  debate_status?: DebateSession["status"];
  debate_round?: number;
  id: string;
  title: string;
  /** Present on every current Local Service response; optional for v1 compatibility. */
  pinned?: boolean;
  /** Archived conversations are kept locally but hidden from the active list. */
  archived?: boolean;
  created_at: string;
  updated_at: string;
}

export type DebateRole = "Advocate" | "Challenger" | "Evidence analyst" | "Synthesizer" | "First principles" | "Risk analyst";
export interface DebateRules {
  version: number;
  text: string;
  max_tokens: 512 | 1024 | 2048;
  checkpoint_every: number;
  rotate: boolean;
}
export interface DebateSeat extends ActiveModelTarget { role: DebateRole }
export interface DebateRate { input_per_million?: number; output_per_million?: number }
export interface DebateControls {
  version: number;
  summary_every: number;
  summary_seat: number;
  turn_delay_ms?: number;
  token_budget?: number;
  cost_budget_usd?: number;
  auto_pause: boolean;
  rates?: DebateRate[];
}
export interface DebateSummaryReference { turn_id: string; sequence: number; seat: number }
export interface DebateSummaryPoint { text: string; sources: DebateSummaryReference[] }
export interface DebateStageSummary {
  turn_id: string;
  from_round: number;
  through_round: number;
  seat: number;
  new_ideas: DebateSummaryPoint[];
  position_changes: DebateSummaryPoint[];
  open_questions: DebateSummaryPoint[];
  created_at: string;
}
export interface DebateUsage {
  calls: number;
  summary_calls: number;
  active_calls: number;
  input_tokens: number;
  output_tokens: number;
  missing_usage_calls: number;
  unpriced_calls: number;
  estimated_cost_usd: number;
  cost_complete: boolean;
  budget_status?: "token_budget" | "cost_budget" | "usage_missing" | "rates_missing";
}
export interface DebatePosition { turn_id: string; sequence: number; seat: number; body: string }
export interface DebateSession {
  id: string;
  client_request_id: string;
  topic: string;
  seats: DebateSeat[];
  rules: DebateRules;
  pending_rules?: DebateRules;
  status: "running" | "pausing" | "paused" | "stopped";
  round: number;
  position: number;
  opening_done: boolean[];
  total_turns: number;
  browser_required?: boolean;
  checkpoint?: { round: number; positions: DebatePosition[]; created_at: string };
  controls?: DebateControls;
  last_summary_round?: number;
  summary?: DebateStageSummary;
  next_turn_at?: string;
  notice?: string;
  created_at: string;
  updated_at: string;
}
export interface DebateTurn {
  id: string;
  debate_id: string;
  sequence: number;
  round: number;
  seat: number;
  role: DebateRole;
  rule_version: number;
  state: "streaming" | "completed" | "failed" | "stopped";
  kind?: "summary";
  usage_expected?: boolean;
  summary?: DebateStageSummary;
  summary_from_round?: number;
  execution?: "browser";
  phase?: "verifying_environment" | "streaming" | "verifying_response";
  verification?: GenerationVerification;
  body: string;
  reasoning?: string;
  snapshot: ProviderSnapshot;
  configuration: GenerationConfigurationSnapshot;
  context_ids: string[];
  metrics?: GenerationMetrics;
  error_code?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}
export interface DebateBrowserContext {
  turn: DebateTurn;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
}
export interface DebateBrowserProgress {
  claim_id: string;
  phase: NonNullable<DebateTurn["phase"]>;
  body: string;
  reasoning?: string;
}
export interface DebateBrowserResult {
  claim_id: string;
  body: string;
  reasoning?: string;
  metrics?: GenerationMetrics;
  verification: GenerationVerification;
}
export interface DebateIntervention {
  id: string;
  client_request_id: string;
  body: string;
  applied_round: number;
  created_at: string;
}
export interface DebateView {
  session: DebateSession;
  turns: DebateTurn[];
  interventions: DebateIntervention[];
  has_more: boolean;
  usage?: DebateUsage;
}
export interface StartDebateInput {
  client_request_id: string;
  topic: string;
  seats: DebateSeat[];
  rules: DebateRules;
  controls?: DebateControls;
}
export type DebateAction = "pause" | "resume" | "step" | "stop";

export interface ConversationUpdateInput {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
}

/** A bounded excerpt from locally retained history; no Provider request is made. */
export interface ConversationSearchResult extends Conversation {
  message_id?: string;
  turn_message_id?: string;
  role?: string;
  excerpt?: string;
}

export interface ConversationSearchFilter {
  kind?: "chat" | "debate";
  updatedAfter?: string;
}

export interface Message {
  web_sources?: AttachmentSnapshot[];
  /** Provider-labelled reasoning, separate from the answer used for future context. */
  reasoning?: string;
  id: string;
  /** Read-only origin for every saved assistant attempt, including older retries. */
  generation_batch_id?: string;
  conversation_id: string;
  role: string;
  body: string;
  provider_snapshot?: ProviderSnapshot;
  created_at: string;
}

export interface ConversationView extends Conversation {
  /** Populated by local export loading, rather than the bounded workspace query. */
  debate_export?: DebateView;
  branch?: { source_conversation_id: string; source_batch_id: string; source_title: string };
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
  /** Normalized catalog details and Cove transport classification for each model. */
  model_metadata?: ProviderModelMetadata[];
}

export type ProviderModelPrivacyMode = "private_tee" | "incognito" | "chutes";

export type ModelCapability = "text_input" | "image_input" | "audio_input" | "video_input" | "image_output" | "audio_output" | "video_output" | "tools" | "json_mode" | "structured_outputs" | "reasoning";

export interface ProviderModelMetadata {
  name?: string;
  owner?: string;
  description?: string;
  context_length?: number;
  max_output_tokens?: number;
  input_price_per_million?: number;
  output_price_per_million?: number;
  capabilities?: ModelCapability[];
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
  provider_kind?: ProviderKind;
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
  web_search?: WebSearchPolicy;
  system_prompt: string;
  /** Null keeps the Provider default; zero is an explicitly configured value. */
  temperature: number | null;
  top_p: number | null;
  max_tokens: number | null;
}

export interface GenerationMetrics {
  source: "service" | "browser";
  duration_ms: number;
  time_to_first_token_ms?: number;
  output_duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface Generation {
  web_search?: WebSearchInfo;
  metrics?: GenerationMetrics;
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

export interface ExpectedGenerationTarget {
  provider_id: string;
  model_id: string;
  require_private_tee?: boolean;
}

export interface GenerationInput {
  web_search_enabled?: boolean;
  edit_of_batch_id?: string;
  client_request_id: string;
  body: string;
  attachments?: AttachmentInput[];
  web_source_tokens?: string[];
  expected_targets?: ExpectedGenerationTarget[];
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
  /** File content hash, or the identity of an immutable webpage capture. */
  id: string;
  name: string;
  media_type: "text/plain" | "application/pdf" | "text/html";
  size: number;
  characters: number;
  extraction_version: string;
  sections: SourceSection[];
  web?: {
    kind?: "search_result";
    published_at?: string;
    original_url: string;
    final_url: string;
    fetched_at: string;
    content_sha256: string;
  };
}

export interface PreparedWebSource {
  source_token: string;
  snapshot: AttachmentSnapshot;
}

export type GenerationEventType = "started" | "delta" | "web_activity" | "completed" | "stopped" | "failed";

export interface GenerationEvent {
  web_activity?: string;
  reset?: boolean;
  event_id: string;
  generation_id: string;
  type: GenerationEventType;
  delta?: string;
  reasoning_delta?: string;
  error_code?: string;
  error_message?: string;
  snapshot?: ProviderSnapshot;
}

export type GenerationBatchState = "pending" | "streaming" | "completed" | "completed_with_errors" | "stopped" | "failed";

export interface GenerationTargetAttempt {
  web_search?: WebSearchInfo;
  metrics?: GenerationMetrics;
  created_at?: string;
  updated_at?: string;
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
  web_search?: WebSearchPolicy;
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
  /** The saved selection, including when its Target now has a newer retry. */
  selected_answer?: {
    generation_id: string;
    assistant_message_id: string;
    provider_name: string;
    model_id: string;
  };
  context_skipped?: boolean;
  context_frozen?: boolean;
  created_at: string;
  updated_at: string;
}

export interface GenerationBatchEvent extends GenerationEvent {
  batch_id: string;
  target_id: string;
}

export interface WebSearchPolicy {
  provider: "tavily" | "linkup" | "exa";
  max_searches: number;
  max_pages: number;
  max_rounds: number;
  max_results: number;
  timeout_seconds: number;
  depth: "standard" | "deep";
  include_domains?: string[];
  exclude_domains?: string[];
}
export interface WebSearchSettings {
  policy: WebSearchPolicy;
  providers: { provider: WebSearchPolicy["provider"]; configured: boolean }[];
}
export interface WebSearchInfo {
  provider: string;
  searches: number;
  pages: number;
  steps: { id: string; name: string; query?: string; url?: string; status: string; cached?: boolean; error?: string; usage?: unknown; started_at: string; finished_at?: string }[];
  sources: AttachmentSnapshot[];
}
export interface ModelToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface ModelToolDelta { index: number; id?: string; type?: "function"; function?: { name?: string; arguments?: string } }
export interface ModelTool { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface ModelToolMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ModelToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}
export interface WebToolResult { status: string; content: string; info: WebSearchInfo }
