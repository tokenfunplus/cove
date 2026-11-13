package chat

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func secureWatchdogFixture(t *testing.T) (*Service, *persistence.SQLiteStore, persistence.Conversation) {
	t.Helper()
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(context.Background(), "Watchdog fixture")
	if err != nil {
		t.Fatal(err)
	}
	profile := testProfile()
	profile.ID, profile.Kind = "nearai", provider.KindNearAIPreset
	service := NewService(store, classifiedProviderSource{
		profileProviderSource: profileProviderSource{profiles: map[string]provider.Profile{"nearai": profile}},
		metadata:              provider.ModelMetadata{PrivacyMode: provider.PrivacyModePrivateTEE, Verifiable: true},
	}, &fakeProvider{})
	t.Cleanup(func() {
		service.secureMu.Lock()
		service.activeMu.Lock()
		for id, timer := range service.secureActive {
			timer.Stop()
			delete(service.secureActive, id)
		}
		service.activeMu.Unlock()
		service.secureMu.Unlock()
		store.Close()
	})
	return service, store, conversation
}

func startWatchdogBatch(t *testing.T, service *Service, conversationID, requestID string) persistence.GenerationBatch {
	t.Helper()
	started, err := service.StartGenerationBatch(context.Background(), SendInput{ConversationID: conversationID, ClientRequestID: requestID, ProviderID: "nearai", ModelID: "model-a", Body: "Fixture question"})
	if err != nil {
		t.Fatal(err)
	}
	return started.Batch
}

