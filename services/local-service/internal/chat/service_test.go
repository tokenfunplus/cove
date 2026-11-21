package chat

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func TestServiceStartsGenerationStreamsDeltasAndPersistsOnlyCompletedAssistant(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Chat")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	inputTokens, outputTokens := int64(12), int64(2)
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{
		{Type: provider.EventStarted},
		{Type: provider.EventDelta, Delta: "Hello"},
		{Type: provider.EventDelta, Delta: " there"},
		{Type: provider.EventCompleted, Usage: &provider.TokenUsage{InputTokens: &inputTokens, OutputTokens: &outputTokens}},
	}}}
	service := NewService(store, fakeProviderSource{profile: provider.Profile{
		ID: "provider-1", Kind: provider.KindOpenAICompatible, Name: "Fixture",
		Endpoint: "https://provider.example/v1", Model: "model-a", AuthMethod: provider.AuthBearer,
		RuntimeLocation: "User configured cloud provider", Destination: "provider.example", TransportSecurity: "tls", PrivacyNotice: "sent over TLS",
	}, secret: credentials.Secret{Value: "test-key"}}, upstream)

	started, err := service.StartGeneration(context.Background(), SendInput{
		ConversationID: conversation.ID, ProviderID: "provider-1", ClientRequestID: "request-1", Body: "Hi",
	})
	if err != nil {
		t.Fatalf("start generation: %v", err)
	}
	if started.Generation.State != persistence.GenerationPending || started.Generation.ID == "" {
		t.Fatalf("start result = %#v, want pending generation", started.Generation)
	}
	events, err := service.SubscribeGeneration(context.Background(), started.Generation.ID, "")
	if err != nil {
		t.Fatalf("subscribe generation: %v", err)
	}
	var got []GenerationEvent
	deadline := time.After(time.Second)
	for len(got) < 4 {
		select {
		case event := <-events:
			got = append(got, event)
		case <-deadline:
			t.Fatalf("timed out after events = %#v", got)
		}
	}
	if got[0].Type != EventStarted || got[1].Type != EventDelta || got[1].Delta != "Hello" || got[2].Delta != " there" || got[3].Type != EventCompleted {
		t.Fatalf("events = %#v, want started, two deltas, completed", got)
	}
	if upstream.streamCalls() != 1 {
		t.Fatalf("provider stream calls = %d, want 1", upstream.streamCalls())
	}
	completed, err := store.GetGeneration(context.Background(), started.Generation.ID)
	if err != nil {
		t.Fatalf("load generation: %v", err)
	}
	if completed.Metrics == nil || completed.Metrics.InputTokens == nil || *completed.Metrics.InputTokens != inputTokens || completed.Metrics.OutputTokens == nil || *completed.Metrics.OutputTokens != outputTokens || completed.Metrics.TimeToFirstTokenMS == nil {
		t.Fatalf("completed measurements = %#v", completed.Metrics)
	}
	if completed.State != persistence.GenerationCompleted {
		t.Fatalf("generation state = %q, want completed", completed.State)
	}
	view, err := store.LoadConversation(context.Background(), conversation.ID)
	if err != nil {
		t.Fatalf("load conversation: %v", err)
	}
	if len(view.Messages) != 2 || view.Messages[1].Role != "assistant" || view.Messages[1].Body != "Hello there" {
		t.Fatalf("messages = %#v, want completed assistant body", view.Messages)
	}
}

func TestNextBatchWaitsForTerminalWorkerCleanupAndRespectsCancellation(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Cleanup")
	if err != nil {
		t.Fatal(err)
	}
	generation, err := store.BeginGeneration(context.Background(), persistence.BeginGenerationInput{
		ConversationID: conversation.ID, ClientRequestID: "cleanup-first", Body: "Question",
		Snapshot: persistence.ProviderSnapshot{ProviderID: "provider-a", ModelID: "model-a"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteGeneration(context.Background(), persistence.CompleteGenerationInput{GenerationID: generation.ID, Body: "Completed answer"}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, fakeProviderProfiles("provider-a"), &fakeProvider{})
	done := make(chan struct{})
	service.active[generation.ID] = &activeGeneration{done: done}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	input := SendInput{ConversationID: conversation.ID, ClientRequestID: "cleanup-next", Body: "Next question"}
	if _, err := service.StartGenerationBatch(ctx, input); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("send while terminal worker closes = %v, want caller cancellation", err)
	}
	close(done)
	// Missing provider selection now reaches validation instead of a stale
	// busy error, without creating another upstream request in this fixture.
	if _, err := service.StartGenerationBatch(context.Background(), input); !errors.Is(err, ErrProviderSelectionRequired) {
		t.Fatalf("send after cleanup = %v, want provider selection validation", err)
	}
}

func TestServiceLeavesSingleNearAITargetForSecureBrowserTransport(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Private chat")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "plaintext must not be sent"}, {Type: provider.EventCompleted}}}}
	service := NewService(store, fakeProviderSource{profile: provider.Profile{ID: "nearai", Kind: provider.KindNearAIPreset, Name: "NearAI", Endpoint: provider.NearAIEndpoint, Model: "private-model", AuthMethod: provider.AuthBearer, Configured: true}, secret: credentials.Secret{Value: "nearai-key"}}, upstream)

	started, err := service.StartGenerationBatch(context.Background(), SendInput{ConversationID: conversation.ID, ProviderID: "nearai", ModelID: "private-model", ClientRequestID: "private-request", Body: "Private prompt"})
	if err != nil {
		t.Fatalf("start private batch: %v", err)
	}
	if len(started.Batch.Targets) != 1 || started.Batch.Targets[0].Generation.State != persistence.GenerationPending {
		t.Fatalf("private batch = %#v, want one pending browser-controlled target", started.Batch)
	}
	if upstream.streamCalls() != 0 {
		t.Fatalf("legacy provider stream calls = %d, want 0 for private generation", upstream.streamCalls())
	}
}

func TestServiceLeavesNearAIIncognitoAndChutesTargetsForSecureBrowserTransport(t *testing.T) {
	for _, fixture := range []struct {
		name     string
		modelID  string
		metadata provider.ModelMetadata
	}{
		{name: "incognito", modelID: "openai/gpt-4.1-mini", metadata: provider.ModelMetadata{ID: "openai/gpt-4.1-mini", PrivacyMode: provider.PrivacyModeIncognito}},
		{name: "chutes", modelID: "moonshotai/kimi-k3", metadata: provider.ModelMetadata{ID: "moonshotai/kimi-k3", PrivacyMode: provider.PrivacyModeChutes, Verifiable: false}},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
			if err != nil {
				t.Fatalf("open store: %v", err)
			}
			defer store.Close()
			conversation, err := store.CreateConversation(context.Background(), fixture.name+" chat")
			if err != nil {
				t.Fatalf("create conversation: %v", err)
			}
			profile := provider.Profile{ID: "nearai", Kind: provider.KindNearAIPreset, Name: "NearAI", Endpoint: provider.NearAIEndpoint, Model: fixture.modelID, AuthMethod: provider.AuthBearer, Configured: true}
			profiles := classifiedProviderSource{
				profileProviderSource: profileProviderSource{profiles: map[string]provider.Profile{"nearai": profile}},
				metadata:              fixture.metadata,
			}
			upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "plaintext must not be sent"}, {Type: provider.EventCompleted}}}}
			service := NewService(store, profiles, upstream)

			started, err := service.StartGenerationBatch(context.Background(), SendInput{ConversationID: conversation.ID, ProviderID: "nearai", ModelID: fixture.modelID, ClientRequestID: fixture.name + "-request", Body: "Hello"})
			if err != nil {
				t.Fatalf("start %s batch: %v", fixture.name, err)
			}
			if len(started.Batch.Targets) != 1 || started.Batch.Targets[0].Generation.State != persistence.GenerationPending {
				t.Fatalf("%s batch = %#v, want one pending browser-controlled target", fixture.name, started.Batch)
			}
			if upstream.streamCalls() != 0 {
				t.Fatalf("legacy provider stream calls = %d, want 0 for %s generation", upstream.streamCalls(), fixture.name)
			}
		})
	}
}

