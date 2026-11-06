package persistence

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestSQLiteStoreMigratesAndPreservesConversationHistoryAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cove.sqlite")
	ctx := context.Background()

	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}

	conversation, err := store.CreateConversation(ctx, "First conversation")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	message, err := store.AddMessage(ctx, conversation.ID, MessageInput{Role: "user", Body: "Hello locally"})
	if err != nil {
		t.Fatalf("add message: %v", err)
	}
	if message.ID == "" || message.CreatedAt.IsZero() {
		t.Fatalf("message = %#v, want generated identity and timestamp", message)
	}
	if len(conversation.ID) != 36 || conversation.ID[8] != '-' || len(message.ID) != 36 || message.ID[8] != '-' {
		t.Fatalf("IDs = conversation %q, message %q; want UUID-shaped identifiers", conversation.ID, message.ID)
	}
	if err := store.RenameConversation(ctx, conversation.ID, "Renamed locally"); err != nil {
		t.Fatalf("rename conversation: %v", err)
	}

	if got := pragmaInt(t, store.db, "user_version"); got != 13 {
		t.Fatalf("schema version = %d, want 13", got)
	}
	if got := pragmaInt(t, store.db, "foreign_keys"); got != 1 {
		t.Fatalf("foreign_keys = %d, want 1", got)
	}
	if got := pragmaString(t, store.db, "journal_mode"); got != "wal" {
		t.Fatalf("journal_mode = %q, want wal", got)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close SQLite store: %v", err)
	}

	reopened, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("reopen SQLite store: %v", err)
	}
	defer reopened.Close()

	loaded, err := reopened.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("load conversation after restart: %v", err)
	}
	if loaded.Title != "Renamed locally" || len(loaded.Messages) != 1 || loaded.Messages[0].Body != "Hello locally" {
		t.Fatalf("loaded conversation = %#v, want renamed conversation with one message", loaded)
	}
}

func TestSQLiteStorePersistsProviderProfileWithoutASecret(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cove.sqlite")
	ctx := context.Background()
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	profile := ProviderProfile{
		ID:         "provider-1",
		Kind:       "openai_compatible",
		Name:       "Fixture Provider",
		Endpoint:   "https://provider.example/v1",
		ModelID:    "model-a",
		AuthMethod: "bearer",
	}
	if err := store.UpsertProviderProfile(ctx, profile); err != nil {
		t.Fatalf("save provider profile: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close SQLite store: %v", err)
	}

	reopened, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("reopen SQLite store: %v", err)
	}
	defer reopened.Close()
	loaded, err := reopened.GetProviderProfile(ctx, profile.ID)
	if err != nil {
		t.Fatalf("load provider profile: %v", err)
	}
	if loaded.Endpoint != profile.Endpoint || loaded.ModelID != profile.ModelID || loaded.AuthMethod != profile.AuthMethod {
		t.Fatalf("loaded provider profile = %#v, want %#v", loaded, profile)
	}
	if got := pragmaInt(t, reopened.db, "user_version"); got != 13 {
		t.Fatalf("schema version = %d, want 13", got)
	}

	var columns string
	rows, err := reopened.db.Query(`SELECT name FROM pragma_table_info('provider_profiles') ORDER BY name`)
	if err != nil {
		t.Fatalf("inspect provider profile columns: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan provider profile column: %v", err)
		}
		columns += name + " "
	}
	if columns == "" || strings.Contains(columns, "secret") || strings.Contains(columns, "key") {
		t.Fatalf("provider profile columns = %q, must not contain secret storage", columns)
	}
}

func TestSQLiteStorePersistsGenerationStateAndProviderSnapshot(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Generation")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	snapshot := ProviderSnapshot{
		ProviderID:        "provider-1",
		ProviderName:      "Fixture Provider",
		ModelID:           "model-a",
		RuntimeLocation:   "User configured cloud provider",
		Destination:       "provider.example",
		TransportSecurity: "tls",
		PrivacyNotice:     "Conversation content is sent to the configured Provider over HTTPS/TLS.",
	}
	generation, err := store.BeginGeneration(ctx, BeginGenerationInput{
		ConversationID:  conversation.ID,
		ClientRequestID: "request-1",
		Body:            "Hello provider",
		Snapshot:        snapshot,
	})
	if err != nil {
		t.Fatalf("begin generation: %v", err)
	}
	if generation.State != GenerationPending || generation.ClientRequestID != "request-1" || generation.Snapshot != snapshot {
		t.Fatalf("started generation = %#v, want pending generation with snapshot", generation)
	}
	if _, err := store.BeginGeneration(ctx, BeginGenerationInput{
		ConversationID:  conversation.ID,
		ClientRequestID: "request-1",
		Body:            "duplicate body",
		Snapshot:        snapshot,
	}); err != nil {
		t.Fatalf("repeat idempotent generation: %v", err)
	} else if duplicate, err := store.GetGenerationByClientRequestID(ctx, "request-1"); err != nil || duplicate.ID != generation.ID {
		t.Fatalf("idempotent generation = %#v, %v; want original generation", duplicate, err)
	}
	if err := store.MarkGenerationStreaming(ctx, generation.ID); err != nil {
		t.Fatalf("mark generation streaming: %v", err)
	}
	if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: generation.ID, Body: "Hello from provider"}); err != nil {
		t.Fatalf("complete generation: %v", err)
	}
	completed, err := store.GetGeneration(ctx, generation.ID)
	if err != nil {
		t.Fatalf("load completed generation: %v", err)
	}
	if completed.State != GenerationCompleted || completed.AssistantMessageID == "" {
		t.Fatalf("completed generation = %#v, want completed assistant message", completed)
	}
	view, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("load conversation: %v", err)
	}
	if len(view.Messages) != 2 || view.Messages[1].Body != "Hello from provider" || view.Messages[1].ProviderSnapshot == nil || *view.Messages[1].ProviderSnapshot != snapshot {
		t.Fatalf("conversation messages = %#v, want assistant body and immutable snapshot", view.Messages)
	}
}

func TestSQLiteStoreCreatesOneUserMessageAndIndependentTargetsForAModelComparisonBatch(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Comparison")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	temperature, topP, maxTokens := 0.2, 0.9, 1024
	batch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID:       conversation.ID,
		ClientRequestID:      "comparison-request-1",
		Body:                 "Compare this prompt",
		SystemPrompt:         "Use the original instructions.",
		GenerationParameters: GenerationParameters{Temperature: &temperature, TopP: &topP, MaxTokens: &maxTokens},
		Targets: []GenerationTargetInput{
			{ProviderID: "provider-a", ModelID: "model-a", Snapshot: ProviderSnapshot{ProviderID: "provider-a", ProviderName: "Provider A", ModelID: "model-a"}},
			{ProviderID: "provider-b", ModelID: "model-b", Snapshot: ProviderSnapshot{ProviderID: "provider-b", ProviderName: "Provider B", ModelID: "model-b"}},
		},
	})
	if err != nil {
		t.Fatalf("begin comparison batch: %v", err)
	}
	if batch.State != GenerationBatchPending || len(batch.Targets) != 2 || batch.Targets[0].Position != 0 || batch.Targets[1].Position != 1 {
		t.Fatalf("batch = %#v, want pending ordered two-target batch", batch)
	}
	if batch.Targets[0].Generation.UserMessageID == "" || batch.Targets[0].Generation.UserMessageID != batch.Targets[1].Generation.UserMessageID {
		t.Fatalf("targets = %#v, want one shared user message", batch.Targets)
	}
	if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: batch.Targets[0].Generation.ID, Body: "Answer A"}); err != nil {
		t.Fatalf("complete first target: %v", err)
	}
	loaded, err := store.GetGenerationBatch(ctx, batch.ID)
	if err != nil {
		t.Fatalf("load comparison batch: %v", err)
	}
	if loaded.SystemPrompt != "Use the original instructions." || loaded.GenerationParameters.Temperature == nil || *loaded.GenerationParameters.Temperature != temperature || loaded.GenerationParameters.TopP == nil || *loaded.GenerationParameters.TopP != topP || loaded.GenerationParameters.MaxTokens == nil || *loaded.GenerationParameters.MaxTokens != maxTokens || loaded.Targets[0].Generation.State != GenerationCompleted || loaded.Targets[1].Generation.State != GenerationPending || loaded.State != GenerationBatchPending {
		t.Fatalf("loaded batch = %#v, want completed first target and pending second target", loaded)
	}
}

