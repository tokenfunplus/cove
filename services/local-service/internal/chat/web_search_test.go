package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"github.com/tokenfunplus/cove/services/local-service/internal/websearch"
)

type webFixtureTransport func(*http.Request) (*http.Response, error)

func (f webFixtureTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type webFixtureProvider struct{ requests atomic.Int32 }

func (*webFixtureProvider) Validate(context.Context, provider.ValidateInput) (provider.ValidationResult, error) {
	return provider.ValidationResult{}, nil
}
func (p *webFixtureProvider) Stream(_ context.Context, input provider.CompletionInput) (provider.CompletionStream, error) {
	count := int(p.requests.Add(1)) - 1
	events := []provider.Event{}
	if count%4 < 3 {
		if len(input.Tools) != 2 {
			return nil, fmt.Errorf("missing tools")
		}
		call := provider.ToolCall{ID: fmt.Sprintf("tool-%d", count), Type: "function"}
		call.Function.Name = "web_search"
		call.Function.Arguments = `{"query":"evidence"}`
		if count%4 == 2 {
			call.Function.Arguments = `{"query":"different query"}`
		}
		events = append(events, provider.Event{Type: provider.EventDelta, Delta: "I will research.", ReasoningDelta: "internal", ToolCalls: []provider.ToolCallDelta{{Index: 0, ToolCall: call}}})
	} else {
		if len(input.Tools) != 0 {
			return nil, fmt.Errorf("tools remained enabled after budget")
		}
		var result struct {
			Sources []documents.Snapshot `json:"sources"`
		}
		found := false
		for _, message := range input.Messages {
			if message.Role == "tool" && json.Unmarshal([]byte(message.Content), &result) == nil && len(result.Sources) > 0 {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("source absent from continuation")
		}
		events = append(events, provider.Event{Type: provider.EventDelta, Delta: fmt.Sprintf("Answer [Evidence](cove:%s:L1)", result.Sources[0].ID)})
	}
	tokens := int64(1)
	events = append(events, provider.Event{Type: provider.EventCompleted, Usage: &provider.TokenUsage{InputTokens: &tokens, OutputTokens: &tokens}})
	return &fakeStream{events: events}, nil
}

func TestAutonomousWebSearchBudgetsCacheRetryAndBranchEvidence(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "web.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.UpdateSettings(ctx, persistence.Settings{Theme: "system", Locale: "en", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "a"}}}); err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, "Research")
	if err != nil {
		t.Fatal(err)
	}
	var network atomic.Int32
	search := websearch.NewService(store, credentials.NewMemoryStore(), &http.Client{Transport: webFixtureTransport(func(*http.Request) (*http.Response, error) {
		network.Add(1)
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"results":[{"title":"Evidence","url":"https://example.com/evidence","content":"Saved evidence"}]}`))}, nil
	})})
	policy := websearch.Defaults()
	policy.MaxSearches = 1
	policy.MaxRounds = 3
	if err := search.Save(ctx, policy, "synthetic-key"); err != nil {
		t.Fatal(err)
	}
	upstream := &webFixtureProvider{}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a"), upstream, store)
	service.SetWebSearchService(search)
	batch, err := service.StartGenerationBatch(ctx, SendInput{ConversationID: conversation.ID, ClientRequestID: "search-1", Body: "Research", WebSearchEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, batch.Batch.ID)
	saved, err := store.GetGenerationBatch(ctx, batch.Batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	generation := saved.Targets[0].Generation
	if generation.State != persistence.GenerationCompleted {
		t.Fatalf("generation failed: %s %s", generation.ErrorCode, generation.ErrorMessage)
	}
	info := generation.WebSearch
	if info == nil || info.Searches != 1 || len(info.Steps) != 3 || !info.Steps[1].Cached || info.Steps[2].Status != "limit" || len(info.Sources) != 1 || network.Load() != 2 {
		t.Fatal("request budgets or cache violated")
	}
	if generation.Metrics == nil || generation.Metrics.InputTokens == nil || *generation.Metrics.InputTokens != 4 {
		t.Fatal("intermediate model usage not aggregated")
	}
	view, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Messages) != 2 || strings.Contains(view.Messages[1].Body, "I will research") || len(view.Messages[1].WebSources) != 1 {
		t.Fatal("final answer or evidence not persisted")
	}
	if _, err := service.RetryGenerationTarget(ctx, saved.Targets[0].ID, "search-retry"); err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, batch.Batch.ID)
	saved, err = store.GetGenerationBatch(ctx, batch.Batch.ID)
	if err != nil || saved.Targets[0].Generation.WebSearch.Searches != 1 || network.Load() != 3 {
		t.Fatal("retry failed to obtain an independent budget")
	}
	// A following turn captures cited source text from the selected answer.
	upstream.requests.Store(0)
	follow, err := service.StartGenerationBatch(ctx, SendInput{ConversationID: conversation.ID, ClientRequestID: "search-follow", Body: "Follow up", WebSearchEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, follow.Batch.ID)
	contextItems, err := service.GetGenerationBatchContext(ctx, follow.Batch.ID)
	if err != nil || len(contextItems) != 2 || !strings.Contains(contextItems[1].Content, "Saved evidence") {
		t.Fatal("selected answer context lost source text")
	}
	upstream.requests.Store(0)
	branch, err := service.StartGenerationBatch(ctx, SendInput{ConversationID: conversation.ID, EditOfBatchID: follow.Batch.ID, ClientRequestID: "search-branch", Body: "Branched follow up", WebSearchEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, branch.Batch.ID)
	if err := service.DeleteConversation(ctx, conversation.ID); err != nil {
		t.Fatal(err)
	}
	branchView, err := store.LoadConversation(ctx, branch.Batch.ConversationID)
	if err != nil || len(branchView.Messages) < 2 || len(branchView.Messages[1].WebSources) != 1 {
		t.Fatal("branch lost independent source snapshots")
	}
	copied := branchView.GenerationBatches[0]
	if _, err := store.LoadAttachmentData(ctx, copied.ID, branchView.Messages[1].WebSources[0].ID); err != nil {
		t.Fatal("branch lost original source bytes")
	}
}

func TestCancellationAbortsWebNetworkAndRejectsUnverifiedPrivateTools(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cancel.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(ctx, "Cancel research")
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	aborted := make(chan struct{})
	search := websearch.NewService(store, credentials.NewMemoryStore(), &http.Client{Transport: webFixtureTransport(func(request *http.Request) (*http.Response, error) {
		var data struct {
			Query string `json:"query"`
		}
		_ = json.NewDecoder(request.Body).Decode(&data)
		if data.Query == "Web search connection test" {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"results":[]}`))}, nil
		}
		close(started)
		<-request.Context().Done()
		close(aborted)
		return nil, request.Context().Err()
	})})
	policy := websearch.Defaults()
	if err := search.Save(ctx, policy, "synthetic-key"); err != nil {
		t.Fatal(err)
	}
	batch, err := store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{ConversationID: conversation.ID, ClientRequestID: "cancel-search", Body: "Research", WebSearch: &policy, Targets: []persistence.GenerationTargetInput{{ProviderID: "fixture", ModelID: "a", Snapshot: persistence.ProviderSnapshot{ProviderID: "fixture", ModelID: "a"}}}})
	if err != nil {
		t.Fatal(err)
	}
	service := NewServiceWithSettings(store, fakeProviderProfiles("fixture"), &webFixtureProvider{}, store)
	service.SetWebSearchService(search)
	call := provider.ToolCall{ID: "cancel-tool", Type: "function"}
	call.Function.Name = "web_search"
	call.Function.Arguments = `{"query":"wait"}`
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		_, _ = service.ExecuteWebTool(ctx, batch.Targets[0].Generation.ID, WebToolInput{Call: call})
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("tool did not start")
	}
	if _, err := service.CancelGeneration(ctx, batch.Targets[0].Generation.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-aborted:
	case <-time.After(time.Second):
		t.Fatal("network not cancelled")
	}
	<-finished
	current, err := store.GetGeneration(ctx, batch.Targets[0].Generation.ID)
	if err != nil || current.WebSearch == nil || current.WebSearch.Searches != 1 || current.WebSearch.Steps[0].Status == "running" {
		t.Fatal("cancelled tool remained active")
	}
	if err := store.SkipGenerationBatchContext(ctx, batch.ID); err != nil {
		t.Fatal(err)
	}
	private, err := store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{ConversationID: conversation.ID, ClientRequestID: "unverified", Body: "Research", WebSearch: &policy, Targets: []persistence.GenerationTargetInput{{ProviderID: "nearai", ModelID: "private", Snapshot: persistence.ProviderSnapshot{ProviderID: "nearai", ProviderKind: "nearai", ModelID: "private", PrivacyMode: "private_tee"}}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ExecuteWebTool(ctx, private.Targets[0].Generation.ID, WebToolInput{Call: call}); err == nil {
		t.Fatal("unverified private tool request accepted")
	}
	run, err := store.GetWebSearchRun(ctx, private.Targets[0].Generation.ID)
	if err != nil || run.Searches != 0 {
		t.Fatal("unverified request spent budget")
	}
}