func TestServiceStartsMultipleNearAITargetsForIndependentBrowserTransports(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Private comparison")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	first := testProfile()
	first.ID, first.Kind, first.Name = "nearai", provider.KindNearAIPreset, "NearAI"
	profiles := profileProviderSource{profiles: map[string]provider.Profile{first.ID: first}}
	if err := store.UpdateSettings(context.Background(), persistence.Settings{
		Theme: "system", Locale: "system",
		ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: first.ID, ModelID: "model-a"}, {ProviderID: first.ID, ModelID: "model-b"}},
	}); err != nil {
		t.Fatalf("save active model set: %v", err)
	}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "plaintext"}, {Type: provider.EventCompleted}}}}
	service := NewServiceWithSettings(store, profiles, upstream, store)

	started, err := service.StartGenerationBatch(context.Background(), SendInput{ConversationID: conversation.ID, ClientRequestID: "private-comparison", Body: "Keep private"})
	if err != nil {
		t.Fatalf("start private comparison: %v", err)
	}
	if len(started.Batch.Targets) != 2 || started.Batch.Targets[0].Generation.State != persistence.GenerationPending || started.Batch.Targets[1].Generation.State != persistence.GenerationPending {
		t.Fatalf("private comparison = %#v, want two pending browser-controlled targets", started.Batch)
	}
	if upstream.streamCalls() != 0 {
		t.Fatalf("legacy provider stream calls = %d, want 0 for private comparison", upstream.streamCalls())
	}
}

func TestServiceStartsMixedPrivateAndOrdinaryComparison(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Mixed comparison")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	private := testProfile()
	private.ID, private.Kind, private.Name = "nearai", provider.KindNearAIPreset, "NearAI"
	ordinary := testProfile()
	ordinary.ID, ordinary.Model = "ordinary", "ordinary-model"
	profiles := profileProviderSource{profiles: map[string]provider.Profile{private.ID: private, ordinary.ID: ordinary}}
	if err := store.UpdateSettings(context.Background(), persistence.Settings{
		Theme: "system", Locale: "system",
		ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: private.ID, ModelID: "private-model"}, {ProviderID: ordinary.ID, ModelID: ordinary.Model}},
	}); err != nil {
		t.Fatalf("save active model set: %v", err)
	}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "ordinary answer"}, {Type: provider.EventCompleted}}}}
	service := NewServiceWithSettings(store, profiles, upstream, store)
	started, err := service.StartGenerationBatch(context.Background(), SendInput{ConversationID: conversation.ID, ClientRequestID: "mixed-comparison", Body: "Question"})
	if err != nil {
		t.Fatalf("start mixed comparison: %v", err)
	}
	if len(started.Batch.Targets) != 2 {
		t.Fatalf("mixed comparison targets = %d, want 2", len(started.Batch.Targets))
	}

	deadline := time.Now().Add(time.Second)
	var batch persistence.GenerationBatch
	for time.Now().Before(deadline) {
		batch, err = store.GetGenerationBatch(context.Background(), started.Batch.ID)
		if err == nil && batch.Targets[1].Generation.State == persistence.GenerationCompleted {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if err != nil {
		t.Fatalf("load mixed comparison: %v", err)
	}
	if batch.Targets[0].Generation.State != persistence.GenerationPending {
		t.Fatalf("private target state = %q, want pending browser-controlled target", batch.Targets[0].Generation.State)
	}
	if batch.Targets[1].Generation.State != persistence.GenerationCompleted {
		t.Fatalf("ordinary target state = %q, want completed", batch.Targets[1].Generation.State)
	}
	if upstream.streamCalls() != 1 {
		t.Fatalf("provider stream calls = %d, want exactly one ordinary stream", upstream.streamCalls())
	}
	if got := upstream.lastProfile().Model; got != ordinary.Model {
		t.Fatalf("ordinary stream model = %q, want %q", got, ordinary.Model)
	}
}

func TestServiceUsesTheSelectedModelForTheGenerationSnapshot(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Chat")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{
		{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "done"}, {Type: provider.EventCompleted},
	}}}
	service := NewService(store, fakeProviderSource{profile: testProfile(), secret: credentials.Secret{Value: "test-key"}}, upstream)

	started, err := service.StartGeneration(context.Background(), SendInput{
		ConversationID: conversation.ID, ProviderID: "provider-1", ModelID: "model-b", ClientRequestID: "selected-model-1", Body: "Hello",
	})
	if err != nil {
		t.Fatalf("start generation: %v", err)
	}
	if started.Generation.Snapshot.ModelID != "model-b" {
		t.Fatalf("generation snapshot model = %q, want selected model", started.Generation.Snapshot.ModelID)
	}
	waitForGeneration(t, store, started.Generation.ID, persistence.GenerationCompleted)
	if got := upstream.lastProfile().Model; got != "model-b" {
		t.Fatalf("provider model = %q, want selected model", got)
	}
}

func TestServiceUsesThePersistedActiveSelectionForSubsequentGenerations(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	if err := store.UpdateSettings(context.Background(), persistence.Settings{
		Theme: "system", Locale: "system", ActiveProviderID: "provider-1", ActiveModelID: "model-b",
	}); err != nil {
		t.Fatalf("save active selection: %v", err)
	}
	conversation, err := store.CreateConversation(context.Background(), "Chat")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{
		{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "done"}, {Type: provider.EventCompleted},
	}}}
	service := NewServiceWithSettings(store, fakeProviderSource{profile: testProfile(), secret: credentials.Secret{Value: "test-key"}}, upstream, store)

	started, err := service.StartGeneration(context.Background(), SendInput{
		ConversationID: conversation.ID, ProviderID: "stale-provider", ModelID: "stale-model", ClientRequestID: "settings-selection-1", Body: "Hello",
	})
	if err != nil {
		t.Fatalf("start generation: %v", err)
	}
	waitForGeneration(t, store, started.Generation.ID, persistence.GenerationCompleted)
	if started.Generation.Snapshot.ProviderID != "provider-1" || started.Generation.Snapshot.ModelID != "model-b" {
		t.Fatalf("generation snapshot = %#v, want persisted active selection", started.Generation.Snapshot)
	}
	if got := upstream.lastProfile().Model; got != "model-b" {
		t.Fatalf("provider model = %q, want persisted active model", got)
	}
}

