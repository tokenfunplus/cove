package persistence

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"github.com/tokenfunplus/cove/services/local-service/internal/websearch"

	_ "modernc.org/sqlite"
)

const schemaVersion = 27

const defaultConversationTitle = "New conversation"

type SQLiteStore struct {
	db *sql.DB
}

// ChatStore is the domain-facing persistence seam used by API adapters.
type ChatStore interface {
	CreateConversation(ctx context.Context, title string) (Conversation, error)
	ListConversations(ctx context.Context) ([]Conversation, error)
	ListArchivedConversations(ctx context.Context) ([]Conversation, error)
	SearchConversations(ctx context.Context, query string, archived bool) ([]ConversationSearchResult, error)
	LoadConversation(ctx context.Context, id string) (ConversationView, error)
	DeleteConversation(ctx context.Context, id string) error
	ClearChatData(ctx context.Context) error
	AddMessage(ctx context.Context, conversationID string, input MessageInput) (Message, error)
	RenameConversation(ctx context.Context, id, title string) error
	SetConversationPinned(ctx context.Context, id string, pinned bool) error
	SetConversationArchived(ctx context.Context, id string, archived bool) error
	BeginGeneration(ctx context.Context, input BeginGenerationInput) (Generation, error)
	GetGeneration(ctx context.Context, id string) (Generation, error)
	GetGenerationByClientRequestID(ctx context.Context, clientRequestID string) (Generation, error)
	GetGenerationByMessageID(ctx context.Context, messageID string) (Generation, error)
	MarkGenerationStreaming(ctx context.Context, id string) error
	MarkGenerationVerifyingEnvironment(ctx context.Context, id string) error
	MarkGenerationVerifyingResponse(ctx context.Context, id string) error
	CompleteGeneration(ctx context.Context, input CompleteGenerationInput) error
	SettleSecureGeneration(ctx context.Context, input SecureGenerationSettlementInput) error
	TerminateGeneration(ctx context.Context, input TerminateGenerationInput) error
	RecoverInterruptedGenerations(ctx context.Context) error
	BeginGenerationBatch(ctx context.Context, input BeginGenerationBatchInput) (GenerationBatch, error)
	GetGenerationBatch(ctx context.Context, id string) (GenerationBatch, error)
	GetGenerationBatchByClientRequestID(ctx context.Context, clientRequestID string) (GenerationBatch, error)
	GetGenerationTarget(ctx context.Context, id string) (GenerationTarget, error)
	BeginGenerationAttempt(ctx context.Context, input BeginGenerationAttemptInput) (Generation, error)
	SelectGenerationAnswer(ctx context.Context, generationID string) error
	SkipGenerationBatchContext(ctx context.Context, batchID string) error
	LoadBatchContext(ctx context.Context, conversationID string) ([]ContextItem, error)
	LoadGenerationBatchContext(ctx context.Context, batchID string) ([]ContextItem, error)
	LoadBatchAttachments(ctx context.Context, batchID string) ([]documents.Prepared, error)
	LoadAttachmentData(ctx context.Context, batchID, documentID string) (documents.Input, error)
	GetWebSearchRun(context.Context, string) (WebSearchRun, error)
	MutateWebSearchRun(context.Context, string, func(*WebSearchRun, Generation) error) error
}

// ProviderStore persists only non-secret Provider Profile metadata.
type ProviderStore interface {
	ListProviderProfiles(ctx context.Context) ([]ProviderProfile, error)
	GetProviderProfile(ctx context.Context, id string) (ProviderProfile, error)
	UpsertProviderProfile(ctx context.Context, profile ProviderProfile, expected ...time.Time) error
	DeleteProviderProfile(ctx context.Context, id string, expected ...time.Time) error
}

type SettingsStore interface {
	GetSettings(ctx context.Context) (Settings, error)
	UpdateSettings(ctx context.Context, settings Settings) error
}

type Settings struct {
	Theme        string `json:"theme"`
	Locale       string `json:"locale"`
	SystemPrompt string `json:"system_prompt"`
	GenerationParameters
	// Retained only to read databases written before Active Model Set. The HTTP
	// contract exposes the ordered set exclusively.
	ActiveProviderID string              `json:"-"`
	ActiveModelID    string              `json:"-"`
	ActiveModelSet   []ActiveModelTarget `json:"active_model_set"`
}

// GenerationParameters are optional OpenAI-compatible chat completion
// controls. A nil value deliberately leaves the Provider's default intact.
// They are copied into a Generation Batch when it starts.
type GenerationParameters struct {
	Temperature *float64 `json:"temperature"`
	TopP        *float64 `json:"top_p"`
	MaxTokens   *int     `json:"max_tokens"`
}

// GenerationConfigurationSnapshot is the immutable workspace configuration
// used for one Generation attempt. Nil sampling parameters deliberately retain
// the Provider defaults, while zero is a configured value.
type GenerationConfigurationSnapshot struct {
	SystemPrompt string            `json:"system_prompt"`
	WebSearch    *websearch.Policy `json:"web_search,omitempty"`
	GenerationParameters
}

type ActiveModelTarget struct {
	ProviderID string `json:"provider_id"`
	ModelID    string `json:"model_id"`
}

