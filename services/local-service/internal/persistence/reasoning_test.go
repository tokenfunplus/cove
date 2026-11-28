package persistence

import (
	"context"
	"path/filepath"
	"testing"
)

func TestStructuredReasoningSurvivesRestartWithoutEnteringSelectedContext(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "reasoning.sqlite")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, "Reasoning fixture")
	if err != nil {
		t.Fatal(err)
	}
	batch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{
		ConversationID: conversation.ID, ClientRequestID: "reasoning-fixture", Body: "Question",
		Targets: []GenerationTargetInput{{ProviderID: "fixture", ModelID: "fixture", Snapshot: ProviderSnapshot{ProviderID: "fixture", ProviderName: "Fixture", ModelID: "fixture", TransportSecurity: "tls"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: batch.Targets[0].Generation.ID, Body: "Final answer.", Reasoning: "Plan the answer."}); err != nil {
		t.Fatal(err)
	}
	items, err := store.LoadBatchContext(ctx, conversation.ID)
	if err != nil || len(items) != 1 || items[0].AssistantBody != "Final answer." {
		t.Fatalf("selected context = %#v, %v", items, err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	view, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil || len(view.Messages) != 2 || view.Messages[1].Reasoning != "Plan the answer." || view.Messages[1].Body != "Final answer." {
		t.Fatalf("saved reasoning = %#v, %v", view.Messages, err)
	}
	dropWebSearchSchema(t, store)
	if _, err := store.db.Exec(removeMiniAppsSchema + `DROP TABLE debate_turns; DROP TABLE debate_interventions; DROP TABLE debate_sessions; DROP TABLE conversation_branches; ALTER TABLE messages DROP COLUMN reasoning; PRAGMA user_version = 17;`); err != nil {
		t.Fatal(err)
	}
	if err := store.migrate(); err != nil {
		t.Fatal(err)
	}
	view, err = store.LoadConversation(ctx, conversation.ID)
	if err != nil || view.Messages[1].Reasoning != "" || view.Messages[1].Body != "Final answer." {
		t.Fatalf("legacy history = %#v, %v", view.Messages, err)
	}
}