func TestServiceSendsTheGlobalSystemPromptBeforeConversationMessages(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Chat")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{
		{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "done"}, {Type: provider.EventCompleted},
	}}}
	service := NewService(store, fakeProviderSource{profile: testProfile(), secret: credentials.Secret{Value: "test-key"}}, upstream)
	zero, maxTokens := 0.0, 256

	started, err := service.StartGeneration(context.Background(), SendInput{
		ConversationID: conversation.ID, ProviderID: "provider-1", ClientRequestID: "system-prompt-1", Body: "Hello", SystemPrompt: "Answer in one sentence.",
		GenerationParameters: persistence.GenerationParameters{Temperature: &zero, MaxTokens: &maxTokens},
	})
	if err != nil {
		t.Fatalf("start generation: %v", err)
	}
	waitForGeneration(t, store, started.Generation.ID, persistence.GenerationCompleted)
	messages := upstream.lastMessages()
	if len(messages) != 2 || !reflect.DeepEqual(messages[0], provider.ProviderMessage{Role: "system", Content: "Answer in one sentence."}) || !reflect.DeepEqual(messages[1], provider.ProviderMessage{Role: "user", Content: "Hello"}) {
		t.Fatalf("provider messages = %#v, want system prompt followed by user message", messages)
	}
	if started.Generation.ConfigurationSnapshot.SystemPrompt != "Answer in one sentence." || started.Generation.ConfigurationSnapshot.Temperature == nil || *started.Generation.ConfigurationSnapshot.Temperature != 0 || started.Generation.ConfigurationSnapshot.TopP != nil || started.Generation.ConfigurationSnapshot.MaxTokens == nil || *started.Generation.ConfigurationSnapshot.MaxTokens != maxTokens {
		t.Fatalf("generation configuration = %#v, want the exact direct Provider configuration", started.Generation.ConfigurationSnapshot)
	}
	if upstream.input.GenerationParameters.Temperature == nil || *upstream.input.GenerationParameters.Temperature != 0 || upstream.input.GenerationParameters.TopP != nil || upstream.input.GenerationParameters.MaxTokens == nil || *upstream.input.GenerationParameters.MaxTokens != maxTokens {
		t.Fatalf("provider parameters = %#v, want the generation configuration", upstream.input.GenerationParameters)
	}
}

func TestServiceDoesNotStartProviderAgainForAnIdempotentClientRequest(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Chat")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{
		{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "done"}, {Type: provider.EventCompleted},
	}}}
	service := NewService(store, fakeProviderSource{profile: testProfile(), secret: credentials.Secret{Value: "test-key"}}, upstream)
	input := SendInput{ConversationID: conversation.ID, ProviderID: "provider-1", ClientRequestID: "request-1", Body: "Hi"}
	first, err := service.StartGeneration(context.Background(), input)
	if err != nil {
		t.Fatalf("first start: %v", err)
	}
	waitForGeneration(t, store, first.Generation.ID, persistence.GenerationCompleted)
	second, err := service.StartGeneration(context.Background(), input)
	if err != nil {
		t.Fatalf("idempotent start: %v", err)
	}
	if second.Generation.ID != first.Generation.ID {
		t.Fatalf("idempotent generation ID = %q, want %q", second.Generation.ID, first.Generation.ID)
	}
	if upstream.streamCalls() != 1 {
		t.Fatalf("provider stream calls = %d, want 1", upstream.streamCalls())
	}
}

func TestServiceAllowsOnlyOneActiveGenerationGlobally(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	firstConversation, err := store.CreateConversation(context.Background(), "First")
	if err != nil {
		t.Fatalf("create first conversation: %v", err)
	}
	secondConversation, err := store.CreateConversation(context.Background(), "Second")
	if err != nil {
		t.Fatalf("create second conversation: %v", err)
	}
	service := NewService(store, fakeProviderSource{profile: testProfile(), secret: credentials.Secret{Value: "test-key"}}, &fakeProvider{stream: &blockingStream{}})
	first, err := service.StartGeneration(context.Background(), SendInput{ConversationID: firstConversation.ID, ProviderID: "provider-1", ClientRequestID: "request-first", Body: "First"})
	if err != nil {
		t.Fatalf("start first generation: %v", err)
	}

	second, err := service.StartGeneration(context.Background(), SendInput{ConversationID: secondConversation.ID, ProviderID: "provider-1", ClientRequestID: "request-second", Body: "Second"})
	if !errors.Is(err, ErrGenerationInProgress) {
		t.Fatalf("start second generation error = %v, want generation in progress", err)
	}
	if second.Generation.ID != "" {
		t.Fatalf("rejected generation = %#v, want no generation", second.Generation)
	}
	if _, err := service.CancelGeneration(context.Background(), first.Generation.ID); err != nil {
		t.Fatalf("cancel first generation: %v", err)
	}
}

func TestServiceDoesNotPersistAssistantBodyWhenProviderFails(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Chat")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{
		{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "partial"},
		{Type: provider.EventFailed, ErrorCode: "provider_rejected", ErrorMessage: "request refused"},
	}}}
	service := NewService(store, fakeProviderSource{profile: testProfile(), secret: credentials.Secret{Value: "test-key"}}, upstream)
	started, err := service.StartGeneration(context.Background(), SendInput{ConversationID: conversation.ID, ProviderID: "provider-1", ClientRequestID: "request-failed", Body: "Hi"})
	if err != nil {
		t.Fatalf("start generation: %v", err)
	}
	events, err := service.SubscribeGeneration(context.Background(), started.Generation.ID, "")
	if err != nil {
		t.Fatalf("subscribe failed generation: %v", err)
	}
	waitForGeneration(t, store, started.Generation.ID, persistence.GenerationFailed)
	var terminal GenerationEvent
	for event := range events {
		if event.Type == EventFailed {
			terminal = event
		}
	}
	if terminal.ErrorCode != "provider_error" || terminal.ErrorMessage != "The Provider rejected the generation request." {
		t.Fatalf("failed generation event = %#v, want safe provider error", terminal)
	}
	view, err := store.LoadConversation(context.Background(), conversation.ID)
	if err != nil {
		t.Fatalf("load conversation: %v", err)
	}
	if len(view.Messages) != 1 || view.Messages[0].Role != "user" {
		t.Fatalf("messages = %#v, want only saved user message", view.Messages)
	}
}

