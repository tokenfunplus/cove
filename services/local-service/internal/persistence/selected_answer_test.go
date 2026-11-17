package persistence

import (
	"context"
	"path/filepath"
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
}