type Conversation struct {
	ProjectID          string    `json:"project_id,omitempty"`
	MembershipRevision int64     `json:"membership_revision"`
	ProjectRevision    int64     `json:"project_revision"`
	DebateID           string    `json:"debate_id,omitempty"`
	DebateStatus       string    `json:"debate_status,omitempty"`
	DebateRound        int       `json:"debate_round,omitempty"`
	ID                 string    `json:"id"`
	Title              string    `json:"title"`
	Pinned             bool      `json:"pinned"`
	Archived           bool      `json:"archived"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type Message struct {
	WebSources        []documents.Snapshot `json:"web_sources,omitempty"`
	Reasoning         string               `json:"reasoning,omitempty"`
	ID                string               `json:"id"`
	GenerationBatchID string               `json:"generation_batch_id,omitempty"`
	ConversationID    string               `json:"conversation_id"`
	Role              string               `json:"role"`
	Body              string               `json:"body"`
	ProviderSnapshot  *ProviderSnapshot    `json:"provider_snapshot,omitempty"`
	CreatedAt         time.Time            `json:"created_at"`
}

type MessageInput struct {
	Role string `json:"role"`
	Body string `json:"body"`
}

type ConversationBranch struct {
	SourceConversationID string `json:"source_conversation_id"`
	SourceBatchID        string `json:"source_batch_id"`
	SourceTitle          string `json:"source_title"`
}

type ConversationView struct {
	Branch *ConversationBranch `json:"branch,omitempty"`
	Conversation
	Messages              []Message         `json:"messages"`
	ActiveGeneration      *Generation       `json:"active_generation,omitempty"`
	ActiveGenerationBatch *GenerationBatch  `json:"active_generation_batch,omitempty"`
	GenerationBatches     []GenerationBatch `json:"generation_batches"`
}

type ProviderSnapshot struct {
	LocalModel        *provider.ModelArtifact `json:"local_model,omitempty"`
	ProviderKind      string                  `json:"provider_kind,omitempty"`
	ProviderID        string                  `json:"provider_id"`
	ProviderName      string                  `json:"provider_name"`
	ModelID           string                  `json:"model_id"`
	RuntimeLocation   string                  `json:"runtime_location"`
	Destination       string                  `json:"destination"`
	TransportSecurity string                  `json:"transport_security"`
	PrivacyNotice     string                  `json:"privacy_notice"`
	PrivacyMode       string                  `json:"privacy_mode,omitempty"`
}

func (snapshot ProviderSnapshot) IsNearAI() bool {
	if snapshot.ProviderKind != "" {
		return snapshot.ProviderKind == "nearai"
	}
	return snapshot.RuntimeLocation == "NearAI cloud" ||
		(snapshot.ProviderID == "nearai" && snapshot.RuntimeLocation == "")
}

type GenerationState string

const (
	GenerationPending              GenerationState = "pending"
	GenerationVerifyingEnvironment GenerationState = "verifying_environment"
	GenerationStreaming            GenerationState = "streaming"
	GenerationVerifyingResponse    GenerationState = "verifying_response"
	GenerationCompleted            GenerationState = "completed"
	GenerationStopped              GenerationState = "stopped"
	GenerationFailed               GenerationState = "failed"
)

type VerificationStatus string

const (
	VerificationPending     VerificationStatus = "pending"
	VerificationModel       VerificationStatus = "verified_model"
	VerificationGateway     VerificationStatus = "verified_gateway"
	VerificationFailed      VerificationStatus = "failed"
	VerificationUnsupported VerificationStatus = "unsupported"
)

// GenerationVerification is the immutable, user-displayable result for one
// secure attempt. Signature material is kept as a summary; raw attestation
// evidence is retained for audit display while the browser performs verification.
type VerificationLaneStatus string

const (
	VerificationLanePending  VerificationLaneStatus = "pending"
	VerificationLaneVerified VerificationLaneStatus = "verified"
	VerificationLaneFailed   VerificationLaneStatus = "failed"
)

type VerificationLanes struct {
	Gateway  VerificationLaneStatus `json:"gateway"`
	Model    VerificationLaneStatus `json:"model,omitempty"`
	Response VerificationLaneStatus `json:"response"`
}

type GenerationVerification struct {
	CompletionID     string                `json:"completion_id,omitempty"`
	Status           VerificationStatus    `json:"status"`
	VerifiedAt       *time.Time            `json:"verified_at,omitempty"`
	SignatureKind    string                `json:"signature_kind,omitempty"`
	SigningAddress   string                `json:"signing_address,omitempty"`
	SigningAlgorithm string                `json:"signing_algorithm,omitempty"`
	SignedMessage    string                `json:"signed_message,omitempty"`
	Signature        string                `json:"signature,omitempty"`
	SignatureDigest  string                `json:"signature_digest,omitempty"`
	EvidenceSummary  string                `json:"evidence_summary,omitempty"`
	FailureCode      string                `json:"failure_code,omitempty"`
	Evidence         *VerificationEvidence `json:"evidence,omitempty"`
	Lanes            *VerificationLanes    `json:"lanes,omitempty"`
}

type VerificationEvidence struct {
	Kind             string                 `json:"kind"`
	SignerAddress    string                 `json:"signer_address,omitempty"`
	SigningAlgorithm string                 `json:"signing_algorithm,omitempty"`
	TCBStatus        string                 `json:"tcb_status,omitempty"`
	AdvisoryIDs      []string               `json:"advisory_ids,omitempty"`
	GPUEvidence      string                 `json:"gpu_evidence,omitempty"`
	TLSBinding       string                 `json:"tls_binding,omitempty"`
	Deployment       map[string]string      `json:"deployment,omitempty"`
	Raw              map[string]interface{} `json:"raw,omitempty"`
	Model            *VerificationEvidence  `json:"model,omitempty"`
	Gateway          *VerificationEvidence  `json:"gateway,omitempty"`
}

type Generation struct {
	WebSearch             *WebSearchInfo                  `json:"web_search,omitempty"`
	Metrics               *GenerationMetrics              `json:"metrics,omitempty"`
	ID                    string                          `json:"id"`
	GenerationBatchID     string                          `json:"generation_batch_id,omitempty"`
	GenerationTargetID    string                          `json:"generation_target_id,omitempty"`
	ConversationID        string                          `json:"conversation_id"`
	ClientRequestID       string                          `json:"client_request_id"`
	UserMessageID         string                          `json:"user_message_id"`
	State                 GenerationState                 `json:"state"`
	Snapshot              ProviderSnapshot                `json:"snapshot"`
	ConfigurationSnapshot GenerationConfigurationSnapshot `json:"configuration_snapshot"`
	Verification          GenerationVerification          `json:"verification"`
	AssistantMessageID    string                          `json:"assistant_message_id,omitempty"`
	ErrorCode             string                          `json:"error_code,omitempty"`
	ErrorMessage          string                          `json:"error_message,omitempty"`
	CreatedAt             time.Time                       `json:"created_at"`
	UpdatedAt             time.Time                       `json:"updated_at"`
}

type GenerationBatchState string

const (
	GenerationBatchPending             GenerationBatchState = "pending"
	GenerationBatchStreaming           GenerationBatchState = "streaming"
	GenerationBatchCompleted           GenerationBatchState = "completed"
	GenerationBatchCompletedWithErrors GenerationBatchState = "completed_with_errors"
	GenerationBatchStopped             GenerationBatchState = "stopped"
	GenerationBatchFailed              GenerationBatchState = "failed"
)

type GenerationBatch struct {
	LocalOnly       bool                 `json:"local_only,omitempty"`
	ProjectContext  *ProjectContext      `json:"project_context,omitempty"`
	WebSearch       *websearch.Policy    `json:"web_search,omitempty"`
	ContextItems    []ContextItem        `json:"-"`
	ID              string               `json:"id"`
	ConversationID  string               `json:"conversation_id"`
	ClientRequestID string               `json:"client_request_id"`
	UserMessageID   string               `json:"user_message_id"`
	InputContent    string               `json:"input_content,omitempty"`
	Attachments     []documents.Snapshot `json:"attachments,omitempty"`
	// Retained for the Batch's original request record and for compatibility with
	// callers that do not have a SettingsStore. A Generation attempt's own
	// ConfigurationSnapshot is authoritative for its prompt and parameters.
	SystemPrompt         string               `json:"-"`
	GenerationParameters GenerationParameters `json:"-"`
	State                GenerationBatchState `json:"state"`
	Targets              []GenerationTarget   `json:"targets"`
	SelectedGenerationID string               `json:"selected_generation_id,omitempty"`
	SelectedAnswer       *SelectedAnswer      `json:"selected_answer,omitempty"`
	ContextSkipped       bool                 `json:"context_skipped,omitempty"`
	ContextFrozen        bool                 `json:"context_frozen,omitempty"`
	CreatedAt            time.Time            `json:"created_at"`
	UpdatedAt            time.Time            `json:"updated_at"`
}

// SelectedAnswer remains identifiable when a Target's latest retry differs.
type SelectedAnswer struct {
	GenerationID       string `json:"generation_id"`
	AssistantMessageID string `json:"assistant_message_id"`
	ProviderName       string `json:"provider_name"`
	ModelID            string `json:"model_id"`
}

type GenerationTarget struct {
	ID         string     `json:"id"`
	BatchID    string     `json:"batch_id"`
	ProviderID string     `json:"provider_id"`
	ModelID    string     `json:"model_id"`
	Position   int        `json:"position"`
	Generation Generation `json:"generation"`
}

type GenerationTargetInput struct {
	ProviderID string
	ModelID    string
	Snapshot   ProviderSnapshot
}

type BeginGenerationBatchInput struct {
	LocalOnly            bool
	ExpectedProject      *ProjectExpectation
	WebSearch            *websearch.Policy
	EditOfBatchID        string
	ConversationID       string
	ClientRequestID      string
	Body                 string
	InputContent         string
	Attachments          []documents.Prepared
	SystemPrompt         string
	GenerationParameters GenerationParameters
	Targets              []GenerationTargetInput
}

type BeginGenerationAttemptInput struct {
	TargetID              string
	ClientRequestID       string
	Snapshot              ProviderSnapshot
	ConfigurationSnapshot GenerationConfigurationSnapshot
	Failure               *GenerationAttemptFailure
}

type GenerationAttemptFailure struct {
	Code    string
	Message string
}

type ContextItem struct {
	UserMessageID        string
	SelectedGenerationID string
	UserBody             string
	AssistantBody        string
}

type BeginGenerationInput struct {
	ConversationID        string
	ClientRequestID       string
	Body                  string
	Snapshot              ProviderSnapshot
	ConfigurationSnapshot GenerationConfigurationSnapshot
}

type CompleteGenerationInput struct {
	GenerationID string
	Body         string
	Reasoning    string
	Metrics      *GenerationMetrics
}

type SecureGenerationSettlementInput struct {
	GenerationID string
	Body         string
	Reasoning    string
	Verification GenerationVerification
	Metrics      *GenerationMetrics
}

type TerminateGenerationInput struct {
	GenerationID string
	State        GenerationState
	ErrorCode    string
	ErrorMessage string
}

type ProviderProfile struct {
	ID            string    `json:"id"`
	Kind          string    `json:"kind"`
	Name          string    `json:"name"`
	Endpoint      string    `json:"endpoint"`
	ModelID       string    `json:"model_id"`
	AuthMethod    string    `json:"auth_method"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
	CredentialRef string    `json:"-"`
}

func OpenSQLite(path string) (*SQLiteStore, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open SQLite database: %w", err)
	}
	// SQLite connection PRAGMAs are connection-scoped; one connection keeps
	// the configured foreign-key, busy-timeout, and WAL behavior consistent.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	store := &SQLiteStore{db: db}
	if err := store.configure(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (store *SQLiteStore) Close() error {
	return store.db.Close()
}

func (store *SQLiteStore) configure() error {
	for _, statement := range []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 5000",
		"PRAGMA journal_mode = WAL",
	} {
		if _, err := store.db.Exec(statement); err != nil {
			return fmt.Errorf("configure SQLite (%s): %w", statement, err)
		}
	}
	return nil
}