func TestServiceCancelWaitsForStoppedTerminalState(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Chat")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	upstream := &fakeProvider{stream: &blockingStream{}}
	service := NewService(store, fakeProviderSource{profile: testProfile(), secret: credentials.Secret{Value: "test-key"}}, upstream)
	started, err := service.StartGeneration(context.Background(), SendInput{ConversationID: conversation.ID, ProviderID: "provider-1", ClientRequestID: "request-stop", Body: "Hi"})
	if err != nil {
		t.Fatalf("start generation: %v", err)
	}
	events, err := service.SubscribeGeneration(context.Background(), started.Generation.ID, "")
	if err != nil {
		t.Fatalf("subscribe generation: %v", err)
	}
	select {
	case event := <-events:
		if event.Type != EventStarted {
			t.Fatalf("first event = %#v, want started", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for started event")
	}
	stopped, err := service.CancelGeneration(context.Background(), started.Generation.ID)
	if err != nil {
		t.Fatalf("cancel generation: %v", err)
	}
	if stopped.State != persistence.GenerationStopped {
		t.Fatalf("cancel result = %#v, want stopped", stopped)
	}
	select {
	case event := <-events:
		if event.Type != EventStopped {
			t.Fatalf("terminal event = %#v, want stopped", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for stopped event")
	}
}

func TestServiceStopsAnActiveGenerationBeforeClearingConversationHistory(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Clear after stop")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	service := NewService(store, fakeProviderSource{profile: testProfile(), secret: credentials.Secret{Value: "test-key"}}, &fakeProvider{stream: &blockingStream{}})
	started, err := service.StartGeneration(context.Background(), SendInput{ConversationID: conversation.ID, ProviderID: "provider-1", ClientRequestID: "clear-after-stop", Body: "Clear this."})
	if err != nil {
		t.Fatalf("start generation: %v", err)
	}
	events, err := service.SubscribeGeneration(context.Background(), started.Generation.ID, "")
	if err != nil {
		t.Fatalf("subscribe generation: %v", err)
	}
	select {
	case event := <-events:
		if event.Type != EventStarted {
			t.Fatalf("first event = %#v, want started", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for started event")
	}

	if err := service.ClearChatData(context.Background()); err != nil {
		t.Fatalf("clear conversation history: %v", err)
	}
	stoppedEvents := 0
	for event := range events {
		if event.Type == EventStopped {
			stoppedEvents++
		}
	}
	if stoppedEvents != 1 {
		t.Fatalf("stopped events = %d, want exactly one before history is cleared", stoppedEvents)
	}
	if _, err := store.LoadConversation(context.Background(), conversation.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("load cleared conversation error = %v, want sql.ErrNoRows", err)
	}
	if _, err := store.GetGeneration(context.Background(), started.Generation.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("load cleared generation error = %v, want sql.ErrNoRows", err)
	}
}

func TestServiceClosesAResubscribedStreamForARecoveredTerminalGeneration(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Chat")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	generation, err := store.BeginGeneration(context.Background(), persistence.BeginGenerationInput{
		ConversationID: conversation.ID, ClientRequestID: "request-recovered", Body: "Hi",
		Snapshot: persistence.ProviderSnapshot{ProviderID: "provider-1"},
	})
	if err != nil {
		t.Fatalf("begin generation: %v", err)
	}
	if err := store.TerminateGeneration(context.Background(), persistence.TerminateGenerationInput{GenerationID: generation.ID, State: persistence.GenerationFailed, ErrorCode: "interrupted"}); err != nil {
		t.Fatalf("terminate generation: %v", err)
	}
	service := NewService(store, fakeProviderSource{profile: testProfile(), secret: credentials.Secret{Value: "test-key"}}, &fakeProvider{stream: &fakeStream{}})
	events, err := service.SubscribeGeneration(context.Background(), generation.ID, "")
	if err != nil {
		t.Fatalf("subscribe recovered generation: %v", err)
	}
	select {
	case _, ok := <-events:
		if ok {
			t.Fatal("recovered terminal stream returned an event; status should be queried separately")
		}
	case <-time.After(time.Second):
		t.Fatal("recovered terminal stream did not close")
	}
}

func TestServiceTimesOutWithoutPersistingPartialAssistantBody(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Chat")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	service := NewServiceWithTimeout(store, fakeProviderSource{profile: testProfile(), secret: credentials.Secret{Value: "test-key"}}, &fakeProvider{stream: &timeoutStream{}}, 50*time.Millisecond)
	started, err := service.StartGeneration(context.Background(), SendInput{ConversationID: conversation.ID, ProviderID: "provider-1", ClientRequestID: "request-timeout", Body: "Hi"})
	if err != nil {
		t.Fatalf("start generation: %v", err)
	}
	waitForGeneration(t, store, started.Generation.ID, persistence.GenerationFailed)
	generation, err := store.GetGeneration(context.Background(), started.Generation.ID)
	if err != nil {
		t.Fatalf("load timed out generation: %v", err)
	}
	if generation.ErrorCode != "timeout" {
		t.Fatalf("timed out generation = %#v, want timeout error", generation)
	}
	view, err := store.LoadConversation(context.Background(), conversation.ID)
	if err != nil {
		t.Fatalf("load timed out conversation: %v", err)
	}
	if len(view.Messages) != 1 {
		t.Fatalf("timed out messages = %#v, want only user message", view.Messages)
	}
}

func TestServiceEmitsOnlyOneTerminalEventWhenCancellationWins(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Chat")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	stream := &cancelRaceStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventCompleted}}}
	service := NewService(store, fakeProviderSource{profile: testProfile(), secret: credentials.Secret{Value: "test-key"}}, &fakeProvider{stream: stream})
	started, err := service.StartGeneration(context.Background(), SendInput{ConversationID: conversation.ID, ProviderID: "provider-1", ClientRequestID: "request-race", Body: "Hi"})
	if err != nil {
		t.Fatalf("start generation: %v", err)
	}
	events, err := service.SubscribeGeneration(context.Background(), started.Generation.ID, "")
	if err != nil {
		t.Fatalf("subscribe generation: %v", err)
	}
	select {
	case event := <-events:
		if event.Type != EventStarted {
			t.Fatalf("first event = %#v, want started", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for started event")
	}
	stream.cancelNext()
	if _, err := service.CancelGeneration(context.Background(), started.Generation.ID); err != nil {
		t.Fatalf("cancel generation: %v", err)
	}
	terminalCount := 0
	for event := range events {
		if event.Type == EventCompleted || event.Type == EventStopped || event.Type == EventFailed {
			terminalCount++
		}
	}
	if terminalCount != 1 {
		t.Fatalf("terminal event count = %d, want 1", terminalCount)
	}
}

func TestServiceStartsIndependentTargetsForAnActiveModelSetAndStreamsOneBatch(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	if err := store.UpdateSettings(context.Background(), persistence.Settings{
		Theme: "system", Locale: "system", ActiveModelSet: []persistence.ActiveModelTarget{
			{ProviderID: "provider-a", ModelID: "model-a"},
			{ProviderID: "provider-b", ModelID: "model-b"},
		},
	}); err != nil {
		t.Fatalf("save active model set: %v", err)
	}
	conversation, err := store.CreateConversation(context.Background(), "Comparison")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	upstream := &modelStreamsProvider{streams: map[string][]provider.CompletionStream{
		"model-a": {&fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "Answer A"}, {Type: provider.EventCompleted}}}},
		"model-b": {&fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "Answer B"}, {Type: provider.EventCompleted}}}},
	}}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a", "provider-b"), upstream, store)

	started, err := service.StartGenerationBatch(context.Background(), SendInput{
		ConversationID: conversation.ID, ClientRequestID: "comparison-1", Body: "Compare this",
	})
	if err != nil {
		t.Fatalf("start generation batch: %v", err)
	}
	if len(started.Batch.Targets) != 2 {
		t.Fatalf("batch targets = %#v, want two independent targets", started.Batch.Targets)
	}
	events, err := service.SubscribeGenerationBatch(context.Background(), started.Batch.ID, "")
	if err != nil {
		t.Fatalf("subscribe generation batch: %v", err)
	}
	completed := map[string]bool{}
	for event := range events {
		if event.BatchID != started.Batch.ID || event.TargetID == "" || event.GenerationID == "" {
			t.Fatalf("batch event identity = %#v, want batch, target, and generation IDs", event)
		}
		if event.Type == EventCompleted {
			completed[event.TargetID] = true
		}
	}
	if len(completed) != 2 {
		t.Fatalf("completed target count = %d, want 2", len(completed))
	}
	batch, err := service.GetGenerationBatch(context.Background(), started.Batch.ID)
	if err != nil {
		t.Fatalf("get generation batch: %v", err)
	}
	if batch.State != persistence.GenerationBatchCompleted || batch.SelectedGenerationID != "" {
		t.Fatalf("batch = %#v, want completed comparison without a selected answer", batch)
	}
	view, err := store.LoadConversation(context.Background(), conversation.ID)
	if err != nil {
		t.Fatalf("load conversation: %v", err)
	}
	if len(view.Messages) != 3 {
		t.Fatalf("conversation messages = %#v, want one user message and two independent answers", view.Messages)
	}
}

