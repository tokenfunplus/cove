package chat

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func appTaskStore(t *testing.T) *persistence.SQLiteStore {
	t.Helper()
	ctx := t.Context()
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	err = store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		if err := tx.AddRelease(persistence.AppRelease{ID: "release", Origin: "local", Digest: "hash", Manifest: json.RawMessage("{}")}); err != nil {
			return err
		}
		return tx.SaveInstance(persistence.AppInstance{ID: "book", Name: "Book", ReleaseID: "release", Revision: 1, Enabled: true, Grants: json.RawMessage("[]")})
	})
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func TestAppTaskAdmissionReplayAndCancellationAreIndependentOfChat(t *testing.T) {
	ctx := t.Context()
	store := appTaskStore(t)
	p := testProfile()
	upstream := &fakeProvider{stream: &timeoutStream{}}
	s := NewServiceWithTimeout(store, fakeProviderSource{profile: p}, upstream, time.Minute)
	defer s.StopAppTask("", "")
	in := AppTaskInput{Instance: "book", ID: "job", Fingerprint: "a", Request: "{}", Prompt: "sample", ProviderID: p.ID, ModelID: p.Model, Destination: p.Endpoint, LocalOnly: true}
	allow := func() error { return nil }
	if _, err := s.StartAppTask(ctx, in, allow); !errors.Is(err, ErrLocalOnly) {
		t.Fatal(err)
	}
	in.LocalOnly = false
	in.Destination = "https://other.example"
	if _, err := s.StartAppTask(ctx, in, allow); !errors.Is(err, ErrAppDestination) {
		t.Fatal(err)
	}
	in.Destination = p.Endpoint
	if task, err := s.StartAppTask(ctx, in, allow); err != nil || task.State != "running" {
		t.Fatal(task, err)
	}
	if _, err := s.StartAppTask(ctx, in, allow); err != nil {
		t.Fatal("idempotent replay", err)
	}
	if !s.HasActiveGenerationBatch() || !errors.Is(s.requireGenerationIdle(ctx), ErrGenerationBatchInProgress) {
		t.Fatal("chat admission ignored model job")
	}
	s.StopAppTask("another-book", "job")
	if !s.HasActiveGenerationBatch() {
		t.Fatal("cancelled another instance's job")
	}
	s.StopAppTask("book", "job")
	task, err := store.AppTask(ctx, "book", "job")
	if err != nil || task.State != "cancelled" {
		t.Fatal(task, err)
	}
	if err := s.requireGenerationIdle(ctx); err != nil {
		t.Fatal(err)
	}
	upstream.stream = &fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "candidate"}, {Type: provider.EventCompleted}}}
	in.ID = "next"
	if _, err := s.StartAppTask(ctx, in, allow); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for s.HasActiveGenerationBatch() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	task, err = store.AppTask(ctx, "book", "next")
	if err != nil || task.Result != "candidate" || task.State != "completed" {
		t.Fatal(task, err)
	}
	history, err := store.ListConversations(ctx)
	if err != nil || len(history) != 0 {
		t.Fatal("app job created a conversation", err)
	}
}

func TestNativeAppProposalProducesEditableInputs(t *testing.T) {
	delta := provider.ToolCallDelta{Index: 0}
	delta.ID = "tool_1"
	delta.Type = "function"
	delta.Function.Name = "choice_1"
	delta.Function.Arguments = `{"title":`
	rest := provider.ToolCallDelta{Index: 0}
	rest.Function.Arguments = `"An essay"}`
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{
		{Type: provider.EventDelta, ToolCalls: []provider.ToolCallDelta{delta}},
		{Type: provider.EventDelta, ToolCalls: []provider.ToolCallDelta{rest}},
		{Type: provider.EventCompleted},
	}}}
	s := &Service{provider: upstream}
	result, err := s.readAppCompletion(t.Context(), provider.CompletionInput{Tools: []provider.Tool{{Type: "function", Function: provider.ToolFunction{Name: "choice_1"}}}})
	if err != nil || result != `{"action":"choice_1","inputs":{"title":"An essay"}}` {
		t.Fatal(result, err)
	}
}

type stalledAppCatalog struct {
	fakeProviderSource
	entered chan struct{}
	release chan struct{}
}

func (catalog stalledAppCatalog) ResolveCatalogAt(ctx context.Context, id, destination string) (provider.Profile, credentials.Secret, []provider.ModelMetadata, error) {
	close(catalog.entered)
	select {
	case <-catalog.release:
		return catalog.profile, catalog.secret, []provider.ModelMetadata{{ID: catalog.profile.Model}}, nil
	case <-ctx.Done():
		return provider.Profile{}, credentials.Secret{}, nil, ctx.Err()
	}
}

func TestAppDiscoveryAllowsChatAndHonorsGrantChanges(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	store := appTaskStore(t)
	profile := testProfile()
	catalog := stalledAppCatalog{fakeProviderSource{profile: profile}, make(chan struct{}), make(chan struct{})}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "Answer"}, {Type: provider.EventCompleted}}}}
	s := NewServiceWithTimeout(store, catalog, upstream, time.Minute)
	defer s.StopAppTask("", "")
	var grantChanges sync.Mutex
	allowed := true
	revoked := errors.New("grant revoked")
	in := AppTaskInput{Instance: "book", ID: "job", Fingerprint: "fixture", Prompt: "Material", Request: "{}",
		ProviderID: profile.ID, ModelID: profile.Model, Destination: profile.Endpoint, InstanceChanges: &grantChanges}
	result := make(chan error, 1)
	go func() {
		_, err := s.StartAppTask(ctx, in, func() error {
			if !allowed {
				return revoked
			}
			return nil
		})
		result <- err
	}()
	select {
	case <-catalog.entered:
	case err := <-result:
		t.Fatalf("catalog was never reached: %v", err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	conversation, err := store.CreateConversation(ctx, "Independent chat")
	if err != nil {
		t.Fatal(err)
	}
	start, err := s.StartGenerationBatch(ctx, SendInput{ConversationID: conversation.ID, ClientRequestID: "chat-send", Body: "Question", ProviderID: profile.ID, ModelID: profile.Model})
	if err != nil {
		t.Fatalf("independent chat during catalog discovery: %v", err)
	}
	waitForBatch(t, store, start.Batch.ID, persistence.GenerationBatchCompleted)
	if !grantChanges.TryLock() {
		t.Fatal("app discovery held the instance grant lock")
	}
	allowed = false
	grantChanges.Unlock()
	close(catalog.release)
	if err := <-result; !errors.Is(err, revoked) {
		t.Fatalf("task admitted after revocation: %v", err)
	}
	if upstream.streamCalls() != 1 {
		t.Fatalf("wanted only the Chat completion, got %d", upstream.streamCalls())
	}
	if _, found, err := store.FindAppTask(ctx, "book", "job"); found || err != nil {
		t.Fatalf("unexpected persisted job: found=%v error=%v", found, err)
	}
}
