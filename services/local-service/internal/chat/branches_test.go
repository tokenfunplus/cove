package chat

import (
	"context"
	"errors"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestEditedGenerationUsesSourceAttachmentsAndOnlyRequestedActiveModels(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "edited.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.UpdateSettings(ctx, persistence.Settings{Theme: "system", Locale: "en", SystemPrompt: "Current instructions", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "model-a"}, {ProviderID: "provider-b", ModelID: "model-b"}}}); err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, "Source")
	if err != nil {
		t.Fatal(err)
	}
	sourceFile, err := documents.Parse(ctx, documents.Input{Name: "source.txt", Data: []byte("Unchanged source bytes")})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{ConversationID: conversation.ID, ClientRequestID: "source", Body: "Original prompt", InputContent: documents.Prompt("Original prompt", []documents.Prepared{sourceFile}), Attachments: []documents.Prepared{sourceFile}, Targets: []persistence.GenerationTargetInput{{ProviderID: "provider-a", ModelID: "model-a", Snapshot: persistence.ProviderSnapshot{ProviderID: "provider-a", ModelID: "model-a"}}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteGeneration(ctx, persistence.CompleteGenerationInput{GenerationID: source.Targets[0].Generation.ID, Body: "Original answer"}); err != nil {
		t.Fatal(err)
	}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "Edited answer"}, {Type: provider.EventCompleted}}}}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a", "provider-b"), upstream, store)
	request := SendInput{ConversationID: conversation.ID, ClientRequestID: "edited", EditOfBatchID: source.ID, Body: "Edited prompt", ExpectedTargets: []ExpectedGenerationTarget{{ProviderID: "provider-b", ModelID: "model-b"}}}
	started, err := service.StartGenerationBatch(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(started.Batch.Targets) != 1 || started.Batch.Targets[0].ModelID != "model-b" || started.Batch.ConversationID == conversation.ID {
		t.Fatalf("edited selection = %#v", started.Batch)
	}
	for i := 0; i < 100; i++ {
		generation, err := store.GetGeneration(ctx, started.Batch.Targets[0].Generation.ID)
		if err != nil {
			t.Fatal(err)
		}
		if generation.State == persistence.GenerationCompleted {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	upstream.mu.Lock()
	input := upstream.input
	upstream.mu.Unlock()
	if len(input.Messages) != 2 || input.Messages[0].Content != "Current instructions" || !strings.Contains(input.Messages[1].Content, "Edited prompt") || !strings.Contains(input.Messages[1].Content, "Unchanged source bytes") || strings.Contains(input.Messages[1].Content, "Original prompt") {
		t.Fatalf("edited input = %#v", input.Messages)
	}
	saved, err := store.LoadBatchAttachments(ctx, started.Batch.ID)
	if err != nil || len(saved) != 1 || saved[0].Snapshot.ID != sourceFile.Snapshot.ID {
		t.Fatalf("reused source = %#v %v", saved, err)
	}
	request.ClientRequestID = "outside-set"
	request.ExpectedTargets[0].ModelID = "model-outside"
	if _, err := service.StartGenerationBatch(ctx, request); !errors.Is(err, ErrGenerationSelectionChanged) {
		t.Fatalf("outside-set selection was accepted: %v", err)
	}
}