func TestServiceRequiresAComparisonDispositionBeforeTheNextBatchAndUsesTheSelectedAnswer(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	if err := store.UpdateSettings(context.Background(), persistence.Settings{
		Theme: "system", Locale: "system", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "model-a"}, {ProviderID: "provider-b", ModelID: "model-b"}},
	}); err != nil {
		t.Fatalf("save active model set: %v", err)
	}
	conversation, err := store.CreateConversation(context.Background(), "Context")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	upstream := &modelStreamsProvider{streams: map[string][]provider.CompletionStream{
		"model-a": {
			&fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "Chosen answer"}, {Type: provider.EventCompleted}}},
			&fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "Follow-up A"}, {Type: provider.EventCompleted}}},
		},
		"model-b": {
			&fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "Other answer"}, {Type: provider.EventCompleted}}},
			&fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "Follow-up B"}, {Type: provider.EventCompleted}}},
		},
	}}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a", "provider-b"), upstream, store)
	first, err := service.StartGenerationBatch(context.Background(), SendInput{ConversationID: conversation.ID, ClientRequestID: "context-1", Body: "First question"})
	if err != nil {
		t.Fatalf("start first batch: %v", err)
	}
	waitForBatch(t, store, first.Batch.ID, persistence.GenerationBatchCompleted)
	if _, err := service.StartGenerationBatch(context.Background(), SendInput{ConversationID: conversation.ID, ClientRequestID: "context-2-blocked", Body: "Follow-up"}); !errors.Is(err, persistence.ErrContextDispositionRequired) {
		t.Fatalf("start next batch error = %v, want required context disposition", err)
	}
	if err := service.SelectGenerationAnswer(context.Background(), first.Batch.Targets[0].Generation.ID); err != nil {
		t.Fatalf("select completed answer: %v", err)
	}
	second, err := service.StartGenerationBatch(context.Background(), SendInput{ConversationID: conversation.ID, ClientRequestID: "context-2", Body: "Follow-up"})
	if err != nil {
		t.Fatalf("start follow-up batch: %v", err)
	}
	waitForBatch(t, store, second.Batch.ID, persistence.GenerationBatchCompleted)
	contextMessages, err := service.GetGenerationBatchContext(context.Background(), second.Batch.ID)
	if err != nil {
		t.Fatalf("read frozen browser context: %v", err)
	}
	if len(contextMessages) != 2 || contextMessages[0].Content != "First question" || contextMessages[1].Content != "Chosen answer" {
		t.Fatalf("browser context does not match the selected answer")
	}
	emptyContext, err := service.GetGenerationBatchContext(context.Background(), first.Batch.ID)
	if err != nil || len(emptyContext) != 0 {
		t.Fatalf("first batch context should remain empty")
	}
	if _, err := service.GetGenerationBatchContext(context.Background(), "missing-batch"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing context error = %v", err)
	}
	for _, messages := range upstream.messagesFor("model-a") {
		if reflect.DeepEqual(messages[len(messages)-1], provider.ProviderMessage{Role: "user", Content: "Follow-up"}) {
			if !containsProviderMessage(messages, provider.ProviderMessage{Role: "assistant", Content: "Chosen answer"}) || containsProviderMessage(messages, provider.ProviderMessage{Role: "assistant", Content: "Other answer"}) {
				t.Fatalf("follow-up context = %#v, want only the selected answer", messages)
			}
		}
	}
}

func TestServiceReportsAnEmptyProviderResponseWithoutMisreportingALocalSaveFailure(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	maxTokens := 512
	if err := store.UpdateSettings(context.Background(), persistence.Settings{
		Theme: "system", Locale: "system",
		GenerationParameters: persistence.GenerationParameters{MaxTokens: &maxTokens},
		ActiveModelSet:       []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "model-a"}},
	}); err != nil {
		t.Fatalf("save active model set: %v", err)
	}
	conversation, err := store.CreateConversation(context.Background(), "Empty response")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	upstream := &modelStreamsProvider{streams: map[string][]provider.CompletionStream{
		"model-a": {&fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventCompleted}}}},
	}}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a"), upstream, store)
	started, err := service.StartGenerationBatch(context.Background(), SendInput{ConversationID: conversation.ID, ClientRequestID: "empty-response-1", Body: "Question"})
	if err != nil {
		t.Fatalf("start batch: %v", err)
	}
	waitForBatch(t, store, started.Batch.ID, persistence.GenerationBatchFailed)
	batch, err := store.GetGenerationBatch(context.Background(), started.Batch.ID)
	if err != nil {
		t.Fatalf("get failed batch: %v", err)
	}
	if got := batch.Targets[0].Generation.ErrorCode; got != "empty_response" {
		t.Fatalf("error code = %q, want empty_response instead of an internal save error", got)
	}
}

