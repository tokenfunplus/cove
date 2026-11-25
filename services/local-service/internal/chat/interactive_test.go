package chat

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestInteractiveContinuationUsesAuthoritativeInputAndReplay(t *testing.T) {
	ctx := context.Background()
	store, e := persistence.OpenSQLite(filepath.Join(t.TempDir(), "card.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	if e = store.UpdateSettings(ctx, persistence.Settings{Theme: "system", Locale: "en", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "model-a"}}}); e != nil {
		t.Fatal(e)
	}
	c, e := store.CreateConversation(ctx, "Story")
	if e != nil {
		t.Fatal(e)
	}
	b, e := store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{Interactive: true, ConversationID: c.ID, ClientRequestID: "source", Body: "Story", Targets: []persistence.GenerationTargetInput{{ProviderID: "provider-a", ModelID: "model-a", Snapshot: persistence.ProviderSnapshot{ProviderID: "provider-a", ModelID: "model-a"}}}})
	if e != nil {
		t.Fatal(e)
	}
	raw, e := os.ReadFile("../../../../packages/api-contract/fixtures/interactive-cards.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixtures struct{ Valid []struct{ Source string } }
	json.Unmarshal(raw, &fixtures)
	if e = store.CompleteGeneration(ctx, persistence.CompleteGenerationInput{GenerationID: b.Targets[0].Generation.ID, Body: "```cove-card-v1\n" + fixtures.Valid[0].Source + "\n```"}); e != nil {
		t.Fatal(e)
	}
	run, e := store.MaterializeCard(ctx, b.Targets[0].Generation.ID)
	if e != nil {
		t.Fatal(e)
	}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "Next scene"}, {Type: provider.EventCompleted}}}}
	s := NewServiceWithSettings(store, fakeProviderProfiles("provider-a"), upstream, store)
	input := SendInput{Interactive: true, ConversationID: c.ID, ClientRequestID: "continue", Body: "Explain my choice", Card: &interactive.Submission{GenerationID: run.GenerationID, Revision: run.Revision, Values: map[string]any{"next_action": "radio"}, Checks: map[string]string{}}}
	started, e := s.StartGenerationBatch(ctx, input)
	if e != nil {
		t.Fatal(e)
	}
	if !started.Batch.Interactive || !strings.Contains(started.Batch.InputContent, "interaction-v1") {
		t.Fatal("snapshot missing")
	}
	for i := 0; i < 100; i++ {
		g, _ := store.GetGeneration(ctx, started.Batch.Targets[0].Generation.ID)
		if g.State == persistence.GenerationCompleted {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	upstream.mu.Lock()
	request := upstream.input
	upstream.mu.Unlock()
	if request.Messages[len(request.Messages)-1].Content != started.Batch.InputContent || !strings.Contains(request.Messages[0].Content, "[Cove interactive replies v2]") {
		t.Fatal("Provider did not receive captured interactive policy and snapshot")
	}
	contextItems, e := s.GetGenerationBatchContext(ctx, started.Batch.ID)
	if e != nil || len(contextItems) != 2 {
		t.Fatal("browser history snapshot differs", e)
	}
	replay, e := s.StartGenerationBatch(ctx, input)
	if e != nil || replay.Batch.ID != started.Batch.ID {
		t.Fatal("replay failed", e)
	}
	input.Card.Values = map[string]any{"next_action": "footprints"}
	if _, e = s.StartGenerationBatch(ctx, input); !errors.Is(e, persistence.ErrCardConflict) {
		t.Fatal("changed replay was accepted", e)
	}
	input.ClientRequestID = "second-window"
	if _, e = s.StartGenerationBatch(ctx, input); !errors.Is(e, persistence.ErrCardConflict) {
		t.Fatal("second window reused run", e)
	}
}

func TestDiscussionPreviewMatchesProviderAndPreservesAttachments(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "discussion.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err = store.UpdateSettings(ctx, persistence.Settings{Theme: "system", Locale: "en", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "model-a"}}}); err != nil {
		t.Fatal(err)
	}
	c, err := store.CreateConversation(ctx, "Discussion")
	if err != nil {
		t.Fatal(err)
	}
	b, err := store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{Interactive: true, ConversationID: c.ID, ClientRequestID: "source", Body: "Choices", Targets: []persistence.GenerationTargetInput{{ProviderID: "provider-a", ModelID: "model-a", Snapshot: persistence.ProviderSnapshot{ProviderID: "provider-a", ModelID: "model-a"}}}})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../../../packages/api-contract/fixtures/interactive-cards.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct{ Valid []struct{ Source string } }
	json.Unmarshal(raw, &fixtures)
	if err = store.CompleteGeneration(ctx, persistence.CompleteGenerationInput{GenerationID: b.Targets[0].Generation.ID, Body: "```cove-card-v1\n" + fixtures.Valid[0].Source + "\n```"}); err != nil {
		t.Fatal(err)
	}
	run, err := store.MaterializeCard(ctx, b.Targets[0].Generation.ID)
	if err != nil {
		t.Fatal(err)
	}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "An explanation"}, {Type: provider.EventCompleted}}}}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a"), upstream, store)
	input := SendInput{Interactive: true, ConversationID: c.ID, ClientRequestID: "discussion", Body: "Explain these unfinished choices", Card: &interactive.Submission{Intent: "discuss", GenerationID: run.GenerationID, Revision: run.Revision, Values: run.Values, Checks: run.Checks}, Attachments: []documents.Input{{Name: "note.txt", Data: []byte("A reference note")}}}
	input.Card.Intent = "invalid"
	if _, err = service.PreviewGenerationContext(ctx, input); !errors.Is(err, interactive.ErrInvalid) {
		t.Fatal("invalid discussion intent accepted", err)
	}
	input.Card.Intent = "discuss"
	preview, err := service.PreviewGenerationContext(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	started, err := service.StartGenerationBatch(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if len(started.Batch.Attachments) != 1 || !strings.Contains(started.Batch.InputContent, "A reference note") || !strings.Contains(started.Batch.InputContent, `"intent":"discuss"`) || preview[len(preview)-1].Content != started.Batch.InputContent {
		t.Fatal("preview or attachment diverged")
	}
	for i := 0; i < 100; i++ {
		g, _ := store.GetGeneration(ctx, started.Batch.Targets[0].Generation.ID)
		if g.State == persistence.GenerationCompleted {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	upstream.mu.Lock()
	request := upstream.input
	upstream.mu.Unlock()
	if request.Messages[len(request.Messages)-1].Content != started.Batch.InputContent {
		t.Fatal("Provider context mismatch")
	}
	view, err := store.LoadConversation(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, m := range view.Messages {
		if m.ID == started.Batch.UserMessageID && m.Body == input.Body {
			found = true
		}
	}
	if !found {
		t.Fatal("typed question was replaced by a canned selection summary")
	}
	replay, err := service.StartGenerationBatch(ctx, input)
	if err != nil || replay.Batch.ID != started.Batch.ID {
		t.Fatal("discussion replay failed", err)
	}
	input.Attachments[0].Data = []byte("Changed reference note")
	if _, err = service.StartGenerationBatch(ctx, input); !errors.Is(err, persistence.ErrCardConflict) {
		t.Fatal("changed attachment replay accepted", err)
	}
	input.Card.Intent = "invalid"
	input.ClientRequestID = "invalid-intent"
	if _, err = service.StartGenerationBatch(ctx, input); err == nil {
		t.Fatal("invalid intent accepted")
	}
}

func TestInteractiveModelCapacityPolicy(t *testing.T) {
	// The managed model identity is rejected without resolving credentials or starting a worker.
	s := &Service{}
	if s.interactiveTargets(context.Background(), []persistence.ActiveModelTarget{{ProviderID: "cove-local", ModelID: "qwen-fixture"}}) {
		t.Fatal("managed tiny model received interactive guide")
	}
	if s.interactiveTargets(context.Background(), nil) {
		t.Fatal("empty target set eligible")
	}
}