func TestSQLiteStoreFreezesABatchDispositionWhenALaterBatchCapturesItsContext(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Frozen context")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	first, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID: conversation.ID, ClientRequestID: "frozen-context-1", Body: "First",
		Targets: []GenerationTargetInput{
			{ProviderID: "provider-a", ModelID: "model-a", Snapshot: ProviderSnapshot{ProviderID: "provider-a", ModelID: "model-a"}},
			{ProviderID: "provider-b", ModelID: "model-b", Snapshot: ProviderSnapshot{ProviderID: "provider-b", ModelID: "model-b"}},
		},
	})
	if err != nil {
		t.Fatalf("begin first batch: %v", err)
	}
	for _, target := range first.Targets {
		if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: target.Generation.ID, Body: "Completed " + target.ID}); err != nil {
			t.Fatalf("complete first batch target: %v", err)
		}
	}
	if err := store.SelectGenerationAnswer(ctx, first.Targets[0].Generation.ID); err != nil {
		t.Fatalf("select first answer: %v", err)
	}
	if _, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID: conversation.ID, ClientRequestID: "frozen-context-2", Body: "Second",
		Targets: []GenerationTargetInput{{ProviderID: "provider-a", ModelID: "model-a", Snapshot: ProviderSnapshot{ProviderID: "provider-a", ModelID: "model-a"}}},
	}); err != nil {
		t.Fatalf("begin second batch: %v", err)
	}

	frozen, err := store.GetGenerationBatch(ctx, first.ID)
	if err != nil {
		t.Fatalf("load first batch: %v", err)
	}
	if !frozen.ContextFrozen {
		t.Fatalf("first batch = %#v, want frozen disposition", frozen)
	}
	if err := store.SelectGenerationAnswer(ctx, first.Targets[1].Generation.ID); !errors.Is(err, ErrContextDispositionFrozen) {
		t.Fatalf("change frozen answer error = %v, want ErrContextDispositionFrozen", err)
	}
	if err := store.SkipGenerationBatchContext(ctx, first.ID); !errors.Is(err, ErrContextDispositionFrozen) {
		t.Fatalf("skip frozen batch error = %v, want ErrContextDispositionFrozen", err)
	}
	view, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("load conversation: %v", err)
	}
	if len(view.GenerationBatches) != 2 || view.GenerationBatches[0].ID != first.ID {
		t.Fatalf("conversation batches = %#v, want the durable batch history", view.GenerationBatches)
	}
}

func TestSQLiteStoreMakesAnInFlightTargetRetryIdempotent(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Retry idempotency")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	batch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID: conversation.ID, ClientRequestID: "retry-batch-1", Body: "Question",
		Targets: []GenerationTargetInput{{ProviderID: "provider-a", ModelID: "model-a", Snapshot: ProviderSnapshot{ProviderID: "provider-a", ModelID: "model-a"}}},
	})
	if err != nil {
		t.Fatalf("begin batch: %v", err)
	}
	if err := store.TerminateGeneration(ctx, TerminateGenerationInput{GenerationID: batch.Targets[0].Generation.ID, State: GenerationFailed, ErrorCode: "provider_error"}); err != nil {
		t.Fatalf("fail initial attempt: %v", err)
	}
	input := BeginGenerationAttemptInput{TargetID: batch.Targets[0].ID, ClientRequestID: "retry-attempt-1", Snapshot: batch.Targets[0].Generation.Snapshot}
	first, err := store.BeginGenerationAttempt(ctx, input)
	if err != nil {
		t.Fatalf("begin retry: %v", err)
	}
	duplicate, err := store.BeginGenerationAttempt(ctx, input)
	if err != nil {
		t.Fatalf("repeat in-flight retry: %v", err)
	}
	if duplicate.ID != first.ID || duplicate.State != GenerationPending {
		t.Fatalf("idempotent retry = %#v, want pending retry %q", duplicate, first.ID)
	}
}

func TestSQLiteStoreRecoversNonTerminalGenerationsAsInterrupted(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Recovery")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	generation, err := store.BeginGeneration(ctx, BeginGenerationInput{
		ConversationID: conversation.ID, ClientRequestID: "recovery-1", Body: "Hello",
		Snapshot: ProviderSnapshot{ProviderID: "provider-1", ProviderName: "Fixture", ModelID: "model-a"},
	})
	if err != nil {
		t.Fatalf("begin generation: %v", err)
	}
	if err := store.MarkGenerationStreaming(ctx, generation.ID); err != nil {
		t.Fatalf("mark streaming: %v", err)
	}
	if err := store.RecoverInterruptedGenerations(ctx); err != nil {
		t.Fatalf("recover generations: %v", err)
	}
	recovered, err := store.GetGeneration(ctx, generation.ID)
	if err != nil {
		t.Fatalf("load recovered generation: %v", err)
	}
	if recovered.State != GenerationFailed || recovered.ErrorCode != "interrupted" {
		t.Fatalf("recovered generation = %#v, want failed interrupted", recovered)
	}
	view, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("load recovered conversation: %v", err)
	}
	if len(view.Messages) != 1 || view.Messages[0].Role != "user" {
		t.Fatalf("recovered messages = %#v, want only user message", view.Messages)
	}
}

func TestSQLiteStoreRefreshesAnInterruptedGenerationBatchAfterRecovery(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Batch recovery")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	batch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID: conversation.ID, ClientRequestID: "batch-recovery-1", Body: "Hello",
		Targets: []GenerationTargetInput{
			{ProviderID: "provider-a", ModelID: "model-a", Snapshot: ProviderSnapshot{ProviderID: "provider-a", ModelID: "model-a"}},
			{ProviderID: "provider-b", ModelID: "model-b", Snapshot: ProviderSnapshot{ProviderID: "provider-b", ModelID: "model-b"}},
		},
	})
	if err != nil {
		t.Fatalf("begin generation batch: %v", err)
	}
	if err := store.RecoverInterruptedGenerations(ctx); err != nil {
		t.Fatalf("recover generations: %v", err)
	}
	recovered, err := store.GetGenerationBatch(ctx, batch.ID)
	if err != nil {
		t.Fatalf("load recovered generation batch: %v", err)
	}
	if recovered.State != GenerationBatchFailed {
		t.Fatalf("recovered batch state = %q, want %q", recovered.State, GenerationBatchFailed)
	}
}