func TestServiceReportsAnOutputLimitWhenAProviderCompletesWithoutContent(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	if err := store.UpdateSettings(context.Background(), persistence.Settings{
		Theme: "system", Locale: "system", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "model-a"}},
	}); err != nil {
		t.Fatalf("save active model set: %v", err)
	}
	conversation, err := store.CreateConversation(context.Background(), "Output limit")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	upstream := &modelStreamsProvider{streams: map[string][]provider.CompletionStream{
		"model-a": {&fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, FinishReason: "length"}, {Type: provider.EventCompleted, FinishReason: "length"}}}},
	}}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a"), upstream, store)
	started, err := service.StartGenerationBatch(context.Background(), SendInput{ConversationID: conversation.ID, ClientRequestID: "output-limit-1", Body: "Question"})
	if err != nil {
		t.Fatalf("start batch: %v", err)
	}
	waitForBatch(t, store, started.Batch.ID, persistence.GenerationBatchFailed)
	batch, err := store.GetGenerationBatch(context.Background(), started.Batch.ID)
	if err != nil {
		t.Fatalf("get failed batch: %v", err)
	}
	if got := batch.Targets[0].Generation.ErrorCode; got != "output_limit" {
		t.Fatalf("error code = %q, want output_limit", got)
	}
}

func TestServiceRetriesATargetWithItsFrozenModelAndCurrentConfiguration(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	temperature, topP, maxTokens := 0.25, 0.8, 1200
	if err := store.UpdateSettings(context.Background(), persistence.Settings{Theme: "system", Locale: "system", SystemPrompt: "Original retry instructions.", GenerationParameters: persistence.GenerationParameters{Temperature: &temperature, TopP: &topP, MaxTokens: &maxTokens}, ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "model-a"}}}); err != nil {
		t.Fatalf("save active model set: %v", err)
	}
	conversation, err := store.CreateConversation(context.Background(), "Retry")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	upstream := &modelStreamsProvider{streams: map[string][]provider.CompletionStream{
		"model-a": {
			&fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventFailed}}},
			&fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "Recovered"}, {Type: provider.EventCompleted}}},
		},
	}}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a"), upstream, store)
	first, err := service.StartGenerationBatch(context.Background(), SendInput{ConversationID: conversation.ID, ClientRequestID: "retry-target-1", Body: "Question"})
	if err != nil {
		t.Fatalf("start batch: %v", err)
	}
	waitForBatch(t, store, first.Batch.ID, persistence.GenerationBatchFailed)
	initialAttempt := first.Batch.Targets[0].Generation
	if initialAttempt.ConfigurationSnapshot.SystemPrompt != "Original retry instructions." || initialAttempt.ConfigurationSnapshot.Temperature == nil || *initialAttempt.ConfigurationSnapshot.Temperature != temperature || initialAttempt.ConfigurationSnapshot.TopP == nil || *initialAttempt.ConfigurationSnapshot.TopP != topP || initialAttempt.ConfigurationSnapshot.MaxTokens == nil || *initialAttempt.ConfigurationSnapshot.MaxTokens != maxTokens {
		t.Fatalf("initial configuration = %#v, want original workspace configuration", initialAttempt.ConfigurationSnapshot)
	}
	changedTemperature, changedTopP, changedMaxTokens := 1.5, 0.2, 42
	if err := store.UpdateSettings(context.Background(), persistence.Settings{Theme: "system", Locale: "system", SystemPrompt: "Changed after the original Batch.", GenerationParameters: persistence.GenerationParameters{Temperature: &changedTemperature, TopP: &changedTopP, MaxTokens: &changedMaxTokens}, ActiveModelSet: []persistence.ActiveModelTarget{}}); err != nil {
		t.Fatalf("change later settings: %v", err)
	}
	retried, err := service.RetryGenerationTarget(context.Background(), first.Batch.Targets[0].ID, "retry-target-2")
	if err != nil {
		t.Fatalf("retry target: %v", err)
	}
	if retried.Generation.GenerationTargetID != first.Batch.Targets[0].ID || retried.Generation.Snapshot.ModelID != "model-a" {
		t.Fatalf("retry generation = %#v, want the original target and model", retried.Generation)
	}
	if retried.Generation.ConfigurationSnapshot.SystemPrompt != "Changed after the original Batch." || retried.Generation.ConfigurationSnapshot.Temperature == nil || *retried.Generation.ConfigurationSnapshot.Temperature != changedTemperature || retried.Generation.ConfigurationSnapshot.TopP == nil || *retried.Generation.ConfigurationSnapshot.TopP != changedTopP || retried.Generation.ConfigurationSnapshot.MaxTokens == nil || *retried.Generation.ConfigurationSnapshot.MaxTokens != changedMaxTokens {
		t.Fatalf("retry configuration = %#v, want current workspace configuration", retried.Generation.ConfigurationSnapshot)
	}
	waitForGeneration(t, store, retried.Generation.ID, persistence.GenerationCompleted)
	calls := upstream.messagesFor("model-a")
	if len(calls) != 2 {
		t.Fatalf("provider calls = %#v, want initial and retry inputs", calls)
	}
	if !containsProviderMessage(calls[1], provider.ProviderMessage{Role: "system", Content: "Changed after the original Batch."}) || containsProviderMessage(calls[1], provider.ProviderMessage{Role: "system", Content: "Original retry instructions."}) {
		t.Fatalf("retry provider context = %#v, want the current workspace system prompt", calls[1])
	}
	parameters := upstream.parametersFor("model-a")
	if len(parameters) != 2 || parameters[1].Temperature == nil || *parameters[1].Temperature != changedTemperature || parameters[1].TopP == nil || *parameters[1].TopP != changedTopP || parameters[1].MaxTokens == nil || *parameters[1].MaxTokens != changedMaxTokens {
		t.Fatalf("retry generation parameters = %#v, want the current workspace parameters", parameters)
	}
	persistedInitial, err := store.GetGeneration(context.Background(), initialAttempt.ID)
	if err != nil {
		t.Fatalf("reload initial attempt: %v", err)
	}
	if persistedInitial.ConfigurationSnapshot.SystemPrompt != "Original retry instructions." || persistedInitial.ConfigurationSnapshot.Temperature == nil || *persistedInitial.ConfigurationSnapshot.Temperature != temperature || persistedInitial.ConfigurationSnapshot.TopP == nil || *persistedInitial.ConfigurationSnapshot.TopP != topP || persistedInitial.ConfigurationSnapshot.MaxTokens == nil || *persistedInitial.ConfigurationSnapshot.MaxTokens != maxTokens {
		t.Fatalf("persisted initial configuration = %#v, want original workspace configuration", persistedInitial.ConfigurationSnapshot)
	}
}