func (store *SQLiteStore) migrate() error {
	version, err := readPragmaInt(store.db, "user_version")
	if err != nil {
		return fmt.Errorf("read SQLite schema version: %w", err)
	}
	if version > schemaVersion {
		return fmt.Errorf("unsupported SQLite schema version %d", version)
	}
	if version == schemaVersion {
		return nil
	}
	tx, err := store.db.Begin()
	if err != nil {
		return fmt.Errorf("begin SQLite migration: %w", err)
	}
	defer tx.Rollback()
	if version == 23 {
		// The unreleased local-model preview also used version 23, before
		// Projects landed. Identify that shape without changing either payload.
		var localPreview bool
		if err := tx.QueryRow(`SELECT
  (SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('local_documents','local_document_chunks'))=2
  AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('projects','project_source_blobs','project_sources','generation_project_contexts','batch_project_sources'))
  AND NOT EXISTS(SELECT 1 FROM pragma_table_info('conversations') WHERE name IN ('project_id','membership_revision'))
  AND NOT EXISTS(SELECT 1 FROM pragma_table_info('generation_batches') WHERE name='project_context_required')`).Scan(&localPreview); err != nil {
			return fmt.Errorf("identify SQLite preview schema: %w", err)
		}
		if localPreview {
			version = 22
		}
	}
	if version == 0 {
		if _, err := tx.Exec(`
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_conversation_created_idx ON messages(conversation_id, created_at, id);
PRAGMA user_version = 1;
		`); err != nil {
			return fmt.Errorf("apply SQLite migration 1: %w", err)
		}
		version = 1
	}
	if version == 1 {
		if _, err := tx.Exec(`
CREATE TABLE provider_profiles (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  model_id TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
PRAGMA user_version = 2;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 2: %w", err)
		}
		version = 2
	}
	if version == 2 {
		if _, err := tx.Exec(`
ALTER TABLE messages ADD COLUMN provider_snapshot TEXT;
CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL UNIQUE,
  user_message_id TEXT NOT NULL REFERENCES messages(id),
  state TEXT NOT NULL,
  provider_snapshot TEXT NOT NULL,
  assistant_message_id TEXT REFERENCES messages(id),
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX generations_conversation_created_idx ON generations(conversation_id, created_at, id);
PRAGMA user_version = 3;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 3: %w", err)
		}
		version = 3
	}
	if version == 3 {
		if _, err := tx.Exec(`
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  theme TEXT NOT NULL,
  locale TEXT NOT NULL,
  system_prompt TEXT NOT NULL
);
INSERT INTO app_settings (id, theme, locale, system_prompt) VALUES (1, 'system', 'system', '');
PRAGMA user_version = 4;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 4: %w", err)
		}
		version = 4
	}
	if version == 4 {
		if _, err := tx.Exec(`
ALTER TABLE app_settings ADD COLUMN active_provider_id TEXT NOT NULL DEFAULT '';
ALTER TABLE app_settings ADD COLUMN active_model_id TEXT NOT NULL DEFAULT '';
PRAGMA user_version = 5;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 5: %w", err)
		}
		version = 5
	}
	if version == 5 {
		if _, err := tx.Exec(`
ALTER TABLE conversations ADD COLUMN pinned_at INTEGER;
ALTER TABLE conversations ADD COLUMN archived_at INTEGER;
CREATE INDEX conversations_active_order_idx ON conversations(archived_at, pinned_at, updated_at, id);
CREATE INDEX conversations_archived_order_idx ON conversations(archived_at, updated_at, id);
PRAGMA user_version = 6;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 6: %w", err)
		}
		version = 6
	}
	if version == 6 {
		if _, err := tx.Exec(`
ALTER TABLE app_settings ADD COLUMN active_model_set TEXT NOT NULL DEFAULT '[]';
CREATE TABLE generation_batches (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL UNIQUE,
  user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  selected_generation_id TEXT,
  context_skipped INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX generation_batches_conversation_created_idx ON generation_batches(conversation_id, created_at, id);
CREATE TABLE generation_targets (
  id TEXT PRIMARY KEY,
  generation_batch_id TEXT NOT NULL REFERENCES generation_batches(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  latest_generation_id TEXT,
  UNIQUE(generation_batch_id, position)
);
CREATE TABLE batch_context_items (
  generation_batch_id TEXT NOT NULL REFERENCES generation_batches(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  selected_generation_id TEXT NOT NULL REFERENCES generations(id),
  PRIMARY KEY(generation_batch_id, position)
);
ALTER TABLE generations ADD COLUMN generation_batch_id TEXT REFERENCES generation_batches(id) ON DELETE CASCADE;
ALTER TABLE generations ADD COLUMN generation_target_id TEXT REFERENCES generation_targets(id) ON DELETE CASCADE;
CREATE INDEX generations_batch_target_created_idx ON generations(generation_batch_id, generation_target_id, created_at, id);
PRAGMA user_version = 7;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 7: %w", err)
		}
		version = 7
	}
	if version == 7 {
		if _, err := tx.Exec(`
CREATE INDEX generation_targets_latest_generation_idx ON generation_targets(latest_generation_id);
PRAGMA user_version = 8;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 8: %w", err)
		}
		version = 8
	}
	if version == 8 {
		if _, err := tx.Exec(`
ALTER TABLE generation_batches ADD COLUMN system_prompt TEXT NOT NULL DEFAULT '';
PRAGMA user_version = 9;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 9: %w", err)
		}
		version = 9
	}
	if version == 9 {
		if _, err := tx.Exec(`
ALTER TABLE generation_batches ADD COLUMN context_frozen INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 10;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 10: %w", err)
		}
		version = 10
	}
	if version == 10 {
		if _, err := tx.Exec(`
ALTER TABLE app_settings ADD COLUMN temperature REAL;
ALTER TABLE app_settings ADD COLUMN top_p REAL;
ALTER TABLE app_settings ADD COLUMN max_tokens INTEGER;
ALTER TABLE generation_batches ADD COLUMN temperature REAL;
ALTER TABLE generation_batches ADD COLUMN top_p REAL;
ALTER TABLE generation_batches ADD COLUMN max_tokens INTEGER;
PRAGMA user_version = 11;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 11: %w", err)
		}
		version = 11
	}
	if version == 11 {
		if _, err := tx.Exec(`
ALTER TABLE generations ADD COLUMN system_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE generations ADD COLUMN temperature REAL;
ALTER TABLE generations ADD COLUMN top_p REAL;
ALTER TABLE generations ADD COLUMN max_tokens INTEGER;
PRAGMA user_version = 12;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 12: %w", err)
		}
		version = 12
	}
	if version == 12 {
		if _, err := tx.Exec(`
ALTER TABLE generations ADD COLUMN verification_snapshot TEXT NOT NULL DEFAULT '{}';
PRAGMA user_version = 13;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 13: %w", err)
		}
		version = 13
	}
	if version == 13 {
		if _, err := tx.Exec(`
ALTER TABLE generation_batches ADD COLUMN input_content TEXT NOT NULL DEFAULT '';
ALTER TABLE generation_batches ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
ALTER TABLE generation_batches ADD COLUMN attachment_data TEXT NOT NULL DEFAULT '[]';
PRAGMA user_version = 14;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 14: %w", err)
		}
		version = 14
	}
	if version == 14 {
		if _, err := tx.Exec(`
ALTER TABLE provider_profiles ADD COLUMN credential_ref TEXT NOT NULL DEFAULT '';
PRAGMA user_version = 15;
`); err != nil {
			return fmt.Errorf("apply SQLite migration 15: %w", err)
		}
		version = 15
	}
	if version == 15 {
		if _, err := tx.Exec(conversationSearchMigration); err != nil {
			return fmt.Errorf("apply SQLite migration 16: %w", err)
		}
		version = 16
	}
	if version == 16 {
		if _, err := tx.Exec(`ALTER TABLE generations ADD COLUMN metrics TEXT NOT NULL DEFAULT '{}'; PRAGMA user_version = 17;`); err != nil {
			return fmt.Errorf("apply SQLite migration 17: %w", err)
		}
		version = 17
	}
	if version == 17 {
		if _, err := tx.Exec(`ALTER TABLE messages ADD COLUMN reasoning TEXT NOT NULL DEFAULT ''; PRAGMA user_version = 18;`); err != nil {
			return fmt.Errorf("apply SQLite migration 18: %w", err)
		}
		version = 18
	}
	if version == 18 {
		if _, err := tx.Exec(`CREATE TABLE conversation_branches (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE, source_conversation_id TEXT NOT NULL, source_batch_id TEXT NOT NULL, source_title TEXT NOT NULL); PRAGMA user_version = 19;`); err != nil {
			return fmt.Errorf("apply SQLite migration 19: %w", err)
		}
		version = 19
	}
	if version == 19 {
		if _, err := tx.Exec(debateMigration); err != nil {
			return fmt.Errorf("apply SQLite migration 20: %w", err)
		}
		version = 20
	}
	if version == 20 {
		if _, err := tx.Exec(`PRAGMA user_version = 21;`); err != nil {
			return fmt.Errorf("apply SQLite migration 21: %w", err)
		}
	}
	if version == 20 {
		version = 21
	}
	if version == 21 {
		if _, err := tx.Exec(`ALTER TABLE generation_batches ADD COLUMN web_search_policy TEXT NOT NULL DEFAULT '';
ALTER TABLE generations ADD COLUMN web_search_policy TEXT NOT NULL DEFAULT '';
ALTER TABLE generations ADD COLUMN web_search_run TEXT NOT NULL DEFAULT '{}';
ALTER TABLE generations ADD COLUMN web_search_info TEXT NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN web_sources TEXT NOT NULL DEFAULT '[]';
ALTER TABLE messages ADD COLUMN context_body TEXT NOT NULL DEFAULT '';
CREATE TABLE web_search_settings (id INTEGER PRIMARY KEY CHECK(id=1), configuration TEXT NOT NULL);
PRAGMA user_version=22;`); err != nil {
			return fmt.Errorf("apply SQLite migration 22: %w", err)
		}
		configuration, _ := json.Marshal(websearch.Defaults())
		if _, err := tx.Exec(`INSERT INTO web_search_settings(id,configuration) VALUES(1,?)`, string(configuration)); err != nil {
			return err
		}
		version = 22
	}
	if version == 22 {
		if _, err := tx.Exec(projectMigration); err != nil {
			return fmt.Errorf("apply SQLite migration 23: %w", err)
		}
	}
	if version == 22 {
		version = 23
	}
	if version == 23 {
		if _, err := tx.Exec(`CREATE INDEX project_context_project_idx ON generation_project_contexts(json_extract(payload,'$.project_id')); CREATE INDEX project_sources_blob_idx ON project_sources(blob_hash); CREATE INDEX batch_project_sources_blob_idx ON batch_project_sources(blob_hash); PRAGMA user_version=24;`); err != nil {
			return fmt.Errorf("apply SQLite migration 24: %w", err)
		}
	}
	if version == 23 {
		version = 24
	}
	if version == 24 {
		if _, err := tx.Exec(localDocumentsMigration); err != nil {
			return fmt.Errorf("apply SQLite migration 25: %w", err)
		}
	}
	if version == 24 {
		version = 25
	}
	if version == 25 {
		if _, err := tx.Exec(localCapabilitiesMigration); err != nil {
			return fmt.Errorf("apply SQLite migration 26: %w", err)
		}
		version = 26
	}
	if version == 26 {
		if _, err := tx.Exec(speechMigration); err != nil {
			return fmt.Errorf("apply SQLite migration 27: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit SQLite migration: %w", err)
	}
	return nil
}

func (store *SQLiteStore) CreateConversation(ctx context.Context, title string) (Conversation, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = defaultConversationTitle
	}
	now := time.Now().UTC()
	id, err := newID()
	if err != nil {
		return Conversation{}, fmt.Errorf("create conversation ID: %w", err)
	}
	conversation := Conversation{ID: id, Title: title, CreatedAt: now, UpdatedAt: now}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`, conversation.ID, conversation.Title, now.UnixNano(), now.UnixNano()); err != nil {
		return Conversation{}, fmt.Errorf("create conversation: %w", err)
	}
	return conversation, nil
}

func (store *SQLiteStore) ListConversations(ctx context.Context) ([]Conversation, error) {
	return store.listConversations(ctx, false)
}

func (store *SQLiteStore) ListArchivedConversations(ctx context.Context) ([]Conversation, error) {
	return store.listConversations(ctx, true)
}

func (store *SQLiteStore) listConversations(ctx context.Context, archived bool) ([]Conversation, error) {
	query := conversationSelect + ` WHERE archived_at IS NULL ORDER BY CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END, pinned_at DESC, updated_at DESC, id DESC`
	if archived {
		query = conversationSelect + ` WHERE archived_at IS NOT NULL ORDER BY archived_at DESC, updated_at DESC, id DESC`
	}
	rows, err := store.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}
	defer rows.Close()
	conversations := make([]Conversation, 0)
	for rows.Next() {
		conversation, err := scanConversation(rows)
		if err != nil {
			return nil, fmt.Errorf("scan conversation: %w", err)
		}
		conversations = append(conversations, conversation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate conversations: %w", err)
	}
	return conversations, nil
}

func (store *SQLiteStore) LoadConversation(ctx context.Context, id string) (ConversationView, error) {
	row := store.db.QueryRowContext(ctx, conversationSelect+` WHERE id = ?`, id)
	conversation, err := scanConversation(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ConversationView{}, fmt.Errorf("conversation %q: %w", id, sql.ErrNoRows)
	}
	if err != nil {
		return ConversationView{}, fmt.Errorf("load conversation: %w", err)
	}
	rows, err := store.db.QueryContext(ctx, `SELECT m.id, m.conversation_id, m.role, m.body, m.provider_snapshot, m.created_at, COALESCE(g.generation_batch_id, ''), m.reasoning, m.web_sources
FROM messages m LEFT JOIN generations g ON g.assistant_message_id = m.id
WHERE m.conversation_id = ? ORDER BY m.created_at ASC, m.id ASC`, id)
	if err != nil {
		return ConversationView{}, fmt.Errorf("load conversation messages: %w", err)
	}
	defer rows.Close()
	view := ConversationView{Conversation: conversation, Messages: []Message{}, GenerationBatches: []GenerationBatch{}}
	for rows.Next() {
		var message Message
		var snapshot sql.NullString
		var webSources string
		var createdAt int64
		if err := rows.Scan(&message.ID, &message.ConversationID, &message.Role, &message.Body, &snapshot, &createdAt, &message.GenerationBatchID, &message.Reasoning, &webSources); err != nil {
			return ConversationView{}, fmt.Errorf("scan message: %w", err)
		}
		if err := json.Unmarshal([]byte(webSources), &message.WebSources); err != nil {
			return ConversationView{}, err
		}
		if snapshot.Valid {
			var value ProviderSnapshot
			if err := json.Unmarshal([]byte(snapshot.String), &value); err != nil {
				return ConversationView{}, fmt.Errorf("decode message provider snapshot: %w", err)
			}
			message.ProviderSnapshot = &value
		}
		message.CreatedAt = time.Unix(0, createdAt).UTC()
		view.Messages = append(view.Messages, message)
	}
	if err := rows.Err(); err != nil {
		return ConversationView{}, fmt.Errorf("iterate messages: %w", err)
	}
	active, activeErr := scanGeneration(store.db.QueryRowContext(ctx, generationQuery+` WHERE conversation_id = ? AND state IN (?, ?) ORDER BY created_at DESC, id DESC LIMIT 1`, id, GenerationPending, GenerationStreaming))
	if activeErr == nil {
		view.ActiveGeneration = &active
	} else if !errors.Is(activeErr, sql.ErrNoRows) {
		return ConversationView{}, fmt.Errorf("load active generation: %w", activeErr)
	}
	projectCache := make(map[string]*ProjectContext)
	var activeBatchID string
	activeBatchErr := store.db.QueryRowContext(ctx, `SELECT id FROM generation_batches WHERE conversation_id = ? AND state IN (?, ?) ORDER BY created_at DESC, id DESC LIMIT 1`, id, GenerationBatchPending, GenerationBatchStreaming).Scan(&activeBatchID)
	if activeBatchErr == nil {
		batch, err := getGenerationBatch(ctx, store.db, activeBatchID, projectCache)
		if err != nil {
			return ConversationView{}, fmt.Errorf("load active generation batch: %w", err)
		}
		view.ActiveGenerationBatch = &batch
	} else if !errors.Is(activeBatchErr, sql.ErrNoRows) {
		return ConversationView{}, fmt.Errorf("find active generation batch: %w", activeBatchErr)
	}
	batches, err := store.listConversationGenerationBatches(ctx, id, projectCache)
	if err != nil {
		return ConversationView{}, err
	}
	view.GenerationBatches = batches
	view.Branch, err = store.loadConversationBranch(ctx, id)
	if err != nil {
		return ConversationView{}, err
	}
	return view, nil
}

func (store *SQLiteStore) listConversationGenerationBatches(ctx context.Context, conversationID string, caches ...map[string]*ProjectContext) ([]GenerationBatch, error) {
	rows, err := store.db.QueryContext(ctx, `SELECT id FROM generation_batches WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`, conversationID)
	if err != nil {
		return nil, fmt.Errorf("list conversation generation batches: %w", err)
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan conversation generation batch: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate conversation generation batches: %w", err)
	}
	batches := make([]GenerationBatch, 0, len(ids))
	for _, id := range ids {
		batch, err := getGenerationBatch(ctx, store.db, id, caches...)
		if err != nil {
			return nil, fmt.Errorf("load conversation generation batch: %w", err)
		}
		batches = append(batches, batch)
	}
	return batches, nil
}

func (store *SQLiteStore) DeleteConversation(ctx context.Context, id string) error {
	result, err := store.db.ExecContext(ctx, `DELETE FROM conversations WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete conversation: %w", err)
	}
	if count, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("check deleted conversation: %w", err)
	} else if count == 0 {
		return fmt.Errorf("conversation %q: %w", id, sql.ErrNoRows)
	}
	return nil
}

func (store *SQLiteStore) ClearChatData(ctx context.Context) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin clear chat data: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM conversations; DELETE FROM local_documents; DELETE FROM project_source_indexes;`); err != nil {
		return fmt.Errorf("clear conversation history: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit clear chat data: %w", err)
	}
	return nil
}

func (store *SQLiteStore) GetSettings(ctx context.Context) (Settings, error) {
	var settings Settings
	var activeModelSet string
	var temperature, topP sql.NullFloat64
	var maxTokens sql.NullInt64
	if err := store.db.QueryRowContext(ctx, `SELECT theme, locale, system_prompt, temperature, top_p, max_tokens, active_provider_id, active_model_id, active_model_set FROM app_settings WHERE id = 1`).Scan(&settings.Theme, &settings.Locale, &settings.SystemPrompt, &temperature, &topP, &maxTokens, &settings.ActiveProviderID, &settings.ActiveModelID, &activeModelSet); err != nil {
		return Settings{}, fmt.Errorf("get workspace settings: %w", err)
	}
	if temperature.Valid {
		settings.Temperature = &temperature.Float64
	}
	if topP.Valid {
		settings.TopP = &topP.Float64
	}
	if maxTokens.Valid {
		value := int(maxTokens.Int64)
		settings.MaxTokens = &value
	}
	if err := json.Unmarshal([]byte(activeModelSet), &settings.ActiveModelSet); err != nil {
		return Settings{}, fmt.Errorf("decode workspace active model set: %w", err)
	}
	return settings, nil
}

func (store *SQLiteStore) UpdateSettings(ctx context.Context, settings Settings) error {
	if !validTheme(settings.Theme) || !validLocale(settings.Locale) {
		return errors.New("workspace settings theme or locale is invalid")
	}
	if utf8.RuneCountInString(settings.SystemPrompt) > 8192 {
		return errors.New("workspace system prompt exceeds 8192 Unicode characters")
	}
	if err := validateGenerationParameters(settings.GenerationParameters); err != nil {
		return err
	}
	activeModelSet, err := normalizeActiveModelSet(settings.ActiveModelSet)
	if err != nil {
		return err
	}
	if len(activeModelSet) == 0 && (strings.TrimSpace(settings.ActiveProviderID) != "" || strings.TrimSpace(settings.ActiveModelID) != "") {
		legacy := []ActiveModelTarget{{ProviderID: strings.TrimSpace(settings.ActiveProviderID), ModelID: strings.TrimSpace(settings.ActiveModelID)}}
		activeModelSet, err = normalizeActiveModelSet(legacy)
		if err != nil {
			return err
		}
	}
	encodedSet, err := json.Marshal(activeModelSet)
	if err != nil {
		return fmt.Errorf("encode workspace active model set: %w", err)
	}
	activeProviderID, activeModelID := "", ""
	if len(activeModelSet) > 0 {
		activeProviderID = activeModelSet[0].ProviderID
		activeModelID = activeModelSet[0].ModelID
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE app_settings SET theme = ?, locale = ?, system_prompt = ?, temperature = ?, top_p = ?, max_tokens = ?, active_provider_id = ?, active_model_id = ?, active_model_set = ? WHERE id = 1`, settings.Theme, settings.Locale, settings.SystemPrompt, settings.Temperature, settings.TopP, settings.MaxTokens, activeProviderID, activeModelID, string(encodedSet)); err != nil {
		return fmt.Errorf("update workspace settings: %w", err)
	}
	return nil
}

func validateGenerationParameters(parameters GenerationParameters) error {
	if parameters.Temperature != nil && (math.IsNaN(*parameters.Temperature) || math.IsInf(*parameters.Temperature, 0) || *parameters.Temperature < 0 || *parameters.Temperature > 2) {
		return errors.New("workspace temperature must be between 0 and 2")
	}
	if parameters.TopP != nil && (math.IsNaN(*parameters.TopP) || math.IsInf(*parameters.TopP, 0) || *parameters.TopP < 0 || *parameters.TopP > 1) {
		return errors.New("workspace top_p must be between 0 and 1")
	}
	if parameters.MaxTokens != nil && *parameters.MaxTokens < 1 {
		return errors.New("workspace max_tokens must be at least 1")
	}
	return nil
}

func validateGenerationConfigurationSnapshot(snapshot GenerationConfigurationSnapshot) error {
	if utf8.RuneCountInString(snapshot.SystemPrompt) > 8192 {
		return errors.New("system prompt exceeds 8192 characters")
	}
	return validateGenerationParameters(snapshot.GenerationParameters)
}

func normalizeActiveModelSet(values []ActiveModelTarget) ([]ActiveModelTarget, error) {
	if len(values) > 4 {
		return nil, errors.New("workspace active model set cannot contain more than four targets")
	}
	if len(values) == 0 {
		return []ActiveModelTarget{}, nil
	}
	normalized := make([]ActiveModelTarget, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value.ProviderID = strings.TrimSpace(value.ProviderID)
		value.ModelID = strings.TrimSpace(value.ModelID)
		if value.ProviderID == "" || value.ModelID == "" {
			return nil, errors.New("each active model target requires a provider and model")
		}
		key := value.ProviderID + "\x00" + value.ModelID
		if _, exists := seen[key]; exists {
			return nil, errors.New("workspace active model set cannot contain duplicate targets")
		}
		seen[key] = struct{}{}
		normalized = append(normalized, value)
	}
	return normalized, nil
}

func validTheme(theme string) bool {
	return theme == "system" || theme == "light" || theme == "dark"
}

func validLocale(locale string) bool {
	return locale == "system" || locale == "en" || locale == "zh" || locale == "ja"
}

func (store *SQLiteStore) BeginGeneration(ctx context.Context, input BeginGenerationInput) (Generation, error) {
	input.ClientRequestID = strings.TrimSpace(input.ClientRequestID)
	if input.ConversationID == "" || input.ClientRequestID == "" || strings.TrimSpace(input.Body) == "" {
		return Generation{}, errors.New("generation conversation, client request ID, and body are required")
	}
	if err := validateGenerationConfigurationSnapshot(input.ConfigurationSnapshot); err != nil {
		return Generation{}, err
	}
	snapshot, err := json.Marshal(input.Snapshot)
	if err != nil {
		return Generation{}, fmt.Errorf("encode provider snapshot: %w", err)
	}
	id, err := newID()
	if err != nil {
		return Generation{}, fmt.Errorf("create generation ID: %w", err)
	}
	messageID, err := newID()
	if err != nil {
		return Generation{}, fmt.Errorf("create user message ID: %w", err)
	}
	now := time.Now().UTC()
	generation := Generation{
		ID: id, ConversationID: input.ConversationID, ClientRequestID: input.ClientRequestID,
		State: GenerationPending, Snapshot: input.Snapshot, ConfigurationSnapshot: input.ConfigurationSnapshot, CreatedAt: now, UpdatedAt: now,
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return Generation{}, fmt.Errorf("begin generation transaction: %w", err)
	}
	defer tx.Rollback()
	if existing, err := getGenerationTx(ctx, tx, input.ClientRequestID); err == nil {
		return existing, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Generation{}, err
	}
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM conversations WHERE id = ?`, input.ConversationID).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return Generation{}, fmt.Errorf("conversation %q: %w", input.ConversationID, sql.ErrNoRows)
	} else if err != nil {
		return Generation{}, fmt.Errorf("check generation conversation: %w", err)
	}
	if err := deriveConversationTitle(ctx, tx, input.ConversationID, input.Body); err != nil {
		return Generation{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO messages (id, conversation_id, role, body, provider_snapshot, created_at) VALUES (?, ?, 'user', ?, NULL, ?)`, messageID, input.ConversationID, input.Body, now.UnixNano()); err != nil {
		return Generation{}, fmt.Errorf("save generation user message: %w", err)
	}
	generation.UserMessageID = messageID
	if _, err := tx.ExecContext(ctx, `INSERT INTO generations (id, conversation_id, client_request_id, user_message_id, state, provider_snapshot, system_prompt, temperature, top_p, max_tokens, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, generation.ID, generation.ConversationID, generation.ClientRequestID, generation.UserMessageID, generation.State, snapshot, generation.ConfigurationSnapshot.SystemPrompt, generation.ConfigurationSnapshot.Temperature, generation.ConfigurationSnapshot.TopP, generation.ConfigurationSnapshot.MaxTokens, now.UnixNano(), now.UnixNano()); err != nil {
		return Generation{}, fmt.Errorf("save generation: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE conversations SET updated_at = ? WHERE id = ?`, now.UnixNano(), input.ConversationID); err != nil {
		return Generation{}, fmt.Errorf("update generation conversation timestamp: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Generation{}, fmt.Errorf("commit generation: %w", err)
	}
	return generation, nil
}

func (store *SQLiteStore) GetGeneration(ctx context.Context, id string) (Generation, error) {
	row := store.db.QueryRowContext(ctx, generationQuery+` WHERE id = ?`, id)
	generation, err := scanGeneration(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Generation{}, fmt.Errorf("generation %q: %w", id, sql.ErrNoRows)
	}
	if err != nil {
		return Generation{}, fmt.Errorf("get generation: %w", err)
	}
	return generation, nil
}

func (store *SQLiteStore) GetGenerationByClientRequestID(ctx context.Context, clientRequestID string) (Generation, error) {
	row := store.db.QueryRowContext(ctx, generationQuery+` WHERE client_request_id = ?`, strings.TrimSpace(clientRequestID))
	generation, err := scanGeneration(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Generation{}, fmt.Errorf("generation request %q: %w", clientRequestID, sql.ErrNoRows)
	}
	if err != nil {
		return Generation{}, fmt.Errorf("get generation by client request ID: %w", err)
	}
	return generation, nil
}

func (store *SQLiteStore) GetGenerationByMessageID(ctx context.Context, messageID string) (Generation, error) {
	row := store.db.QueryRowContext(ctx, generationQuery+` WHERE user_message_id = ? OR assistant_message_id = ?`, messageID, messageID)
	generation, err := scanGeneration(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Generation{}, fmt.Errorf("message %q generation: %w", messageID, sql.ErrNoRows)
	}
	if err != nil {
		return Generation{}, fmt.Errorf("get generation by message ID: %w", err)
	}
	return generation, nil
}

func (store *SQLiteStore) MarkGenerationStreaming(ctx context.Context, id string) error {
	return store.updateGenerationState(ctx, id, GenerationStreaming, "", "")
}

func (store *SQLiteStore) MarkGenerationVerifyingEnvironment(ctx context.Context, id string) error {
	generation, err := store.GetGeneration(ctx, id)
	if err != nil {
		return err
	}
	if !generation.Snapshot.IsNearAI() {
		return errors.New("secure verification requires a NearAI generation")
	}
	if isTerminalGenerationState(generation.State) {
		return nil
	}
	if err := store.updateGenerationState(ctx, id, GenerationVerifyingEnvironment, "", ""); err != nil {
		return err
	}
	return store.updateGenerationVerification(ctx, id, GenerationVerification{Status: VerificationPending, Lanes: pendingVerificationLanes(generation.Snapshot.PrivacyMode)})
}

func (store *SQLiteStore) MarkGenerationVerifyingResponse(ctx context.Context, id string) error {
	generation, err := store.GetGeneration(ctx, id)
	if err != nil {
		return err
	}
	if !generation.Snapshot.IsNearAI() {
		return errors.New("secure verification requires a NearAI generation")
	}
	return store.updateGenerationState(ctx, id, GenerationVerifyingResponse, "", "")
}

// ValidateBrowserSettlement applies the shared limits and receipt contract to
// browser-owned inference. Cryptographic checks remain owned by the browser.
func ValidateBrowserSettlement(input SecureGenerationSettlementInput) error {
	if input.Metrics != nil && input.Metrics.Source != "browser" {
		return errors.New("secure generation metrics must describe browser measurements")
	}
	if err := validateGenerationMetrics(input.Metrics); err != nil {
		return err
	}
	if input.Verification.Status != VerificationModel && input.Verification.Status != VerificationGateway && input.Verification.Status != VerificationFailed && input.Verification.Status != VerificationUnsupported {
		return errors.New("secure generation verification status is invalid")
	}
	if input.Verification.Status == VerificationModel && input.Verification.SignatureKind != "provider_tee" {
		return errors.New("model verification requires a provider_tee signature")
	}
	if input.Verification.Status == VerificationGateway && input.Verification.SignatureKind != "gateway" {
		return errors.New("gateway verification requires a gateway signature")
	}
	if (input.Verification.Status == VerificationModel || input.Verification.Status == VerificationGateway) && (strings.TrimSpace(input.Verification.CompletionID) == "" || strings.TrimSpace(input.Verification.SigningAddress) == "" || strings.TrimSpace(input.Verification.SigningAlgorithm) == "" || strings.TrimSpace(input.Verification.SignatureDigest) == "") {
		return errors.New("secure verification receipt summary is incomplete")
	}
	if (input.Verification.Status == VerificationModel || input.Verification.Status == VerificationGateway) && strings.TrimSpace(input.Body) == "" {
		return errors.New("secure generation body is required")
	}
	return nil
}

func (store *SQLiteStore) SettleSecureGeneration(ctx context.Context, input SecureGenerationSettlementInput) error {
	if strings.TrimSpace(input.GenerationID) == "" {
		return errors.New("generation ID is required")
	}
	if err := ValidateBrowserSettlement(input); err != nil {
		return err
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin secure generation settlement: %w", err)
	}
	defer tx.Rollback()
	generation, err := getGenerationByIDTx(ctx, tx, input.GenerationID)
	if err != nil {
		return fmt.Errorf("load generation for secure settlement: %w", err)
	}
	if !generation.Snapshot.IsNearAI() {
		return errors.New("secure settlement requires a NearAI generation")
	}
	if generation.State == GenerationCompleted || generation.State == GenerationStopped || generation.State == GenerationFailed {
		return nil
	}
	if input.Verification.Status != VerificationFailed && input.Verification.Status != VerificationUnsupported && generation.State != GenerationVerifyingResponse {
		return errors.New("secure generation must verify its response before settlement")
	}
	if input.Verification.VerifiedAt == nil && (input.Verification.Status == VerificationModel || input.Verification.Status == VerificationGateway) {
		now := time.Now().UTC()
		input.Verification.VerifiedAt = &now
	}
	normalizeVerificationLanes(&input.Verification, generation.Snapshot.PrivacyMode)
	verification, err := json.Marshal(input.Verification)
	if err != nil {
		return fmt.Errorf("encode secure generation verification: %w", err)
	}
	now := time.Now().UTC()
	state := GenerationCompleted
	errorCode, errorMessage := "", ""
	if input.Verification.Status == VerificationUnsupported || (input.Verification.Status == VerificationFailed && !persistSecureAssistantBody(input, generation.Snapshot.PrivacyMode)) {
		state = GenerationFailed
		errorCode = input.Verification.FailureCode
		if errorCode == "" {
			errorCode = "verification_failed"
		}
		errorMessage = input.Verification.EvidenceSummary
	} else if input.Verification.Status == VerificationFailed {
		errorCode = input.Verification.FailureCode
		if errorCode == "" {
			errorCode = "verification_failed"
		}
		errorMessage = input.Verification.EvidenceSummary
	}
	assistantID := ""
	if persistSecureAssistantBody(input, generation.Snapshot.PrivacyMode) {
		assistantID, err = newID()
		if err != nil {
			return fmt.Errorf("create secure assistant message ID: %w", err)
		}
		snapshot, marshalErr := json.Marshal(generation.Snapshot)
		if marshalErr != nil {
			return fmt.Errorf("encode secure assistant provider snapshot: %w", marshalErr)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO messages (id, conversation_id, role, body, provider_snapshot, created_at, reasoning) VALUES (?, ?, 'assistant', ?, ?, ?, ?)`, assistantID, generation.ConversationID, input.Body, snapshot, now.UnixNano(), input.Reasoning); err != nil {
			return fmt.Errorf("save secure assistant message: %w", err)
		}
	}
	if assistantID != "" {
		if err := attachWebSourcesTx(ctx, tx, input.GenerationID, assistantID, input.Body); err != nil {
			return err
		}
	}
	metrics, _ := json.Marshal(input.Metrics)
	if _, err := tx.ExecContext(ctx, `UPDATE generations SET state = ?, verification_snapshot = ?, assistant_message_id = NULLIF(?, ''), error_code = NULLIF(?, ''), error_message = NULLIF(?, ''), updated_at = ?, metrics = ? WHERE id = ?`, state, string(verification), assistantID, errorCode, errorMessage, now.UnixNano(), string(metrics), input.GenerationID); err != nil {
		return fmt.Errorf("settle secure generation: %w", err)
	}
	if assistantID != "" {
		if _, err := tx.ExecContext(ctx, `UPDATE conversations SET updated_at = ? WHERE id = ?`, now.UnixNano(), generation.ConversationID); err != nil {
			return fmt.Errorf("update secure conversation timestamp: %w", err)
		}
	}
	if err := refreshGenerationBatchTx(ctx, tx, generation.GenerationBatchID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit secure generation settlement: %w", err)
	}
	return nil
}

func validGenerationTransition(from, to GenerationState) bool {
	if from == to {
		return true
	}
	switch from {
	case GenerationPending:
		return to == GenerationVerifyingEnvironment || to == GenerationStreaming || to == GenerationStopped || to == GenerationFailed
	case GenerationVerifyingEnvironment:
		return to == GenerationStreaming || to == GenerationStopped || to == GenerationFailed
	case GenerationStreaming:
		return to == GenerationVerifyingResponse || to == GenerationStopped || to == GenerationFailed
	case GenerationVerifyingResponse:
		return to == GenerationStopped || to == GenerationFailed
	default:
		return false
	}
}

func (store *SQLiteStore) CompleteGeneration(ctx context.Context, input CompleteGenerationInput) error {
	if input.Metrics != nil && input.Metrics.Source != "service" {
		return errors.New("ordinary generation metrics must describe Local Service measurements")
	}
	if err := validateGenerationMetrics(input.Metrics); err != nil {
		return err
	}
	if strings.TrimSpace(input.Body) == "" {
		return errors.New("completed generation body is required")
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin complete generation: %w", err)
	}
	defer tx.Rollback()
	generation, err := getGenerationByIDTx(ctx, tx, input.GenerationID)
	if err != nil {
		return fmt.Errorf("load generation for completion: %w", err)
	}
	if generation.State != GenerationStreaming && generation.State != GenerationPending {
		return nil
	}
	messageID, err := newID()
	if err != nil {
		return fmt.Errorf("create assistant message ID: %w", err)
	}
	snapshot, err := json.Marshal(generation.Snapshot)
	if err != nil {
		return fmt.Errorf("encode assistant provider snapshot: %w", err)
	}
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `INSERT INTO messages (id, conversation_id, role, body, provider_snapshot, created_at, reasoning) VALUES (?, ?, 'assistant', ?, ?, ?, ?)`, messageID, generation.ConversationID, input.Body, snapshot, now.UnixNano(), input.Reasoning); err != nil {
		return fmt.Errorf("save assistant message: %w", err)
	}
	if err := attachWebSourcesTx(ctx, tx, input.GenerationID, messageID, input.Body); err != nil {
		return err
	}
	metrics, _ := json.Marshal(input.Metrics)
	if _, err := tx.ExecContext(ctx, `UPDATE generations SET state = ?, assistant_message_id = ?, updated_at = ?, metrics = ? WHERE id = ?`, GenerationCompleted, messageID, now.UnixNano(), string(metrics), input.GenerationID); err != nil {
		return fmt.Errorf("complete generation state: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE conversations SET updated_at = ? WHERE id = ?`, now.UnixNano(), generation.ConversationID); err != nil {
		return fmt.Errorf("update completed conversation timestamp: %w", err)
	}
	if err := refreshGenerationBatchTx(ctx, tx, generation.GenerationBatchID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit completed generation: %w", err)
	}
	return nil
}

func (store *SQLiteStore) TerminateGeneration(ctx context.Context, input TerminateGenerationInput) error {
	if input.State != GenerationStopped && input.State != GenerationFailed {
		return errors.New("generation terminal state must be stopped or failed")
	}
	return store.updateGenerationState(ctx, input.GenerationID, input.State, input.ErrorCode, input.ErrorMessage)
}

func (store *SQLiteStore) RecoverInterruptedGenerations(ctx context.Context) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin interrupted generation recovery: %w", err)
	}
	defer tx.Rollback()
	now := time.Now().UTC().UnixNano()
	if _, err := tx.ExecContext(ctx, `UPDATE generations SET state = ?, error_code = ?, error_message = ?, updated_at = ? WHERE state IN (?, ?, ?, ?)`, GenerationFailed, "interrupted", "The Local Service restarted before this Generation completed.", now, GenerationPending, GenerationVerifyingEnvironment, GenerationStreaming, GenerationVerifyingResponse); err != nil {
		return fmt.Errorf("recover interrupted generations: %w", err)
	}
	rows, err := tx.QueryContext(ctx, `SELECT DISTINCT generation_batch_id FROM generations WHERE generation_batch_id IS NOT NULL AND generation_batch_id != '' AND error_code = 'interrupted'`)
	if err != nil {
		return fmt.Errorf("list interrupted generation batches: %w", err)
	}
	batchIDs := make([]string, 0)
	for rows.Next() {
		var batchID string
		if err := rows.Scan(&batchID); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan interrupted generation batch: %w", err)
		}
		batchIDs = append(batchIDs, batchID)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate interrupted generation batches: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close interrupted generation batches: %w", err)
	}
	for _, batchID := range batchIDs {
		if err := refreshGenerationBatchTx(ctx, tx, batchID); err != nil {
			return fmt.Errorf("refresh interrupted generation batch: %w", err)
		}
	}
	if err := recoverDebatesTx(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}

const generationQuery = `SELECT id, conversation_id, client_request_id, user_message_id, state, provider_snapshot, system_prompt, temperature, top_p, max_tokens, verification_snapshot, assistant_message_id, error_code, error_message, created_at, updated_at, generation_batch_id, generation_target_id, metrics, web_search_policy, web_search_info FROM generations`

func getGenerationTx(ctx context.Context, tx *sql.Tx, clientRequestID string) (Generation, error) {
	return scanGeneration(tx.QueryRowContext(ctx, generationQuery+` WHERE client_request_id = ?`, clientRequestID))
}

func scanGeneration(row rowScanner) (Generation, error) {
	var generation Generation
	var snapshot string
	var userMessageID string
	var verificationSnapshot string
	var metrics string
	var webPolicy, webInfo string
	var assistantID, errorCode, errorMessage, batchID, targetID sql.NullString
	var temperature, topP sql.NullFloat64
	var maxTokens sql.NullInt64
	var state string
	var createdAt, updatedAt int64
	if err := row.Scan(&generation.ID, &generation.ConversationID, &generation.ClientRequestID, &userMessageID, &state, &snapshot, &generation.ConfigurationSnapshot.SystemPrompt, &temperature, &topP, &maxTokens, &verificationSnapshot, &assistantID, &errorCode, &errorMessage, &createdAt, &updatedAt, &batchID, &targetID, &metrics, &webPolicy, &webInfo); err != nil {
		return Generation{}, err
	}
	if webPolicy != "" {
		if err := json.Unmarshal([]byte(webPolicy), &generation.ConfigurationSnapshot.WebSearch); err != nil {
			return Generation{}, err
		}
	}
	if webInfo != "{}" {
		if err := json.Unmarshal([]byte(webInfo), &generation.WebSearch); err != nil {
			return Generation{}, err
		}
	}
	if metrics != "{}" && metrics != "null" {
		if err := json.Unmarshal([]byte(metrics), &generation.Metrics); err != nil {
			return Generation{}, fmt.Errorf("decode generation metrics: %w", err)
		}
	}
	if err := json.Unmarshal([]byte(snapshot), &generation.Snapshot); err != nil {
		return Generation{}, fmt.Errorf("decode generation provider snapshot: %w", err)
	}
	if temperature.Valid {
		generation.ConfigurationSnapshot.Temperature = &temperature.Float64
	}
	if topP.Valid {
		generation.ConfigurationSnapshot.TopP = &topP.Float64
	}
	if maxTokens.Valid {
		value := int(maxTokens.Int64)
		generation.ConfigurationSnapshot.MaxTokens = &value
	}
	if strings.TrimSpace(verificationSnapshot) != "" && verificationSnapshot != "{}" {
		if err := json.Unmarshal([]byte(verificationSnapshot), &generation.Verification); err != nil {
			return Generation{}, fmt.Errorf("decode generation verification snapshot: %w", err)
		}
	}
	if generation.Verification.Status == "" {
		if generation.Snapshot.IsNearAI() {
			generation.Verification.Status = VerificationPending
		} else {
			generation.Verification.Status = VerificationUnsupported
		}
	}
	generation.State = GenerationState(state)
	if generation.WebSearch != nil && isTerminalGenerationState(generation.State) {
		for i := range generation.WebSearch.Steps {
			if generation.WebSearch.Steps[i].Status == "running" {
				generation.WebSearch.Steps[i].Status = "stopped"
				generation.WebSearch.Steps[i].Error = "The Generation ended before this tool completed."
			}
		}
	}
	generation.UserMessageID = userMessageID
	generation.AssistantMessageID = assistantID.String
	generation.GenerationBatchID = batchID.String
	generation.GenerationTargetID = targetID.String
	generation.ErrorCode = errorCode.String
	generation.ErrorMessage = errorMessage.String
	generation.CreatedAt = time.Unix(0, createdAt).UTC()
	generation.UpdatedAt = time.Unix(0, updatedAt).UTC()
	return generation, nil
}

func (store *SQLiteStore) updateGenerationState(ctx context.Context, id string, state GenerationState, errorCode, errorMessage string) error {
	if id == "" {
		return errors.New("generation ID is required")
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin generation state update: %w", err)
	}
	defer tx.Rollback()
	generation, err := getGenerationByIDTx(ctx, tx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("generation %q: %w", id, sql.ErrNoRows)
	}
	if err != nil {
		return fmt.Errorf("load generation state: %w", err)
	}
	if generation.State == GenerationCompleted || generation.State == GenerationStopped || generation.State == GenerationFailed {
		return nil
	}
	if !validGenerationTransition(generation.State, state) {
		return fmt.Errorf("generation cannot transition from %s to %s", generation.State, state)
	}
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `UPDATE generations SET state = ?, error_code = NULLIF(?, ''), error_message = NULLIF(?, ''), updated_at = ? WHERE id = ?`, state, errorCode, errorMessage, now.UnixNano(), id); err != nil {
		return fmt.Errorf("update generation state: %w", err)
	}
	if err := refreshGenerationBatchTx(ctx, tx, generation.GenerationBatchID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit generation state: %w", err)
	}
	return nil
}

func (store *SQLiteStore) updateGenerationVerification(ctx context.Context, id string, verification GenerationVerification) error {
	payload, err := json.Marshal(verification)
	if err != nil {
		return fmt.Errorf("encode generation verification: %w", err)
	}
	now := time.Now().UTC().UnixNano()
	result, err := store.db.ExecContext(ctx, `UPDATE generations SET verification_snapshot = ?, updated_at = ? WHERE id = ?`, string(payload), now, id)
	if err != nil {
		return fmt.Errorf("update generation verification: %w", err)
	}
	if count, err := result.RowsAffected(); err != nil || count != 1 {
		return fmt.Errorf("update generation verification: %w", sql.ErrNoRows)
	}
	return nil
}

func getGenerationByIDTx(ctx context.Context, tx *sql.Tx, id string) (Generation, error) {
	return scanGeneration(tx.QueryRowContext(ctx, generationQuery+` WHERE id = ?`, id))
}

func (store *SQLiteStore) AddMessage(ctx context.Context, conversationID string, input MessageInput) (Message, error) {
	input.Role = strings.TrimSpace(input.Role)
	if input.Role != "user" && input.Role != "assistant" {
		return Message{}, errors.New("message role must be user or assistant")
	}
	if strings.TrimSpace(input.Body) == "" {
		return Message{}, errors.New("message body is required")
	}
	now := time.Now().UTC()
	id, err := newID()
	if err != nil {
		return Message{}, fmt.Errorf("add message ID: %w", err)
	}
	message := Message{ID: id, ConversationID: conversationID, Role: input.Role, Body: input.Body, CreatedAt: now}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return Message{}, fmt.Errorf("begin add message: %w", err)
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM conversations WHERE id = ?`, conversationID).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return Message{}, fmt.Errorf("conversation %q: %w", conversationID, sql.ErrNoRows)
	} else if err != nil {
		return Message{}, fmt.Errorf("check conversation: %w", err)
	}
	if input.Role == "user" {
		if err := deriveConversationTitle(ctx, tx, conversationID, input.Body); err != nil {
			return Message{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO messages (id, conversation_id, role, body, created_at) VALUES (?, ?, ?, ?, ?)`, message.ID, message.ConversationID, message.Role, message.Body, now.UnixNano()); err != nil {
		return Message{}, fmt.Errorf("add message: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE conversations SET updated_at = ? WHERE id = ?`, now.UnixNano(), conversationID); err != nil {
		return Message{}, fmt.Errorf("update conversation timestamp: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Message{}, fmt.Errorf("commit message: %w", err)
	}
	return message, nil
}

func (store *SQLiteStore) RenameConversation(ctx context.Context, id, title string) error {
	title = strings.TrimSpace(title)
	if title == "" {
		return errors.New("conversation title is required")
	}
	result, err := store.db.ExecContext(ctx, `UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`, title, time.Now().UTC().UnixNano(), id)
	if err != nil {
		return fmt.Errorf("rename conversation: %w", err)
	}
	if count, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("check renamed conversation: %w", err)
	} else if count == 0 {
		return fmt.Errorf("conversation %q: %w", id, sql.ErrNoRows)
	}
	return nil
}

// SetConversationPinned changes only navigation priority. It deliberately does
// not change updated_at, which remains the time of the latest conversation activity.
func (store *SQLiteStore) SetConversationPinned(ctx context.Context, id string, pinned bool) error {
	var pinnedAt any
	if pinned {
		pinnedAt = time.Now().UTC().UnixNano()
	}
	return store.updateConversationState(ctx, `pinned_at = ?`, pinnedAt, id)
}

// SetConversationArchived keeps the Conversation History locally while moving
// it out of the active conversation list.
func (store *SQLiteStore) SetConversationArchived(ctx context.Context, id string, archived bool) error {
	var archivedAt any
	if archived {
		archivedAt = time.Now().UTC().UnixNano()
	}
	return store.updateConversationState(ctx, `archived_at = ?`, archivedAt, id)
}

func (store *SQLiteStore) updateConversationState(ctx context.Context, assignment string, value any, id string) error {
	result, err := store.db.ExecContext(ctx, `UPDATE conversations SET `+assignment+` WHERE id = ?`, value, id)
	if err != nil {
		return fmt.Errorf("update conversation state: %w", err)
	}
	if count, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("check updated conversation: %w", err)
	} else if count == 0 {
		return fmt.Errorf("conversation %q: %w", id, sql.ErrNoRows)
	}
	return nil
}

func deriveConversationTitle(ctx context.Context, tx *sql.Tx, conversationID, body string) error {
	var userMessageCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND role = 'user'`, conversationID).Scan(&userMessageCount); err != nil {
		return fmt.Errorf("count conversation user messages: %w", err)
	}
	if userMessageCount > 0 {
		return nil
	}
	title := conversationTitleFromMessage(body)
	if title == "" {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `UPDATE conversations SET title = ? WHERE id = ? AND title = ?`, title, conversationID, defaultConversationTitle); err != nil {
		return fmt.Errorf("derive conversation title: %w", err)
	}
	return nil
}

func conversationTitleFromMessage(body string) string {
	title := strings.Join(strings.Fields(body), " ")
	runes := []rune(title)
	const maxTitleRunes = 80
	if len(runes) > maxTitleRunes {
		return string(runes[:maxTitleRunes-1]) + "…"
	}
	return title
}

func (store *SQLiteStore) ListProviderProfiles(ctx context.Context) ([]ProviderProfile, error) {
	rows, err := store.db.QueryContext(ctx, `SELECT id, kind, name, endpoint, model_id, auth_method, created_at, updated_at, credential_ref FROM provider_profiles ORDER BY updated_at DESC, id ASC`)
	if err != nil {
		return nil, fmt.Errorf("list provider profiles: %w", err)
	}
	defer rows.Close()
	profiles := make([]ProviderProfile, 0)
	for rows.Next() {
		profile, err := scanProviderProfile(rows)
		if err != nil {
			return nil, fmt.Errorf("scan provider profile: %w", err)
		}
		profiles = append(profiles, profile)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate provider profiles: %w", err)
	}
	return profiles, nil
}

func (store *SQLiteStore) GetProviderProfile(ctx context.Context, id string) (ProviderProfile, error) {
	row := store.db.QueryRowContext(ctx, `SELECT id, kind, name, endpoint, model_id, auth_method, created_at, updated_at, credential_ref FROM provider_profiles WHERE id = ?`, id)
	profile, err := scanProviderProfile(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ProviderProfile{}, fmt.Errorf("provider profile %q: %w", id, sql.ErrNoRows)
	}
	if err != nil {
		return ProviderProfile{}, fmt.Errorf("get provider profile: %w", err)
	}
	return profile, nil
}

var ErrProviderProfileChanged = errors.New("provider profile changed")

func (store *SQLiteStore) UpsertProviderProfile(ctx context.Context, profile ProviderProfile, expected ...time.Time) error {
	if strings.TrimSpace(profile.ID) == "" || strings.TrimSpace(profile.Kind) == "" || strings.TrimSpace(profile.Endpoint) == "" || strings.TrimSpace(profile.AuthMethod) == "" {
		return errors.New("provider profile identity and connection settings are required")
	}
	profile.Name = strings.TrimSpace(profile.Name)
	if profile.Name == "" {
		return errors.New("provider profile name is required")
	}
	now := time.Now().UTC()
	if profile.CreatedAt.IsZero() {
		profile.CreatedAt = now
	}
	if len(expected) != 0 && !now.After(expected[0]) {
		now = expected[0].Add(time.Nanosecond)
	}
	var revision any
	if len(expected) != 0 {
		revision = int64(0)
		if !expected[0].IsZero() {
			revision = expected[0].UnixNano()
		}
	}
	result, err := store.db.ExecContext(ctx, `
INSERT INTO provider_profiles (id, kind, name, endpoint, model_id, auth_method, created_at, updated_at, credential_ref)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
WHERE ? IS NULL OR ? = 0 OR EXISTS (SELECT 1 FROM provider_profiles WHERE id = ? AND updated_at = ?)
ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, name=excluded.name, endpoint=excluded.endpoint, model_id=excluded.model_id, auth_method=excluded.auth_method, updated_at=excluded.updated_at, credential_ref=excluded.credential_ref
WHERE ? IS NULL OR provider_profiles.updated_at = ?`,
		profile.ID, profile.Kind, profile.Name, profile.Endpoint, profile.ModelID, profile.AuthMethod, profile.CreatedAt.UTC().UnixNano(), now.UnixNano(), profile.CredentialRef,
		revision, revision, profile.ID, revision, revision, revision)
	if err != nil {
		return fmt.Errorf("save provider profile: %w", err)
	}
	if count, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("check saved provider profile: %w", err)
	} else if count != 1 {
		return ErrProviderProfileChanged
	}
	return nil
}

func (store *SQLiteStore) DeleteProviderProfile(ctx context.Context, id string, expected ...time.Time) error {
	var revision any
	if len(expected) != 0 {
		revision = expected[0].UnixNano()
	}
	result, err := store.db.ExecContext(ctx, `DELETE FROM provider_profiles WHERE id = ? AND (? IS NULL OR updated_at = ?)`, id, revision, revision)
	if err != nil {
		return fmt.Errorf("delete provider profile: %w", err)
	}
	if count, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("check deleted provider profile: %w", err)
	} else if count == 0 {
		if revision != nil {
			return ErrProviderProfileChanged
		}
		return fmt.Errorf("provider profile %q: %w", id, sql.ErrNoRows)
	}
	return nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

const conversationSelect = `SELECT id, title, CASE WHEN pinned_at IS NULL THEN 0 ELSE 1 END, CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END, created_at, updated_at, COALESCE((SELECT id FROM debate_sessions WHERE id=conversations.id),''), COALESCE((SELECT status FROM debate_sessions WHERE id=conversations.id),''), COALESCE((SELECT json_extract(record,'$.round') FROM debate_sessions WHERE id=conversations.id),0), COALESCE(project_id,''), membership_revision, COALESCE((SELECT revision FROM projects WHERE id=conversations.project_id),0) FROM conversations`

func scanConversation(row rowScanner) (Conversation, error) {
	var conversation Conversation
	var pinned, archived int
	var createdAt, updatedAt int64
	if err := row.Scan(&conversation.ID, &conversation.Title, &pinned, &archived, &createdAt, &updatedAt, &conversation.DebateID, &conversation.DebateStatus, &conversation.DebateRound, &conversation.ProjectID, &conversation.MembershipRevision, &conversation.ProjectRevision); err != nil {
		return Conversation{}, err
	}
	conversation.Pinned = pinned != 0
	conversation.Archived = archived != 0
	conversation.CreatedAt = time.Unix(0, createdAt).UTC()
	conversation.UpdatedAt = time.Unix(0, updatedAt).UTC()
	return conversation, nil
}

func scanProviderProfile(row rowScanner) (ProviderProfile, error) {
	var profile ProviderProfile
	var createdAt, updatedAt int64
	if err := row.Scan(&profile.ID, &profile.Kind, &profile.Name, &profile.Endpoint, &profile.ModelID, &profile.AuthMethod, &createdAt, &updatedAt, &profile.CredentialRef); err != nil {
		return ProviderProfile{}, err
	}
	profile.CreatedAt = time.Unix(0, createdAt).UTC()
	profile.UpdatedAt = time.Unix(0, updatedAt).UTC()
	return profile, nil
}

func readPragmaInt(db *sql.DB, name string) (int, error) {
	var value int
	if err := db.QueryRow("PRAGMA " + name).Scan(&value); err != nil {
		return 0, err
	}
	return value, nil
}

func newID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s", fmt.Sprintf("%x", bytes[0:4]), fmt.Sprintf("%x", bytes[4:6]), fmt.Sprintf("%x", bytes[6:8]), fmt.Sprintf("%x", bytes[8:10]), fmt.Sprintf("%x", bytes[10:16])), nil
}

var _ ChatStore = (*SQLiteStore)(nil)
var _ ProviderStore = (*SQLiteStore)(nil)
var _ SettingsStore = (*SQLiteStore)(nil)

func pendingVerificationLanes(privacyMode string) *VerificationLanes {
	lanes := VerificationLanes{Gateway: VerificationLanePending, Response: VerificationLanePending}
	if privacyMode == "private_tee" {
		lanes.Model = VerificationLanePending
	}
	return &lanes
}

func normalizeVerificationLanes(verification *GenerationVerification, privacyMode string) {
	if verification == nil {
		return
	}
	if verification.Lanes != nil && verification.Lanes.Gateway != "" && verification.Lanes.Response != "" {
		return
	}
	lanes := *pendingVerificationLanes(privacyMode)
	switch verification.Status {
	case VerificationModel:
		if verification.SignatureKind == "provider_tee" {
			lanes.Gateway = VerificationLaneVerified
			lanes.Model = VerificationLaneVerified
			lanes.Response = VerificationLaneVerified
		}
	case VerificationGateway:
		if verification.SignatureKind == "gateway" {
			lanes.Gateway = VerificationLaneVerified
			lanes.Response = VerificationLaneVerified
			if privacyMode == "private_tee" {
				lanes.Model = VerificationLaneFailed
			}
		}
	case VerificationFailed, VerificationUnsupported:
		switch verification.FailureCode {
		case "environment_verification_failed", "gateway_verification_failed":
			lanes.Gateway = VerificationLaneFailed
			lanes.Response = VerificationLaneFailed
			if privacyMode == "private_tee" {
				lanes.Model = VerificationLaneFailed
			}
		case "response_verification_failed", "timeout", "verification_stopped", "stream_failed":
			lanes.Gateway = VerificationLaneVerified
			lanes.Response = VerificationLaneFailed
			if privacyMode == "private_tee" {
				lanes.Model = VerificationLaneFailed
			}
		default:
			lanes.Gateway = VerificationLaneFailed
			lanes.Response = VerificationLaneFailed
			if privacyMode == "private_tee" {
				lanes.Model = VerificationLaneFailed
			}
		}
		if verification.Status == VerificationUnsupported && privacyMode == "private_tee" {
			lanes.Model = VerificationLaneFailed
		}
	}
	verification.Lanes = &lanes
}

func persistSecureAssistantBody(input SecureGenerationSettlementInput, privacyMode string) bool {
	if strings.TrimSpace(input.Body) == "" {
		return false
	}
	switch input.Verification.Status {
	case VerificationModel, VerificationGateway:
		return true
	case VerificationFailed:
		if privacyMode == "private_tee" {
			return false
		}
		if privacyMode == "incognito" || privacyMode == "chutes" {
			return true
		}
		return input.Verification.FailureCode == "response_verification_failed" || input.Verification.FailureCode == "gateway_verification_failed"
	default:
		return false
	}
}