func TestSQLiteStoreConversationViewExposesOnlyItsActiveGeneration(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Reconnect")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	started, err := store.BeginGeneration(ctx, BeginGenerationInput{
		ConversationID: conversation.ID, ClientRequestID: "reconnect-1", Body: "Hello",
		Snapshot: ProviderSnapshot{ProviderID: "provider-1", ProviderName: "Fixture", ModelID: "model-a"},
	})
	if err != nil {
		t.Fatalf("begin generation: %v", err)
	}
	view, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("load active conversation: %v", err)
	}
	if view.ActiveGeneration == nil || view.ActiveGeneration.ID != started.ID || view.ActiveGeneration.State != GenerationPending {
		t.Fatalf("active generation = %#v, want pending generation", view.ActiveGeneration)
	}
	if err := store.MarkGenerationStreaming(ctx, started.ID); err != nil {
		t.Fatalf("mark generation streaming: %v", err)
	}
	if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: started.ID, Body: "Answer"}); err != nil {
		t.Fatalf("complete generation: %v", err)
	}
	completed, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("load completed conversation: %v", err)
	}
	if completed.ActiveGeneration != nil {
		t.Fatalf("completed active generation = %#v, want nil", completed.ActiveGeneration)
	}
}

func TestSQLiteStoreKeepsGenerationStateTransitionsOneWay(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "State machine")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	generation, err := store.BeginGeneration(ctx, BeginGenerationInput{
		ConversationID: conversation.ID, ClientRequestID: "state-1", Body: "Hello",
		Snapshot: ProviderSnapshot{ProviderID: "provider-1"},
	})
	if err != nil {
		t.Fatalf("begin generation: %v", err)
	}
	if err := store.TerminateGeneration(ctx, TerminateGenerationInput{GenerationID: generation.ID, State: GenerationFailed, ErrorCode: "provider_error"}); err != nil {
		t.Fatalf("terminate pending generation: %v", err)
	}
	if err := store.MarkGenerationStreaming(ctx, generation.ID); err != nil {
		t.Fatalf("mark terminal generation streaming: %v", err)
	}
	if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: generation.ID, Body: "must not persist"}); err != nil {
		t.Fatalf("complete terminal generation: %v", err)
	}
	loaded, err := store.GetGeneration(ctx, generation.ID)
	if err != nil {
		t.Fatalf("load generation: %v", err)
	}
	if loaded.State != GenerationFailed || loaded.AssistantMessageID != "" {
		t.Fatalf("terminal generation = %#v, want failed without assistant message", loaded)
	}
}

func TestSQLiteStoreSettlesSecureGenerationOnlyAfterProviderTEEVerification(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Secure generation")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	batch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID: conversation.ID, ClientRequestID: "secure-request", Body: "Keep this private",
		Targets: []GenerationTargetInput{{ProviderID: "nearai", ModelID: "private-model", Snapshot: ProviderSnapshot{ProviderID: "nearai", ModelID: "private-model"}}},
	})
	if err != nil {
		t.Fatalf("begin secure batch: %v", err)
	}
	generationID := batch.Targets[0].Generation.ID
	if err := store.MarkGenerationVerifyingEnvironment(ctx, generationID); err != nil {
		t.Fatalf("mark environment verification: %v", err)
	}
	if err := store.MarkGenerationStreaming(ctx, generationID); err != nil {
		t.Fatalf("mark streaming: %v", err)
	}
	if err := store.MarkGenerationVerifyingResponse(ctx, generationID); err != nil {
		t.Fatalf("mark response verification: %v", err)
	}
	verifiedAt := time.Now().UTC()
	if err := store.SettleSecureGeneration(ctx, SecureGenerationSettlementInput{
		GenerationID: generationID, Body: "Verified answer",
		Verification: GenerationVerification{Status: VerificationModel, CompletionID: "completion-1", VerifiedAt: &verifiedAt, SignatureKind: "provider_tee", SigningAddress: "nearai-signer", SigningAlgorithm: "ed25519", SignedMessage: "signed-message-fixture", Signature: "signature-fixture", SignatureDigest: "sha256:receipt", EvidenceSummary: "TEE receipt verified", Evidence: &VerificationEvidence{Kind: "model", SignerAddress: "nearai-signer", SigningAlgorithm: "ed25519", TCBStatus: "UpToDate", GPUEvidence: "not_provided", Deployment: map[string]string{"app_compose": "fixture-compose"}, Raw: map[string]interface{}{"quote": "fixture"}, Gateway: &VerificationEvidence{Kind: "gateway", SignerAddress: "gateway-signer", TLSBinding: "none", Raw: map[string]interface{}{"quote": "gateway-quote"}}}},
	}); err != nil {
		t.Fatalf("settle secure generation: %v", err)
	}
	completed, err := store.GetGeneration(ctx, generationID)
	if err != nil {
		t.Fatalf("load settled generation: %v", err)
	}
	if completed.State != GenerationCompleted || completed.AssistantMessageID == "" || completed.Verification.Status != VerificationModel || completed.Verification.SignatureKind != "provider_tee" || completed.Verification.SignedMessage != "signed-message-fixture" || completed.Verification.Signature != "signature-fixture" || completed.Verification.Evidence == nil || completed.Verification.Evidence.TCBStatus != "UpToDate" || completed.Verification.Evidence.Raw["quote"] != "fixture" || completed.Verification.Evidence.Gateway == nil || completed.Verification.Evidence.Gateway.Raw["quote"] != "gateway-quote" {
		t.Fatalf("settled generation = %#v, want verified model with assistant", completed)
	}
	if completed.Verification.Lanes == nil || completed.Verification.Lanes.Gateway != VerificationLaneVerified || completed.Verification.Lanes.Model != VerificationLaneVerified || completed.Verification.Lanes.Response != VerificationLaneVerified {
		t.Fatalf("settled lanes = %#v, want independently stored private TEE lanes", completed.Verification.Lanes)
	}
	view, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("load secure conversation: %v", err)
	}
	if len(view.Messages) != 2 || view.Messages[1].Body != "Verified answer" {
		t.Fatalf("secure conversation messages = %#v, want one verified assistant", view.Messages)
	}
}