func TestServiceRecordsAFailedRetryAttemptWhenTheOriginalTargetIsUnavailable(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	if err := store.UpdateSettings(context.Background(), persistence.Settings{Theme: "system", Locale: "system", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "model-a"}}}); err != nil {
		t.Fatalf("save active model set: %v", err)
	}
	conversation, err := store.CreateConversation(context.Background(), "Unavailable retry")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	source := fakeProviderProfiles("provider-a")
	service := NewServiceWithSettings(store, source, &modelStreamsProvider{streams: map[string][]provider.CompletionStream{
		"model-a": {&fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventFailed}}}},
	}}, store)
	first, err := service.StartGenerationBatch(context.Background(), SendInput{ConversationID: conversation.ID, ClientRequestID: "unavailable-retry-1", Body: "Question"})
	if err != nil {
		t.Fatalf("start batch: %v", err)
	}
	waitForBatch(t, store, first.Batch.ID, persistence.GenerationBatchFailed)
	delete(source.profiles, "provider-a")

	retried, err := service.RetryGenerationTarget(context.Background(), first.Batch.Targets[0].ID, "unavailable-retry-2")
	if err != nil {
		t.Fatalf("retry target: %v", err)
	}
	stored, err := store.GetGeneration(context.Background(), retried.Generation.ID)
	if err != nil {
		t.Fatalf("load retry attempt: %v", err)
	}
	if stored.State != persistence.GenerationFailed || stored.ErrorCode != "target_unavailable" || stored.GenerationTargetID != first.Batch.Targets[0].ID {
		t.Fatalf("unavailable retry attempt = %#v, want a failed attempt for the original target", stored)
	}
}

func TestServiceReleasesSecureActivityWhenRetrySelectionBecomesUnavailable(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "chat.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(context.Background(), "Unavailable private retry")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	profile := testProfile()
	profile.ID, profile.Kind, profile.Name, profile.Model = "nearai", provider.KindNearAIPreset, "NearAI", "private-model"
	source := &rejectingProfileProviderSource{profileProviderSource: profileProviderSource{profiles: map[string]provider.Profile{"nearai": profile}}, rejectModel: "private-model"}
	service := NewServiceWithSettings(store, source, &fakeProvider{}, store)
	if err := store.UpdateSettings(context.Background(), persistence.Settings{Theme: "system", Locale: "system", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "nearai", ModelID: "private-model"}}}); err != nil {
		t.Fatalf("save active model set: %v", err)
	}
	first, err := service.StartGenerationBatch(context.Background(), SendInput{ConversationID: conversation.ID, ClientRequestID: "private-retry-1", Body: "Question"})
	if err != nil {
		t.Fatalf("start private batch: %v", err)
	}
	if _, err := service.CancelGeneration(context.Background(), first.Batch.Targets[0].Generation.ID); err != nil {
		t.Fatalf("stop initial private attempt: %v", err)
	}
	source.reject = true
	if _, err := service.RetryGenerationTarget(context.Background(), first.Batch.Targets[0].ID, "private-retry-2"); err != nil {
		t.Fatalf("retry unavailable private target: %v", err)
	}
	if service.HasActiveGenerationBatch() {
		t.Fatal("unavailable private retry left secure activity active")
	}
}

func testProfile() provider.Profile {
	return provider.Profile{
		ID: "provider-1", Kind: provider.KindOpenAICompatible, Name: "Fixture",
		Endpoint: "https://provider.example/v1", Model: "model-a", AuthMethod: provider.AuthBearer,
		RuntimeLocation: "User configured cloud provider", Destination: "provider.example", TransportSecurity: "tls", PrivacyNotice: "sent over TLS",
	}
}

func waitForGeneration(t *testing.T, store *persistence.SQLiteStore, id string, state persistence.GenerationState) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		generation, err := store.GetGeneration(context.Background(), id)
		if err == nil && generation.State == state {
			return
		}
		time.Sleep(time.Millisecond)
	}
	generation, _ := store.GetGeneration(context.Background(), id)
	t.Fatalf("generation = %#v, want state %q", generation, state)
}

func waitForBatch(t *testing.T, store *persistence.SQLiteStore, id string, state persistence.GenerationBatchState) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		batch, err := store.GetGenerationBatch(context.Background(), id)
		if err == nil && batch.State == state {
			return
		}
		time.Sleep(time.Millisecond)
	}
	batch, _ := store.GetGenerationBatch(context.Background(), id)
	t.Fatalf("generation batch = %#v, want state %q", batch, state)
}

func containsProviderMessage(messages []provider.ProviderMessage, expected provider.ProviderMessage) bool {
	for _, message := range messages {
		if reflect.DeepEqual(message, expected) {
			return true
		}
	}
	return false
}

type fakeProviderSource struct {
	profile provider.Profile
	secret  credentials.Secret
}

type profileProviderSource struct {
	profiles map[string]provider.Profile
}

type classifiedProviderSource struct {
	profileProviderSource
	metadata provider.ModelMetadata
}

func (source classifiedProviderSource) ModelMetadata(context.Context, string, string) (provider.ModelMetadata, error) {
	return source.metadata, nil
}

type rejectingProfileProviderSource struct {
	profileProviderSource
	rejectModel string
	reject      bool
}

func (source *rejectingProfileProviderSource) ValidateSelection(ctx context.Context, providerID, modelID string) error {
	if source.reject && modelID == source.rejectModel {
		return provider.ErrModelUnavailable
	}
	return source.profileProviderSource.ValidateSelection(ctx, providerID, modelID)
}

func fakeProviderProfiles(ids ...string) profileProviderSource {
	profiles := make(map[string]provider.Profile, len(ids))
	for _, id := range ids {
		profile := testProfile()
		profile.ID = id
		profile.Name = id
		profiles[id] = profile
	}
	return profileProviderSource{profiles: profiles}
}

func (source profileProviderSource) Resolve(_ context.Context, providerID string) (provider.Profile, credentials.Secret, error) {
	profile, ok := source.profiles[providerID]
	if !ok {
		return provider.Profile{}, credentials.Secret{}, providerconfigErrModelUnavailable{}
	}
	return profile, credentials.Secret{Value: "test-key"}, nil
}

func (source profileProviderSource) ValidateSelection(_ context.Context, providerID, modelID string) error {
	if _, ok := source.profiles[providerID]; !ok || modelID == "" {
		return provider.ErrModelUnavailable
	}
	return nil
}

// providerconfigErrModelUnavailable keeps the test source's failure separate
// from provider.Stream; production sources return their own resolver errors.
type providerconfigErrModelUnavailable struct{}

func (providerconfigErrModelUnavailable) Error() string { return "model unavailable" }

func (source fakeProviderSource) Resolve(context.Context, string) (provider.Profile, credentials.Secret, error) {
	return source.profile, source.secret, nil
}

func (source fakeProviderSource) ValidateSelection(_ context.Context, providerID, modelID string) error {
	if providerID == "" || modelID == "" {
		return provider.ErrModelUnavailable
	}
	return nil
}

type fakeProvider struct {
	mu     sync.Mutex
	stream provider.CompletionStream
	calls  int
	input  provider.CompletionInput
}

type modelStreamsProvider struct {
	mu         sync.Mutex
	streams    map[string][]provider.CompletionStream
	messages   map[string][][]provider.ProviderMessage
	parameters map[string][]provider.GenerationParameters
}