func prepareSecureResponse(t *testing.T, service *Service, id string) {
	t.Helper()
	if _, err := service.MarkSecureGenerationVerifyingEnvironment(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if _, err := service.MarkSecureGenerationStreaming(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if _, err := service.MarkSecureGenerationVerifyingResponse(context.Background(), id); err != nil {
		t.Fatal(err)
	}
}

func verifiedSettlement(id string) persistence.SecureGenerationSettlementInput {
	return persistence.SecureGenerationSettlementInput{
		GenerationID: id, Body: "Verified fixture answer",
		Verification: persistence.GenerationVerification{Status: persistence.VerificationModel, SignatureKind: "provider_tee", CompletionID: "fixture-completion", SigningAddress: "fixture-address", SigningAlgorithm: "fixture-algorithm", SignatureDigest: "fixture-digest"},
	}
}

func TestBrowserWatchdogExpiresAbandonedBatchAndRetry(t *testing.T) {
	service, store, conversation := secureWatchdogFixture(t)
	service.secureTimeout = 50 * time.Millisecond
	batch := startWatchdogBatch(t, service, conversation.ID, "abandoned")
	id := batch.Targets[0].Generation.ID
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	events, err := service.SubscribeGenerationBatch(ctx, batch.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-events:
		if event.Type != EventFailed || event.ErrorCode != "timeout" {
			t.Fatalf("expiry event = %#v", event)
		}
	case <-ctx.Done():
		t.Fatal("abandoned browser did not time out")
	}
	if service.HasActiveGenerationBatch() {
		t.Fatal("expired browser still occupies the Batch slot")
	}
	view, err := store.LoadConversation(context.Background(), conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Messages) != 1 || view.GenerationBatches[0].State != persistence.GenerationBatchFailed {
		t.Fatalf("unexpected history after expiry: %#v", view)
	}
	late, err := service.SettleSecureGeneration(context.Background(), verifiedSettlement(id))
	if err != nil {
		t.Fatal(err)
	}
	if late.State != persistence.GenerationFailed || late.ErrorCode != "timeout" {
		t.Fatal("late browser result replaced timeout")
	}
	retry, err := service.RetryGenerationTarget(context.Background(), batch.Targets[0].ID, "retry")
	if err != nil {
		t.Fatal(err)
	}
	waitForGeneration(t, store, retry.Generation.ID, persistence.GenerationFailed)
	// Synchronize with watchdog cleanup after its storage transaction.
	service.secureMu.Lock()
	service.secureMu.Unlock()
	if service.HasActiveGenerationBatch() {
		t.Fatal("expired retry still occupies the Batch slot")
	}
	if err := service.SkipGenerationBatchContext(context.Background(), batch.ID); err != nil {
		t.Fatal(err)
	}
	next := startWatchdogBatch(t, service, conversation.ID, "next")
	if _, err := service.CancelGeneration(context.Background(), next.Targets[0].Generation.ID); err != nil {
		t.Fatal(err)
	}
}

func TestBrowserWatchdogExpiresEveryNonterminalPhase(t *testing.T) {
	for _, phase := range []persistence.GenerationState{persistence.GenerationPending, persistence.GenerationVerifyingEnvironment, persistence.GenerationStreaming, persistence.GenerationVerifyingResponse} {
		t.Run(string(phase), func(t *testing.T) {
			service, store, conversation := secureWatchdogFixture(t)
			batch := startWatchdogBatch(t, service, conversation.ID, "phase")
			id := batch.Targets[0].Generation.ID
			if phase != persistence.GenerationPending {
				if _, err := service.MarkSecureGenerationVerifyingEnvironment(context.Background(), id); err != nil {
					t.Fatal(err)
				}
			}
			if phase == persistence.GenerationStreaming || phase == persistence.GenerationVerifyingResponse {
				if _, err := service.MarkSecureGenerationStreaming(context.Background(), id); err != nil {
					t.Fatal(err)
				}
			}
			if phase == persistence.GenerationVerifyingResponse {
				if _, err := service.MarkSecureGenerationVerifyingResponse(context.Background(), id); err != nil {
					t.Fatal(err)
				}
			}
			service.expireSecureGeneration(id)
			generation, err := store.GetGeneration(context.Background(), id)
			if err != nil {
				t.Fatal(err)
			}
			if generation.State != persistence.GenerationFailed || generation.ErrorCode != "timeout" {
				t.Fatalf("expiry = %#v", generation)
			}
			lanes := generation.Verification.Lanes
			if lanes == nil || lanes.Gateway != persistence.VerificationLaneFailed || lanes.Model != persistence.VerificationLaneFailed || lanes.Response != persistence.VerificationLaneFailed {
				t.Fatalf("expiry must not claim verification without evidence: %#v", lanes)
			}
			if service.HasActiveGenerationBatch() {
				t.Fatal("expired phase left active state")
			}
		})
	}
}

func TestBrowserSettlementAndExpiryKeepOneTerminalResult(t *testing.T) {
	for _, outcome := range []string{"settlement", "cancel", "race"} {
		t.Run(outcome, func(t *testing.T) {
			service, store, conversation := secureWatchdogFixture(t)
			batch := startWatchdogBatch(t, service, conversation.ID, "terminal")
			id := batch.Targets[0].Generation.ID
			prepareSecureResponse(t, service, id)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			events, err := service.SubscribeGenerationBatch(ctx, batch.ID, "")
			if err != nil {
				t.Fatal(err)
			}
			settle := func() {
				if _, err := service.SettleSecureGeneration(context.Background(), verifiedSettlement(id)); err != nil {
					t.Error(err)
				}
			}
			switch outcome {
			case "settlement":
				settle()
				service.expireSecureGeneration(id)
			case "cancel":
				if _, err := service.CancelGeneration(context.Background(), id); err != nil {
					t.Fatal(err)
				}
				service.expireSecureGeneration(id)
			case "race":
				var wg sync.WaitGroup
				wg.Add(2)
				go func() { defer wg.Done(); settle() }()
				go func() { defer wg.Done(); service.expireSecureGeneration(id) }()
				wg.Wait()
			}
			count := 0
			for range events {
				count++
			}
			if count != 1 {
				t.Fatalf("terminal events = %d, want 1", count)
			}
			if service.HasActiveGenerationBatch() {
				t.Fatal("terminal result left active state")
			}
			view, err := store.LoadConversation(context.Background(), conversation.ID)
			if err != nil {
				t.Fatal(err)
			}
			generation := view.GenerationBatches[0].Targets[0].Generation
			if outcome == "settlement" && (generation.State != persistence.GenerationCompleted || len(view.Messages) != 2 || view.Messages[1].Body != "Verified fixture answer") {
				t.Fatal("normal verified result changed")
			}
			if outcome == "cancel" && (generation.State != persistence.GenerationStopped || len(view.Messages) != 1) {
				t.Fatal("cancellation result changed")
			}
			settle() // Repeated settlement remains idempotent, including event replay.
			count = 0
			replay, err := service.SubscribeGenerationBatch(ctx, batch.ID, "")
			if err != nil {
				t.Fatal(err)
			}
			for range replay {
				count++
			}
			if count != 1 {
				t.Fatalf("replayed terminal events = %d, want 1", count)
			}
		})
	}
}

func TestClearChatDataCancelsBrowserWatchdog(t *testing.T) {
	service, store, conversation := secureWatchdogFixture(t)
	batch := startWatchdogBatch(t, service, conversation.ID, "clear")
	if err := service.ClearChatData(context.Background()); err != nil {
		t.Fatal(err)
	}
	service.expireSecureGeneration(batch.Targets[0].Generation.ID)
	if service.HasActiveGenerationBatch() {
		t.Fatal("cleared browser task still occupies the Batch slot")
	}
	conversations, err := store.ListConversations(context.Background())
	if err != nil || len(conversations) != 0 {
		t.Fatalf("cleared history = %#v, %v", conversations, err)
	}
}

func TestBrowserWatchdogPreservesCompletedComparisonAnswers(t *testing.T) {
	service, store, conversation := secureWatchdogFixture(t)
	service.settings = store
	if err := store.UpdateSettings(context.Background(), persistence.Settings{
		Theme: "system", Locale: "system",
		ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "nearai", ModelID: "model-a"}, {ProviderID: "nearai", ModelID: "model-b"}},
	}); err != nil {
		t.Fatal(err)
	}
	batch := startWatchdogBatch(t, service, conversation.ID, "comparison")
	first, abandoned := batch.Targets[0].Generation.ID, batch.Targets[1].Generation.ID
	prepareSecureResponse(t, service, first)
	if _, err := service.SettleSecureGeneration(context.Background(), verifiedSettlement(first)); err != nil {
		t.Fatal(err)
	}
	if !service.HasActiveGenerationBatch() {
		t.Fatal("comparison released before its remaining target settled")
	}
	service.expireSecureGeneration(abandoned)
	view, err := store.LoadConversation(context.Background(), conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if view.GenerationBatches[0].State != persistence.GenerationBatchCompletedWithErrors || len(view.Messages) != 2 || view.Messages[1].Body != "Verified fixture answer" {
		t.Fatalf("comparison after expiry = %#v", view)
	}
	if view.GenerationBatches[0].SelectedGenerationID != "" {
		t.Fatal("comparison selected an answer without the user's choice")
	}
	if err := service.SelectGenerationAnswer(context.Background(), first); err != nil {
		t.Fatal(err)
	}
	next := startWatchdogBatch(t, service, conversation.ID, "next-comparison")
	contextMessages, err := service.GetGenerationBatchContext(context.Background(), next.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(contextMessages) != 2 || contextMessages[1].Content != "Verified fixture answer" {
		t.Fatalf("selected comparison context = %#v", contextMessages)
	}
}
