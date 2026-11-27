package chat

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func TestAppTaskAdmissionReplayAndCancellationAreIndependentOfChat(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	err = store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		if err := tx.AddRelease(persistence.AppRelease{ID: "release", Origin: "local", Digest: "hash", Manifest: json.RawMessage("{}")}); err != nil {
			return err
		}
		return tx.SaveInstance(persistence.AppInstance{ID: "book", Name: "Book", ReleaseID: "release", Revision: 1, Enabled: true, Grants: json.RawMessage("[]")})
	})
	if err != nil {
		t.Fatal(err)
	}
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
