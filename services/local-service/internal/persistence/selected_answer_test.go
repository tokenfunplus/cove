package persistence

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func TestSelectedAnswerRemainsIdentifiableAfterItsTargetIsRetried(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "selection.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(ctx, "Saved selection")
	if err != nil {
		t.Fatal(err)
	}
	batch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID: conversation.ID, ClientRequestID: "original", Body: "Question",
		Targets: []GenerationTargetInput{{ProviderID: "provider", ModelID: "model", Snapshot: ProviderSnapshot{ProviderID: "provider", ProviderName: "Original Provider", ModelID: "model"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	original := batch.Targets[0].Generation
	if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: original.ID, Body: "Original selected answer"}); err != nil {
		t.Fatal(err)
	}
	original, err = store.GetGeneration(ctx, original.ID)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := original.Snapshot
	snapshot.ProviderName = "Renamed Provider"
	retry, err := store.BeginGenerationAttempt(ctx, BeginGenerationAttemptInput{TargetID: batch.Targets[0].ID, ClientRequestID: "retry", Snapshot: snapshot})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := store.GetGenerationBatch(ctx, batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Targets[0].Generation.ID != retry.ID || loaded.SelectedGenerationID != original.ID {
		t.Fatal("retry changed the saved selection")
	}
	answer := loaded.SelectedAnswer
	if answer == nil || answer.GenerationID != original.ID || answer.AssistantMessageID != original.AssistantMessageID || answer.ProviderName != "Original Provider" || answer.ModelID != "model" {
		t.Fatalf("saved selection metadata = %#v", answer)
	}
	if _, err := store.AddMessage(ctx, conversation.ID, MessageInput{Role: "user", Body: "A later user turn"}); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: retry.ID, Body: "A searchable late retry"}); err != nil {
		t.Fatal(err)
	}
	matches, err := store.SearchConversations(ctx, "searchable late retry", false)
	if err != nil || len(matches) != 1 || matches[0].TurnMessageID != original.UserMessageID {
		t.Fatal("search must navigate late retries to their original turn")
	}
	view, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, message := range view.Messages {
		if message.Role == "assistant" && message.GenerationBatchID != batch.ID {
			t.Fatal("saved attempts lost their originating batch")
		}
	}
}

func TestSelectionAndRetryAreOrderedAtomically(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "selection-race.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err := store.db.Exec(`
CREATE TABLE selection_order(seq INTEGER PRIMARY KEY, batch_id TEXT, operation TEXT);
CREATE TRIGGER audit_selection AFTER UPDATE OF selected_generation_id ON generation_batches
WHEN new.selected_generation_id IS NOT NULL BEGIN
  INSERT INTO selection_order(batch_id, operation) VALUES(new.id, 'select');
END;
CREATE TRIGGER audit_retry AFTER UPDATE OF latest_generation_id ON generation_targets BEGIN
  INSERT INTO selection_order(batch_id, operation) VALUES(new.generation_batch_id, 'retry');
END;`); err != nil {
		t.Fatal(err)
	}
	for index := range 30 {
		conversation, err := store.CreateConversation(ctx, "Concurrent selection")
		if err != nil {
			t.Fatal(err)
		}
		batch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
			ConversationID: conversation.ID, ClientRequestID: fmt.Sprintf("batch-%d", index), Body: "Question",
			Targets: []GenerationTargetInput{
				{ProviderID: "provider", ModelID: "one", Snapshot: ProviderSnapshot{ProviderID: "provider", ModelID: "one"}},
				{ProviderID: "provider", ModelID: "two", Snapshot: ProviderSnapshot{ProviderID: "provider", ModelID: "two"}},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		for _, target := range batch.Targets {
			if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: target.Generation.ID, Body: "Completed answer"}); err != nil {
				t.Fatal(err)
			}
		}
		original := batch.Targets[0].Generation
		start := make(chan struct{})
		selection := make(chan error, 1)
		retry := make(chan error, 1)
		go func() { <-start; selection <- store.SelectGenerationAnswer(ctx, original.ID) }()
		go func() {
			<-start
			_, err := store.BeginGenerationAttempt(ctx, BeginGenerationAttemptInput{TargetID: batch.Targets[0].ID, ClientRequestID: fmt.Sprintf("retry-%d", index), Snapshot: original.Snapshot})
			retry <- err
		}()
		close(start)
		selectionErr, retryErr := <-selection, <-retry
		if retryErr != nil {
			t.Fatal(retryErr)
		}
		if selectionErr != nil && !strings.Contains(selectionErr.Error(), "latest Generation") {
			t.Fatal(selectionErr)
		}
		var selectedAt, retriedAt sql.NullInt64
		if err := store.db.QueryRow(`SELECT MIN(CASE WHEN operation='select' THEN seq END), MIN(CASE WHEN operation='retry' THEN seq END) FROM selection_order WHERE batch_id = ?`, batch.ID).Scan(&selectedAt, &retriedAt); err != nil {
			t.Fatal(err)
		}
		if !retriedAt.Valid || (selectionErr == nil && (!selectedAt.Valid || selectedAt.Int64 >= retriedAt.Int64)) {
			t.Fatal("a superseded attempt was selected after the retry advanced its target")
		}
		if err := store.SelectGenerationAnswer(ctx, original.ID); err == nil {
			t.Fatal("a stale attempt remains selectable after retry")
		}
	}
}
