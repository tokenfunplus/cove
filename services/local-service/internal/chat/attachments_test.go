package chat

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func TestFileChatSharesFrozenSourcesAcrossFourModelsRetriesAndRestart(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "files.sqlite")
	store, err := persistence.OpenSQLite(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	settings := persistence.Settings{Theme: "system", Locale: "en", SystemPrompt: "Use the supplied sources."}
	upstream := &modelStreamsProvider{streams: map[string][]provider.CompletionStream{}}
	for _, model := range []string{"a", "b", "c", "d"} {
		settings.ActiveModelSet = append(settings.ActiveModelSet, persistence.ActiveModelTarget{ProviderID: "provider-a", ModelID: model})
		for range 3 {
			upstream.streams[model] = append(upstream.streams[model], &fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "Answer from " + model}, {Type: provider.EventCompleted}}})
		}
	}
	if err := store.UpdateSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, "Sources")
	if err != nil {
		t.Fatal(err)
	}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a"), upstream, store)
	original := []byte("First line\nSecond line")
	input := SendInput{ConversationID: conversation.ID, ClientRequestID: "with-sources", Body: "Compare these notes", Attachments: []documents.Input{{Name: "notes.md", Data: original}, {Name: "main.go", Data: []byte("package main")}}}
	preview, err := service.PreviewGenerationContext(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	started, err := service.StartGenerationBatch(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, started.Batch.ID)
	for _, model := range []string{"a", "b", "c", "d"} {
		messages := upstream.messagesFor(model)
		if len(messages) != 1 || !reflect.DeepEqual(messages[0], preview) {
			t.Fatalf("model %s did not receive the previewed source snapshot", model)
		}
	}
	input.Attachments[0].Data[0] = 'X'
	// A repeated delivery returns the original batch even if the caller changed its file.
	repeated, err := service.StartGenerationBatch(ctx, input)
	if err != nil || repeated.Batch.ID != started.Batch.ID {
		t.Fatalf("duplicate delivery: %v", err)
	}
	if len(upstream.messagesFor("a")) != 1 {
		t.Fatal("duplicate delivery started another inference")
	}
	batch, err := service.GetGenerationBatch(ctx, started.Batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch.Attachments) != 2 || !strings.Contains(batch.InputContent, "First line") || strings.Contains(batch.InputContent, "Xirst line") {
		t.Fatal("attachment snapshot changed after submission")
	}
	if err := service.SelectGenerationAnswer(ctx, batch.Targets[0].Generation.ID); err != nil {
		t.Fatal(err)
	}
	settings.ActiveModelSet = settings.ActiveModelSet[:1]
	if err := store.UpdateSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	follow, err := service.StartGenerationBatch(ctx, SendInput{ConversationID: conversation.ID, ClientRequestID: "follow", Body: "Follow up"})
	if err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, follow.Batch.ID)
	frozen, err := service.GetGenerationBatchContext(ctx, follow.Batch.ID)
	if err != nil || len(frozen) != 2 || frozen[0].Content != batch.InputContent || frozen[1].Content != "Answer from a" {
		t.Fatalf("selected source context: %v", err)
	}
	if _, err := service.RetryGenerationTarget(ctx, batch.Targets[0].ID, "retry-old-source"); err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, batch.ID)
	messages := upstream.messagesFor("a")
	if len(messages) != 3 || !reflect.DeepEqual(messages[2], preview) {
		t.Fatal("retry did not use the original source input and original prior context")
	}
	frozenAgain, err := service.GetGenerationBatchContext(ctx, follow.Batch.ID)
	if err != nil || !reflect.DeepEqual(frozen, frozenAgain) {
		t.Fatal("retry changed the later frozen context")
	}
	reopened, err := persistence.OpenSQLite(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	saved, err := reopened.LoadAttachmentData(ctx, batch.ID, batch.Attachments[0].ID)
	if err != nil || string(saved.Data) != "First line\nSecond line" {
		t.Fatalf("original bytes after restart: %v", err)
	}
	if err := service.DeleteConversation(ctx, conversation.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.LoadAttachmentData(ctx, batch.ID, batch.Attachments[0].ID); err == nil {
		t.Fatal("deleting history retained attachment data")
	}
}

func waitFileBatch(t *testing.T, service *Service, batchID string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	events, err := service.SubscribeGenerationBatch(ctx, batchID, "")
	if err != nil {
		t.Fatal(err)
	}
	for {
		select {
		case _, ok := <-events:
			if !ok {
				return
			}
		case <-ctx.Done():
			t.Fatal("timed out waiting for file batch")
		}
	}
}

func TestFileContextLimitRejectsBeforeCreatingHistory(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "limit.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store, fakeProviderProfiles("provider-a"), &fakeProvider{})
	_, err = service.StartGenerationBatch(ctx, SendInput{ConversationID: conversation.ID, ProviderID: "provider-a", ModelID: "a", ClientRequestID: "too-large", Body: strings.Repeat("x", documents.MaxContextCharacters+1)})
	if !errors.Is(err, documents.ErrContextLimit) {
		t.Fatalf("context limit: %v", err)
	}
	view, err := service.ReadConversation(ctx, conversation.ID)
	if err != nil || len(view.Messages) != 0 || len(view.GenerationBatches) != 0 {
		t.Fatal("invalid input created history")
	}
}

func TestDeletingSourceHistoryStopsBrowserGenerationBeforeRemovingFiles(t *testing.T) {
	service, store, conversation := secureWatchdogFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	started, err := service.StartGenerationBatch(ctx, SendInput{ConversationID: conversation.ID, ClientRequestID: "delete-files", ProviderID: "nearai", ModelID: "model-a", Body: "Read", Attachments: []documents.Input{{Name: "notes.txt", Data: []byte("Source")}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteConversation(ctx, conversation.ID); err != nil {
		t.Fatal(err)
	}
	if service.HasActiveGenerationBatch() {
		t.Fatal("deleted generation still occupies the active slot")
	}
	if _, err := store.LoadAttachmentData(ctx, started.Batch.ID, started.Batch.Attachments[0].ID); err == nil {
		t.Fatal("deleted original remains available")
	}
}

func TestRetryContextLimitDoesNotCreateAnUnsettledAttempt(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "retry-limit.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	settings := persistence.Settings{Theme: "system", Locale: "en", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "a"}}}
	if err := store.UpdateSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "Answer"}, {Type: provider.EventCompleted}}}}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a"), upstream, store)
	started, err := service.StartGenerationBatch(ctx, SendInput{ConversationID: conversation.ID, ClientRequestID: "large", Body: strings.Repeat("a", documents.MaxContextCharacters-100)})
	if err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, started.Batch.ID)
	settings.SystemPrompt = strings.Repeat("b", 200)
	if err := store.UpdateSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RetryGenerationTarget(ctx, started.Batch.Targets[0].ID, "large-retry"); !errors.Is(err, documents.ErrContextLimit) {
		t.Fatalf("retry limit: %v", err)
	}
	target, err := store.GetGenerationTarget(ctx, started.Batch.Targets[0].ID)
	if err != nil || target.Generation.ID != started.Batch.Targets[0].Generation.ID || target.Generation.State != persistence.GenerationCompleted {
		t.Fatal("oversized retry created an unsettled attempt")
	}
}
