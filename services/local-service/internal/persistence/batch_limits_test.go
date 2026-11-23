package persistence

import (
	"context"
	"testing"
)

func TestTargetLimitsPreserveBatchPreferencesAndOtherTargets(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(ctx, "Limits")
	if err != nil {
		t.Fatal(err)
	}
	requested, local := 4096, 1024
	batch, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{ConversationID: conversation.ID, ClientRequestID: "limits", Body: "Question", GenerationParameters: GenerationParameters{MaxTokens: &requested}, Targets: []GenerationTargetInput{
		{ProviderID: "local", ModelID: "local", Snapshot: ProviderSnapshot{ProviderID: "local", ModelID: "local"}, GenerationParameters: &GenerationParameters{MaxTokens: &local}},
		{ProviderID: "remote", ModelID: "remote", Snapshot: ProviderSnapshot{ProviderID: "remote", ModelID: "remote"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if *batch.GenerationParameters.MaxTokens != 4096 || *batch.Targets[0].Generation.ConfigurationSnapshot.MaxTokens != 1024 || *batch.Targets[1].Generation.ConfigurationSnapshot.MaxTokens != 4096 {
		t.Fatal("effective limits leaked across targets or lost preferences")
	}
}