func TestSQLiteStoreKeepsGatewayAnswersAndOmitsPrivateTEEFailures(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Secure statuses")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}

	gatewayBatch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID: conversation.ID, ClientRequestID: "gateway-only", Body: "gateway-only",
		Targets: []GenerationTargetInput{{ProviderID: "nearai", ModelID: "openai/gpt-4.1-mini", Snapshot: ProviderSnapshot{ProviderID: "nearai", ModelID: "openai/gpt-4.1-mini", PrivacyMode: "incognito"}}},
	})
	if err != nil {
		t.Fatalf("begin gateway: %v", err)
	}
	gatewayID := gatewayBatch.Targets[0].Generation.ID
	for _, mark := range []func(context.Context, string) error{store.MarkGenerationVerifyingEnvironment, store.MarkGenerationStreaming, store.MarkGenerationVerifyingResponse} {
		if err := mark(ctx, gatewayID); err != nil {
			t.Fatalf("mark gateway: %v", err)
		}
	}
	if err := store.SettleSecureGeneration(ctx, SecureGenerationSettlementInput{
		GenerationID: gatewayID,
		Body:         "gateway answer",
		Verification: GenerationVerification{Status: VerificationGateway, CompletionID: "completion-gateway", SignatureKind: "gateway", SigningAddress: "gateway-signer", SigningAlgorithm: "ed25519", SignatureDigest: "sha256:gateway"},
	}); err != nil {
		t.Fatalf("settle gateway: %v", err)
	}
	gateway, err := store.GetGeneration(ctx, gatewayID)
	if err != nil {
		t.Fatalf("load gateway: %v", err)
	}
	if gateway.State != GenerationCompleted || gateway.AssistantMessageID == "" || gateway.Verification.Status != VerificationGateway {
		t.Fatalf("gateway generation = %#v, want completed assistant with gateway verification", gateway)
	}
	if gateway.Verification.Lanes == nil || gateway.Verification.Lanes.Gateway != VerificationLaneVerified || gateway.Verification.Lanes.Response != VerificationLaneVerified || gateway.Verification.Lanes.Model != "" {
		t.Fatalf("gateway lanes = %#v, want independently stored gateway+response verification", gateway.Verification.Lanes)
	}
	if err := store.SkipGenerationBatchContext(ctx, gatewayBatch.ID); err != nil {
		t.Fatalf("skip gateway batch: %v", err)
	}

	failedBatch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID: conversation.ID, ClientRequestID: "failed-receipt", Body: "failed-receipt",
		Targets: []GenerationTargetInput{{ProviderID: "nearai", ModelID: "private-model", Snapshot: ProviderSnapshot{ProviderID: "nearai", ModelID: "private-model", PrivacyMode: "private_tee"}}},
	})
	if err != nil {
		t.Fatalf("begin failed: %v", err)
	}
	failedID := failedBatch.Targets[0].Generation.ID
	for _, mark := range []func(context.Context, string) error{store.MarkGenerationVerifyingEnvironment, store.MarkGenerationStreaming, store.MarkGenerationVerifyingResponse} {
		if err := mark(ctx, failedID); err != nil {
			t.Fatalf("mark failed: %v", err)
		}
	}
	if err := store.SettleSecureGeneration(ctx, SecureGenerationSettlementInput{
		GenerationID: failedID,
		Body:         "must not enter history",
		Verification: GenerationVerification{Status: VerificationFailed, FailureCode: "invalid_receipt"},
	}); err != nil {
		t.Fatalf("settle failed: %v", err)
	}
	failed, err := store.GetGeneration(ctx, failedID)
	if err != nil {
		t.Fatalf("load failed: %v", err)
	}
	if failed.State != GenerationFailed || failed.AssistantMessageID != "" || failed.Verification.Status != VerificationFailed {
		t.Fatalf("failed generation = %#v, want failed without assistant", failed)
	}
	if err := store.SkipGenerationBatchContext(ctx, failedBatch.ID); err != nil {
		t.Fatalf("skip failed batch: %v", err)
	}

	unverifiedBatch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID: conversation.ID, ClientRequestID: "gateway-failed", Body: "gateway-failed",
		Targets: []GenerationTargetInput{{ProviderID: "nearai", ModelID: "openai/gpt-4.1-mini", Snapshot: ProviderSnapshot{ProviderID: "nearai", ModelID: "openai/gpt-4.1-mini", PrivacyMode: "incognito"}}},
	})
	if err != nil {
		t.Fatalf("begin unverified: %v", err)
	}
	unverifiedID := unverifiedBatch.Targets[0].Generation.ID
	for _, mark := range []func(context.Context, string) error{store.MarkGenerationVerifyingEnvironment, store.MarkGenerationStreaming, store.MarkGenerationVerifyingResponse} {
		if err := mark(ctx, unverifiedID); err != nil {
			t.Fatalf("mark unverified: %v", err)
		}
	}
	if err := store.SettleSecureGeneration(ctx, SecureGenerationSettlementInput{
		GenerationID: unverifiedID,
		Body:         "keep unverified answer",
		Verification: GenerationVerification{Status: VerificationFailed, FailureCode: "response_verification_failed", EvidenceSummary: "Gateway signature could not be verified."},
	}); err != nil {
		t.Fatalf("settle unverified: %v", err)
	}
	unverified, err := store.GetGeneration(ctx, unverifiedID)
	if err != nil {
		t.Fatalf("load unverified: %v", err)
	}
	if unverified.State != GenerationCompleted || unverified.AssistantMessageID == "" || unverified.Verification.Status != VerificationFailed {
		t.Fatalf("unverified generation = %#v, want completed assistant marked failed", unverified)
	}
	if unverified.Verification.Lanes == nil || unverified.Verification.Lanes.Gateway != VerificationLaneVerified || unverified.Verification.Lanes.Response != VerificationLaneFailed {
		t.Fatalf("unverified lanes = %#v, want gateway verified and response failed", unverified.Verification.Lanes)
	}

	view, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("load statuses conversation: %v", err)
	}
	if len(view.Messages) != 5 {
		t.Fatalf("status conversation messages = %#v, want three user messages plus two retained answers", view.Messages)
	}
	roles := []string{view.Messages[0].Role, view.Messages[1].Role, view.Messages[2].Role, view.Messages[3].Role, view.Messages[4].Role}
	if roles[0] != "user" || roles[1] != "assistant" || roles[2] != "user" || roles[3] != "user" || roles[4] != "assistant" {
		t.Fatalf("message roles = %#v", roles)
	}
}

func TestSQLiteStoreDoesNotSelectGatewayOnlySecureGenerationAsContext(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Gateway-only selection")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	batch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID:  conversation.ID,
		ClientRequestID: "gateway-only-selection",
		Body:            "Question",
		Targets:         []GenerationTargetInput{{ProviderID: "nearai", ModelID: "private-model", Snapshot: ProviderSnapshot{ProviderID: "nearai", ModelID: "private-model"}}},
	})
	if err != nil {
		t.Fatalf("begin secure batch: %v", err)
	}
	id := batch.Targets[0].Generation.ID
	if err := store.MarkGenerationVerifyingEnvironment(ctx, id); err != nil {
		t.Fatalf("mark environment verification: %v", err)
	}
	if err := store.MarkGenerationStreaming(ctx, id); err != nil {
		t.Fatalf("mark streaming: %v", err)
	}
	if err := store.MarkGenerationVerifyingResponse(ctx, id); err != nil {
		t.Fatalf("mark response verification: %v", err)
	}
	if err := store.SettleSecureGeneration(ctx, SecureGenerationSettlementInput{
		GenerationID: id,
		Body:         "gateway answer",
		Verification: GenerationVerification{Status: VerificationGateway, CompletionID: "gateway-completion", SignatureKind: "gateway", SigningAddress: "gateway-signer", SigningAlgorithm: "ed25519", SignatureDigest: "sha256:gateway"},
	}); err != nil {
		t.Fatalf("settle gateway-only generation: %v", err)
	}
	if err := store.SelectGenerationAnswer(ctx, id); err == nil {
		t.Fatal("gateway-only secure generation was selected as conversation context")
	}
}