func (fake *modelStreamsProvider) Validate(context.Context, provider.ValidateInput) (provider.ValidationResult, error) {
	return provider.ValidationResult{}, nil
}

func (fake *modelStreamsProvider) Stream(_ context.Context, input provider.CompletionInput) (provider.CompletionStream, error) {
	fake.mu.Lock()
	defer fake.mu.Unlock()
	queue := fake.streams[input.Profile.Model]
	if len(queue) == 0 {
		return nil, errors.New("no stream configured for model")
	}
	fake.streams[input.Profile.Model] = queue[1:]
	if fake.messages == nil {
		fake.messages = make(map[string][][]provider.ProviderMessage)
	}
	fake.messages[input.Profile.Model] = append(fake.messages[input.Profile.Model], append([]provider.ProviderMessage(nil), input.Messages...))
	if fake.parameters == nil {
		fake.parameters = make(map[string][]provider.GenerationParameters)
	}
	fake.parameters[input.Profile.Model] = append(fake.parameters[input.Profile.Model], input.GenerationParameters)
	return queue[0], nil
}

func (fake *modelStreamsProvider) messagesFor(model string) [][]provider.ProviderMessage {
	fake.mu.Lock()
	defer fake.mu.Unlock()
	result := make([][]provider.ProviderMessage, len(fake.messages[model]))
	for index, messages := range fake.messages[model] {
		result[index] = append([]provider.ProviderMessage(nil), messages...)
	}
	return result
}

func (fake *modelStreamsProvider) parametersFor(model string) []provider.GenerationParameters {
	fake.mu.Lock()
	defer fake.mu.Unlock()
	return append([]provider.GenerationParameters(nil), fake.parameters[model]...)
}

func (fake *fakeProvider) Validate(context.Context, provider.ValidateInput) (provider.ValidationResult, error) {
	return provider.ValidationResult{}, nil
}

func (fake *fakeProvider) Stream(_ context.Context, input provider.CompletionInput) (provider.CompletionStream, error) {
	fake.mu.Lock()
	fake.input = input
	fake.calls++
	fake.mu.Unlock()
	return fake.stream, nil
}

func (fake *fakeProvider) lastMessages() []provider.ProviderMessage {
	fake.mu.Lock()
	defer fake.mu.Unlock()
	return append([]provider.ProviderMessage(nil), fake.input.Messages...)
}

func (fake *fakeProvider) lastProfile() provider.Profile {
	fake.mu.Lock()
	defer fake.mu.Unlock()
	return fake.input.Profile
}

func (fake *fakeProvider) streamCalls() int {
	fake.mu.Lock()
	defer fake.mu.Unlock()
	return fake.calls
}

type fakeStream struct {
	mu     sync.Mutex
	events []provider.Event
	closed bool
}

type blockingStream struct {
	started bool
}

func (stream *blockingStream) Recv(ctx context.Context) (provider.Event, error) {
	if stream == nil {
		return provider.Event{}, context.Canceled
	}
	if !stream.started {
		stream.started = true
		return provider.Event{Type: provider.EventStarted}, nil
	}
	select {
	case <-ctx.Done():
		return provider.Event{}, ctx.Err()
	}
}

func (*blockingStream) Close() error { return nil }

type timeoutStream struct{}

func (*timeoutStream) Recv(ctx context.Context) (provider.Event, error) {
	<-ctx.Done()
	return provider.Event{}, ctx.Err()
}

func (*timeoutStream) Close() error { return nil }

type cancelRaceStream struct {
	mu     sync.Mutex
	events []provider.Event
	cancel bool
}

func (stream *cancelRaceStream) Recv(ctx context.Context) (provider.Event, error) {
	stream.mu.Lock()
	defer stream.mu.Unlock()
	if len(stream.events) == 0 {
		return provider.Event{}, context.Canceled
	}
	event := stream.events[0]
	stream.events = stream.events[1:]
	if stream.cancel {
		return event, nil
	}
	select {
	case <-ctx.Done():
		return provider.Event{}, ctx.Err()
	default:
		return event, nil
	}
}

func (stream *cancelRaceStream) cancelNext() {
	stream.mu.Lock()
	defer stream.mu.Unlock()
	stream.cancel = true
}

func (*cancelRaceStream) Close() error { return nil }

func (stream *fakeStream) Recv(context.Context) (provider.Event, error) {
	stream.mu.Lock()
	defer stream.mu.Unlock()
	if len(stream.events) == 0 {
		return provider.Event{}, context.Canceled
	}
	event := stream.events[0]
	stream.events = stream.events[1:]
	return event, nil
}

func (stream *fakeStream) Close() error {
	stream.mu.Lock()
	defer stream.mu.Unlock()
	stream.closed = true
	return nil
}

func TestBatchAndRetryPreservePrivateTEERequirement(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(ctx, "Private selection")
	if err != nil {
		t.Fatal(err)
	}
	profile := testProfile()
	profile.ID, profile.Kind = "nearai", provider.KindNearAIPreset
	source := &classifiedProviderSource{
		profileProviderSource: profileProviderSource{profiles: map[string]provider.Profile{profile.ID: profile}},
		metadata:              provider.ModelMetadata{ID: profile.Model, PrivacyMode: provider.PrivacyModeIncognito},
	}
	service := NewService(store, source, &fakeProvider{})
	input := SendInput{
		ConversationID: conversation.ID, ClientRequestID: "require-private", Body: "Question",
		ProviderID: profile.ID, ModelID: profile.Model,
		ExpectedTargets: []ExpectedGenerationTarget{{ProviderID: profile.ID, ModelID: profile.Model, RequirePrivateTEE: true}},
	}
	if _, err := service.StartGenerationBatch(ctx, input); !errors.Is(err, ErrPrivateTEEUnavailable) {
		t.Fatalf("starting a required Private TEE batch returned %v", err)
	}
	if _, err := store.GetGenerationBatchByClientRequestID(ctx, input.ClientRequestID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("declined submission changed conversation state: %v", err)
	}
	source.metadata.PrivacyMode, source.metadata.Verifiable = provider.PrivacyModePrivateTEE, true
	started, err := service.StartGenerationBatch(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.CancelGeneration(ctx, started.Batch.Targets[0].Generation.ID); err != nil {
		t.Fatal(err)
	}
	source.metadata.PrivacyMode, source.metadata.Verifiable = provider.PrivacyModeIncognito, false
	for _, requestID := range []string{"retry-private", "retry-private-again"} {
		retry, err := service.RetryGenerationTarget(ctx, started.Batch.Targets[0].ID, requestID)
		if err != nil {
			t.Fatal(err)
		}
		if retry.Generation.State != persistence.GenerationFailed ||
			retry.Generation.ErrorCode != "private_tee_unavailable" ||
			retry.Generation.Snapshot.PrivacyMode != provider.PrivacyModePrivateTEE {
			t.Fatal("retry did not preserve its original Private TEE requirement")
		}
	}
}