func TestSQLiteStoreKeepsPrivateComparisonTargetsIndependent(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Private comparison results")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	batch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID:  conversation.ID,
		ClientRequestID: "private-comparison-results",
		Body:            "Compare privately",
		Targets: []GenerationTargetInput{
			{ProviderID: "nearai", ModelID: "model-a", Snapshot: ProviderSnapshot{ProviderID: "nearai", ModelID: "model-a"}},
			{ProviderID: "nearai", ModelID: "model-b", Snapshot: ProviderSnapshot{ProviderID: "nearai", ModelID: "model-b"}},
		},
	})
	if err != nil {
		t.Fatalf("begin private comparison: %v", err)
	}
	for _, target := range batch.Targets {
		id := target.Generation.ID
		if err := store.MarkGenerationVerifyingEnvironment(ctx, id); err != nil {
			t.Fatalf("mark environment %s: %v", id, err)
		}
		if err := store.MarkGenerationStreaming(ctx, id); err != nil {
			t.Fatalf("mark streaming %s: %v", id, err)
		}
		if err := store.MarkGenerationVerifyingResponse(ctx, id); err != nil {
			t.Fatalf("mark response %s: %v", id, err)
		}
	}
	verifiedAt := time.Now().UTC()
	if err := store.SettleSecureGeneration(ctx, SecureGenerationSettlementInput{
		GenerationID: batch.Targets[0].Generation.ID,
		Body:         "Verified A",
		Verification: GenerationVerification{Status: VerificationModel, CompletionID: "completion-a", VerifiedAt: &verifiedAt, SignatureKind: "provider_tee", SigningAddress: "signer-a", SigningAlgorithm: "ed25519", SignatureDigest: "sha256:a"},
	}); err != nil {
		t.Fatalf("settle verified target: %v", err)
	}
	if err := store.SettleSecureGeneration(ctx, SecureGenerationSettlementInput{
		GenerationID: batch.Targets[1].Generation.ID,
		Verification: GenerationVerification{Status: VerificationFailed, FailureCode: "invalid_receipt", EvidenceSummary: "Receipt did not verify."},
	}); err != nil {
		t.Fatalf("settle failed target: %v", err)
	}
	loaded, err := store.GetGenerationBatch(ctx, batch.ID)
	if err != nil {
		t.Fatalf("load private comparison: %v", err)
	}
	if loaded.State != GenerationBatchCompletedWithErrors || loaded.Targets[0].Generation.AssistantMessageID == "" || loaded.Targets[1].Generation.AssistantMessageID != "" {
		t.Fatalf("private comparison = %#v, want one verified result and one failed result", loaded)
	}
}

func TestSQLiteStoreRecoversInterruptedSecureGenerationWithoutHistoryBody(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secure.sqlite")
	ctx := context.Background()
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	conversation, err := store.CreateConversation(ctx, "Restart secure")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	batch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{ConversationID: conversation.ID, ClientRequestID: "restart-secure", Body: "restart me", Targets: []GenerationTargetInput{{ProviderID: "nearai", ModelID: "private-model", Snapshot: ProviderSnapshot{ProviderID: "nearai", ModelID: "private-model"}}}})
	if err != nil {
		t.Fatalf("begin batch: %v", err)
	}
	if err := store.MarkGenerationVerifyingEnvironment(ctx, batch.Targets[0].Generation.ID); err != nil {
		t.Fatalf("mark environment: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}
	reopened, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	defer reopened.Close()
	if err := reopened.RecoverInterruptedGenerations(ctx); err != nil {
		t.Fatalf("recover secure generation: %v", err)
	}
	recovered, err := reopened.GetGeneration(ctx, batch.Targets[0].Generation.ID)
	if err != nil {
		t.Fatalf("load recovered secure generation: %v", err)
	}
	if recovered.State != GenerationFailed || recovered.ErrorCode != "interrupted" || recovered.Verification.Status != VerificationPending || recovered.AssistantMessageID != "" {
		t.Fatalf("recovered secure generation = %#v, want interrupted failure without assistant", recovered)
	}
	view, err := reopened.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("load recovered conversation: %v", err)
	}
	if len(view.Messages) != 1 || view.Messages[0].Role != "user" {
		t.Fatalf("recovered messages = %#v, want only user message", view.Messages)
	}
}

func TestSQLiteStoreRejectsSecureSettlementForOrdinaryProvider(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Ordinary provider")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	batch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{ConversationID: conversation.ID, ClientRequestID: "ordinary-secure", Body: "ordinary", Targets: []GenerationTargetInput{{ProviderID: "openai", ModelID: "model", Snapshot: ProviderSnapshot{ProviderID: "openai", ModelID: "model"}}}})
	if err != nil {
		t.Fatalf("begin ordinary batch: %v", err)
	}
	if err := store.MarkGenerationVerifyingEnvironment(ctx, batch.Targets[0].Generation.ID); err == nil {
		t.Fatal("ordinary Provider entered secure verification")
	}
	if err := store.SettleSecureGeneration(ctx, SecureGenerationSettlementInput{GenerationID: batch.Targets[0].Generation.ID, Body: "forged", Verification: GenerationVerification{Status: VerificationModel, CompletionID: "completion", SignatureKind: "provider_tee", SigningAddress: "signer", SigningAlgorithm: "ed25519", SignatureDigest: "sha256:forged"}}); err == nil {
		t.Fatal("ordinary Provider accepted forged secure settlement")
	}
}

func TestSQLiteStoreNormalizesConversationTitles(t *testing.T) {
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()

	conversation, err := store.CreateConversation(ctx, "   ")
	if err != nil {
		t.Fatalf("create blank conversation: %v", err)
	}
	if conversation.Title != "New conversation" {
		t.Fatalf("blank conversation title = %q, want default title", conversation.Title)
	}
	if err := store.RenameConversation(ctx, conversation.ID, "  Renamed locally  "); err != nil {
		t.Fatalf("rename conversation: %v", err)
	}
	loaded, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("load renamed conversation: %v", err)
	}
	if loaded.Title != "Renamed locally" {
		t.Fatalf("renamed conversation title = %q, want trimmed title", loaded.Title)
	}
}

func TestSQLiteStoreDerivesTitleFromTheFirstUserMessageOnly(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()

	conversation, err := store.CreateConversation(ctx, "")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	snapshot := ProviderSnapshot{ProviderID: "provider-1", ProviderName: "Fixture", ModelID: "model-a"}
	if _, err := store.BeginGeneration(ctx, BeginGenerationInput{
		ConversationID: conversation.ID, ClientRequestID: "title-1", Body: "  Secure local\nchat workspace  ", Snapshot: snapshot,
	}); err != nil {
		t.Fatalf("begin first generation: %v", err)
	}
	first, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("load first conversation: %v", err)
	}
	if first.Title != "Secure local chat workspace" {
		t.Fatalf("first derived title = %q, want %q", first.Title, "Secure local chat workspace")
	}

	if err := store.RenameConversation(ctx, conversation.ID, "Pinned locally"); err != nil {
		t.Fatalf("rename conversation: %v", err)
	}
	if _, err := store.BeginGeneration(ctx, BeginGenerationInput{
		ConversationID: conversation.ID, ClientRequestID: "title-2", Body: "A later message", Snapshot: snapshot,
	}); err != nil {
		t.Fatalf("begin second generation: %v", err)
	}
	second, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatalf("load renamed conversation: %v", err)
	}
	if second.Title != "Pinned locally" {
		t.Fatalf("renamed title = %q, want %q", second.Title, "Pinned locally")
	}
}

func TestSQLiteStoreMigrationFailurePreservesTheExistingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cove.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open seed database: %v", err)
	}
	if _, err := db.Exec(`CREATE TABLE sentinel (value TEXT NOT NULL); INSERT INTO sentinel (value) VALUES ('keep me'); PRAGMA user_version = 14;`); err != nil {
		db.Close()
		t.Fatalf("seed database: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close seed database: %v", err)
	}

	if _, err := OpenSQLite(path); err == nil {
		t.Fatal("opening a database with a newer schema version succeeded")
	}

	reopened, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("reopen preserved database: %v", err)
	}
	defer reopened.Close()
	var value string
	if err := reopened.QueryRow(`SELECT value FROM sentinel`).Scan(&value); err != nil {
		t.Fatalf("read preserved sentinel: %v", err)
	}
	if value != "keep me" {
		t.Fatalf("preserved sentinel = %q, want %q", value, "keep me")
	}
}

func TestSQLiteStoreRollsBackAFailedMigrationWithoutLosingExistingData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cove.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open seed database: %v", err)
	}
	if _, err := db.Exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY); CREATE TABLE sentinel (value TEXT NOT NULL); INSERT INTO sentinel (value) VALUES ('keep me');`); err != nil {
		db.Close()
		t.Fatalf("seed database: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close seed database: %v", err)
	}

	if _, err := OpenSQLite(path); err == nil {
		t.Fatal("opening a database with a conflicting migration succeeded")
	}

	reopened, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("reopen preserved database: %v", err)
	}
	defer reopened.Close()
	var value string
	if err := reopened.QueryRow(`SELECT value FROM sentinel`).Scan(&value); err != nil {
		t.Fatalf("read preserved sentinel: %v", err)
	}
	if value != "keep me" {
		t.Fatalf("preserved sentinel = %q, want %q", value, "keep me")
	}
}

func TestSQLiteStoreListsRecentlyUpdatedConversationsAndRejectsOrphanMessages(t *testing.T) {
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()

	older, err := store.CreateConversation(ctx, "Older")
	if err != nil {
		t.Fatalf("create older conversation: %v", err)
	}
	newer, err := store.CreateConversation(ctx, "Newer")
	if err != nil {
		t.Fatalf("create newer conversation: %v", err)
	}
	if _, err := store.AddMessage(ctx, older.ID, MessageInput{Role: "user", Body: "touch older"}); err != nil {
		t.Fatalf("add older message: %v", err)
	}

	conversations, err := store.ListConversations(ctx)
	if err != nil {
		t.Fatalf("list conversations: %v", err)
	}
	if len(conversations) != 2 || conversations[0].ID != older.ID || conversations[1].ID != newer.ID {
		t.Fatalf("conversation order = %#v, want recently updated first", conversations)
	}

	if _, err := store.AddMessage(ctx, "missing-conversation", MessageInput{Role: "user", Body: "orphan"}); err == nil {
		t.Fatal("foreign key allowed a message without a conversation")
	}
}

func TestSQLiteStorePersistsPinnedAndArchivedConversationState(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()

	older, err := store.CreateConversation(ctx, "Older active")
	if err != nil {
		t.Fatalf("create older conversation: %v", err)
	}
	newer, err := store.CreateConversation(ctx, "Newer active")
	if err != nil {
		t.Fatalf("create newer conversation: %v", err)
	}
	if err := store.SetConversationPinned(ctx, older.ID, true); err != nil {
		t.Fatalf("pin conversation: %v", err)
	}
	if err := store.SetConversationArchived(ctx, newer.ID, true); err != nil {
		t.Fatalf("archive conversation: %v", err)
	}

	active, err := store.ListConversations(ctx)
	if err != nil {
		t.Fatalf("list active conversations: %v", err)
	}
	if len(active) != 1 || active[0].ID != older.ID || !active[0].Pinned || active[0].Archived {
		t.Fatalf("active conversations = %#v, want pinned older conversation only", active)
	}
	archived, err := store.ListArchivedConversations(ctx)
	if err != nil {
		t.Fatalf("list archived conversations: %v", err)
	}
	if len(archived) != 1 || archived[0].ID != newer.ID || !archived[0].Archived {
		t.Fatalf("archived conversations = %#v, want newer archived conversation only", archived)
	}
	if err := store.SetConversationArchived(ctx, newer.ID, false); err != nil {
		t.Fatalf("unarchive conversation: %v", err)
	}
	if err := store.SetConversationPinned(ctx, older.ID, false); err != nil {
		t.Fatalf("unpin conversation: %v", err)
	}
	loaded, err := store.LoadConversation(ctx, older.ID)
	if err != nil || loaded.Pinned || loaded.Archived {
		t.Fatalf("loaded active conversation = %#v, %v; want unpinned and unarchived", loaded.Conversation, err)
	}
}

func TestSQLiteStoreDeletesConversationAndItsLocalHistory(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()

	conversation, err := store.CreateConversation(ctx, "To delete")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if _, err := store.AddMessage(ctx, conversation.ID, MessageInput{Role: "user", Body: "Delete me"}); err != nil {
		t.Fatalf("add message: %v", err)
	}
	if err := store.DeleteConversation(ctx, conversation.ID); err != nil {
		t.Fatalf("delete conversation: %v", err)
	}
	if _, err := store.LoadConversation(ctx, conversation.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("load deleted conversation error = %v, want sql.ErrNoRows", err)
	}
	conversations, err := store.ListConversations(ctx)
	if err != nil {
		t.Fatalf("list conversations: %v", err)
	}
	if len(conversations) != 0 {
		t.Fatalf("conversations after delete = %#v, want empty", conversations)
	}
}

func TestSQLiteStoreClearsOnlyConversationHistory(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	profile := ProviderProfile{
		ID: "provider-1", Kind: "openai_compatible", Name: "Keep this Provider",
		Endpoint: "https://provider.example/v1", ModelID: "model-a", AuthMethod: "bearer",
	}
	if err := store.UpsertProviderProfile(ctx, profile); err != nil {
		t.Fatalf("save provider profile: %v", err)
	}
	settings := Settings{Theme: "dark", Locale: "zh", SystemPrompt: "Keep these settings.", ActiveModelSet: []ActiveModelTarget{}}
	if err := store.UpdateSettings(ctx, settings); err != nil {
		t.Fatalf("save workspace settings: %v", err)
	}
	conversation, err := store.CreateConversation(ctx, "Clear this history")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	generation, err := store.BeginGeneration(ctx, BeginGenerationInput{
		ConversationID: conversation.ID, ClientRequestID: "clear-history-1", Body: "Delete this message.",
		Snapshot: ProviderSnapshot{ProviderID: profile.ID, ProviderName: profile.Name, ModelID: profile.ModelID},
	})
	if err != nil {
		t.Fatalf("begin generation: %v", err)
	}
	if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: generation.ID, Body: "Delete this response."}); err != nil {
		t.Fatalf("complete generation: %v", err)
	}

	if err := store.ClearChatData(ctx); err != nil {
		t.Fatalf("clear conversation history: %v", err)
	}
	if conversations, err := store.ListConversations(ctx); err != nil || len(conversations) != 0 {
		t.Fatalf("conversations after clear = %#v, %v; want empty history", conversations, err)
	}
	if _, err := store.LoadConversation(ctx, conversation.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("load cleared conversation error = %v, want sql.ErrNoRows", err)
	}
	if _, err := store.GetGeneration(ctx, generation.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("load cleared generation error = %v, want sql.ErrNoRows", err)
	}
	if kept, err := store.GetProviderProfile(ctx, profile.ID); err != nil || kept.Name != profile.Name {
		t.Fatalf("provider profile after clear = %#v, %v; want preserved profile", kept, err)
	}
	if kept, err := store.GetSettings(ctx); err != nil || !reflect.DeepEqual(kept, settings) {
		t.Fatalf("workspace settings after clear = %#v, %v; want preserved settings", kept, err)
	}
}

func TestSQLiteStorePersistsWorkspaceSettingsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cove.sqlite")
	ctx := context.Background()
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	settings, err := store.GetSettings(ctx)
	if err != nil {
		t.Fatalf("get default settings: %v", err)
	}
	if !reflect.DeepEqual(settings, Settings{Theme: "system", Locale: "system", SystemPrompt: "", ActiveModelSet: []ActiveModelTarget{}}) {
		t.Fatalf("default settings = %#v, want system defaults", settings)
	}
	if err := store.UpdateSettings(ctx, Settings{Theme: "dark", Locale: "zh", SystemPrompt: "Answer concisely."}); err != nil {
		t.Fatalf("update settings: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	reopened, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("reopen SQLite store: %v", err)
	}
	defer reopened.Close()
	got, err := reopened.GetSettings(ctx)
	if err != nil {
		t.Fatalf("get persisted settings: %v", err)
	}
	if !reflect.DeepEqual(got, Settings{Theme: "dark", Locale: "zh", SystemPrompt: "Answer concisely.", ActiveModelSet: []ActiveModelTarget{}}) {
		t.Fatalf("persisted settings = %#v, want updated settings", got)
	}
}

func TestSQLiteStorePersistsAndValidatesGlobalGenerationParameters(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()

	temperature, topP, maxTokens := 0.35, 0.8, 2048
	settings := Settings{
		Theme: "system", Locale: "system", SystemPrompt: "",
		GenerationParameters: GenerationParameters{Temperature: &temperature, TopP: &topP, MaxTokens: &maxTokens},
	}
	if err := store.UpdateSettings(context.Background(), settings); err != nil {
		t.Fatalf("update generation parameters: %v", err)
	}
	got, err := store.GetSettings(context.Background())
	if err != nil {
		t.Fatalf("get generation parameters: %v", err)
	}
	if got.Temperature == nil || *got.Temperature != temperature || got.TopP == nil || *got.TopP != topP || got.MaxTokens == nil || *got.MaxTokens != maxTokens {
		t.Fatalf("generation parameters = %#v, want %#v", got.GenerationParameters, settings.GenerationParameters)
	}

	invalidTemperature := 2.1
	if err := store.UpdateSettings(context.Background(), Settings{Theme: "system", Locale: "system", GenerationParameters: GenerationParameters{Temperature: &invalidTemperature}}); err == nil {
		t.Fatal("accepted a temperature above 2")
	}
	invalidTopP := -0.1
	if err := store.UpdateSettings(context.Background(), Settings{Theme: "system", Locale: "system", GenerationParameters: GenerationParameters{TopP: &invalidTopP}}); err == nil {
		t.Fatal("accepted a negative top_p")
	}
	invalidMaxTokens := 0
	if err := store.UpdateSettings(context.Background(), Settings{Theme: "system", Locale: "system", GenerationParameters: GenerationParameters{MaxTokens: &invalidMaxTokens}}); err == nil {
		t.Fatal("accepted max_tokens below 1")
	}
}

func TestSQLiteStorePreservesEachGenerationAttemptConfigurationSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cove.sqlite")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Snapshot history")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	zero, initialMaxTokens := 0.0, 256
	initial := GenerationConfigurationSnapshot{
		SystemPrompt:         "Use the original configuration.",
		GenerationParameters: GenerationParameters{Temperature: &zero, MaxTokens: &initialMaxTokens},
	}
	batch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID: conversation.ID, ClientRequestID: "snapshot-initial", Body: "Question",
		SystemPrompt: initial.SystemPrompt, GenerationParameters: initial.GenerationParameters,
		Targets: []GenerationTargetInput{{ProviderID: "provider-a", ModelID: "model-a", Snapshot: ProviderSnapshot{ProviderID: "provider-a", ProviderName: "Provider A", ModelID: "model-a"}}},
	})
	if err != nil {
		t.Fatalf("begin generation batch: %v", err)
	}
	first := batch.Targets[0].Generation
	if !reflect.DeepEqual(first.ConfigurationSnapshot, initial) {
		t.Fatalf("initial configuration = %#v, want %#v", first.ConfigurationSnapshot, initial)
	}
	if err := store.TerminateGeneration(ctx, TerminateGenerationInput{GenerationID: first.ID, State: GenerationFailed, ErrorCode: "provider_error", ErrorMessage: "Fixture failure."}); err != nil {
		t.Fatalf("fail first attempt: %v", err)
	}
	updatedTopP, updatedMaxTokens := 0.4, 512
	updated := GenerationConfigurationSnapshot{
		SystemPrompt:         "Use the updated configuration.",
		GenerationParameters: GenerationParameters{TopP: &updatedTopP, MaxTokens: &updatedMaxTokens},
	}
	retry, err := store.BeginGenerationAttempt(ctx, BeginGenerationAttemptInput{
		TargetID: batch.Targets[0].ID, ClientRequestID: "snapshot-retry", Snapshot: first.Snapshot,
		ConfigurationSnapshot: updated,
	})
	if err != nil {
		t.Fatalf("begin retry attempt: %v", err)
	}
	if !reflect.DeepEqual(retry.ConfigurationSnapshot, updated) {
		t.Fatalf("retry configuration = %#v, want %#v", retry.ConfigurationSnapshot, updated)
	}
	persistedInitial, err := store.GetGeneration(ctx, first.ID)
	if err != nil {
		t.Fatalf("reload original attempt: %v", err)
	}
	if !reflect.DeepEqual(persistedInitial.ConfigurationSnapshot, initial) {
		t.Fatalf("original configuration changed to %#v, want %#v", persistedInitial.ConfigurationSnapshot, initial)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}
	reopened, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	defer reopened.Close()
	persistedRetry, err := reopened.GetGeneration(ctx, retry.ID)
	if err != nil {
		t.Fatalf("reload retry attempt: %v", err)
	}
	if !reflect.DeepEqual(persistedRetry.ConfigurationSnapshot, updated) {
		t.Fatalf("reopened retry configuration = %#v, want %#v", persistedRetry.ConfigurationSnapshot, updated)
	}
}

func TestSQLiteStoreAcceptsJapaneseWorkspaceLocale(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()

	if err := store.UpdateSettings(context.Background(), Settings{Theme: "system", Locale: "ja", SystemPrompt: ""}); err != nil {
		t.Fatalf("update Japanese locale: %v", err)
	}
	got, err := store.GetSettings(context.Background())
	if err != nil {
		t.Fatalf("get Japanese locale: %v", err)
	}
	if got.Locale != "ja" {
		t.Fatalf("locale = %q, want ja", got.Locale)
	}
}

func TestSQLiteStorePersistsActiveProviderAndModelSelectionAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cove.sqlite")
	ctx := context.Background()
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	settings := Settings{
		Theme: "system", Locale: "system", SystemPrompt: "",
		ActiveProviderID: "provider-1", ActiveModelID: "model-b", ActiveModelSet: []ActiveModelTarget{{ProviderID: "provider-1", ModelID: "model-b"}},
	}
	if err := store.UpdateSettings(ctx, settings); err != nil {
		t.Fatalf("update active selection: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	reopened, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("reopen SQLite store: %v", err)
	}
	defer reopened.Close()
	got, err := reopened.GetSettings(ctx)
	if err != nil {
		t.Fatalf("get persisted active selection: %v", err)
	}
	if !reflect.DeepEqual(got, settings) {
		t.Fatalf("persisted settings = %#v, want %#v", got, settings)
	}
}

func TestSQLiteStorePersistsAnActiveModelSetOfUpToFourTargets(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	settings := Settings{
		Theme: "system", Locale: "system", SystemPrompt: "",
		ActiveModelSet: []ActiveModelTarget{
			{ProviderID: "provider-a", ModelID: "model-a"},
			{ProviderID: "provider-b", ModelID: "model-b"},
		},
	}
	if err := store.UpdateSettings(ctx, settings); err != nil {
		t.Fatalf("save active model set: %v", err)
	}
	got, err := store.GetSettings(ctx)
	if err != nil {
		t.Fatalf("load active model set: %v", err)
	}
	if !reflect.DeepEqual(got.ActiveModelSet, settings.ActiveModelSet) {
		t.Fatalf("active model set = %#v, want %#v", got.ActiveModelSet, settings.ActiveModelSet)
	}
	if err := store.UpdateSettings(ctx, Settings{Theme: "system", Locale: "system", ActiveModelSet: []ActiveModelTarget{{ProviderID: "a", ModelID: "1"}, {ProviderID: "b", ModelID: "2"}, {ProviderID: "c", ModelID: "3"}, {ProviderID: "d", ModelID: "4"}, {ProviderID: "e", ModelID: "5"}}}); err == nil {
		t.Fatal("accepted an active model set with five targets")
	}
}

func TestSQLiteStoreLimitsSystemPromptByUnicodeCharacters(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()

	if err := store.UpdateSettings(context.Background(), Settings{Theme: "system", Locale: "system", SystemPrompt: strings.Repeat("\u754c", 8193)}); err == nil {
		t.Fatal("accepted a system prompt longer than 8192 Unicode characters")
	}
	if err := store.UpdateSettings(context.Background(), Settings{Theme: "system", Locale: "system", SystemPrompt: strings.Repeat("\u754c", 8192)}); err != nil {
		t.Fatalf("rejected an 8192-character system prompt: %v", err)
	}
}

func TestSQLiteStorePersistsIndependentVerificationLanes(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open SQLite store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Independent lanes")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}

	explicitBatch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID: conversation.ID, ClientRequestID: "explicit-lanes", Body: "explicit-lanes",
		Targets: []GenerationTargetInput{{ProviderID: "nearai", ModelID: "openai/gpt-4.1-mini", Snapshot: ProviderSnapshot{ProviderID: "nearai", ModelID: "openai/gpt-4.1-mini", PrivacyMode: "incognito"}}},
	})
	if err != nil {
		t.Fatalf("begin explicit: %v", err)
	}
	explicitID := explicitBatch.Targets[0].Generation.ID
	if err := store.MarkGenerationVerifyingEnvironment(ctx, explicitID); err != nil {
		t.Fatalf("mark explicit environment: %v", err)
	}
	pending, err := store.GetGeneration(ctx, explicitID)
	if err != nil {
		t.Fatalf("load pending: %v", err)
	}
	if pending.Verification.Lanes == nil || pending.Verification.Lanes.Gateway != VerificationLanePending || pending.Verification.Lanes.Response != VerificationLanePending || pending.Verification.Lanes.Model != "" {
		t.Fatalf("pending lanes = %#v, want independently stored pending gateway+response", pending.Verification.Lanes)
	}
	for _, mark := range []func(context.Context, string) error{store.MarkGenerationStreaming, store.MarkGenerationVerifyingResponse} {
		if err := mark(ctx, explicitID); err != nil {
			t.Fatalf("mark explicit: %v", err)
		}
	}
	if err := store.SettleSecureGeneration(ctx, SecureGenerationSettlementInput{
		GenerationID: explicitID,
		Body:         "keep mixed lanes",
		Verification: GenerationVerification{
			Status:      VerificationFailed,
			FailureCode: "response_verification_failed",
			Lanes:       &VerificationLanes{Gateway: VerificationLaneFailed, Response: VerificationLaneVerified},
		},
	}); err != nil {
		t.Fatalf("settle explicit: %v", err)
	}
	explicit, err := store.GetGeneration(ctx, explicitID)
	if err != nil {
		t.Fatalf("load explicit: %v", err)
	}
	if explicit.Verification.Lanes == nil || explicit.Verification.Lanes.Gateway != VerificationLaneFailed || explicit.Verification.Lanes.Response != VerificationLaneVerified || explicit.Verification.Lanes.Model != "" {
		t.Fatalf("explicit lanes = %#v, want stored mixed outcomes instead of a derived trio", explicit.Verification.Lanes)
	}
	if err := store.SkipGenerationBatchContext(ctx, explicitBatch.ID); err != nil {
		t.Fatalf("skip explicit batch: %v", err)
	}

	legacyBatch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID: conversation.ID, ClientRequestID: "legacy-lanes", Body: "legacy-lanes",
		Targets: []GenerationTargetInput{{ProviderID: "nearai", ModelID: "Qwen/Qwen3.8-27B", Snapshot: ProviderSnapshot{ProviderID: "nearai", ModelID: "Qwen/Qwen3.8-27B", PrivacyMode: "private_tee"}}},
	})
	if err != nil {
		t.Fatalf("begin legacy: %v", err)
	}
	legacyID := legacyBatch.Targets[0].Generation.ID
	for _, mark := range []func(context.Context, string) error{store.MarkGenerationVerifyingEnvironment, store.MarkGenerationStreaming, store.MarkGenerationVerifyingResponse} {
		if err := mark(ctx, legacyID); err != nil {
			t.Fatalf("mark legacy: %v", err)
		}
	}
	if err := store.SettleSecureGeneration(ctx, SecureGenerationSettlementInput{
		GenerationID: legacyID,
		Body:         "legacy private tee",
		Verification: GenerationVerification{Status: VerificationModel, CompletionID: "legacy-completion", SignatureKind: "provider_tee", SigningAddress: "nearai-signer", SigningAlgorithm: "ed25519", SignatureDigest: "sha256:legacy"},
	}); err != nil {
		t.Fatalf("settle legacy: %v", err)
	}
	legacy, err := store.GetGeneration(ctx, legacyID)
	if err != nil {
		t.Fatalf("load legacy: %v", err)
	}
	if legacy.Verification.Lanes == nil || legacy.Verification.Lanes.Gateway != VerificationLaneVerified || legacy.Verification.Lanes.Model != VerificationLaneVerified || legacy.Verification.Lanes.Response != VerificationLaneVerified {
		t.Fatalf("legacy lanes = %#v, want normalized private TEE lanes", legacy.Verification.Lanes)
	}
}

func pragmaInt(t *testing.T, db *sql.DB, name string) int {

	t.Helper()
	var value int
	if err := db.QueryRow("PRAGMA " + name).Scan(&value); err != nil {
		t.Fatalf("read pragma %s: %v", name, err)
	}
	return value
}

func pragmaString(t *testing.T, db *sql.DB, name string) string {
	t.Helper()
	var value string
	if err := db.QueryRow("PRAGMA " + name).Scan(&value); err != nil {
		t.Fatalf("read pragma %s: %v", name, err)
	}
	return value
}
