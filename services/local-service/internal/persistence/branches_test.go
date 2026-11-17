package persistence

import (
	"context"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"path/filepath"
	"reflect"
	"testing"
)

func TestEditedPromptBranchesSavedContextWithoutLaterTurnsAndSurvivesSourceDeletion(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "branches.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(ctx, "Source")
	if err != nil {
		t.Fatal(err)
	}
	targets := []GenerationTargetInput{{ProviderID: "fixture", ModelID: "one", Snapshot: ProviderSnapshot{ProviderID: "fixture", ModelID: "one", ProviderName: "Fixture"}}}
	sourceFile, err := documents.Parse(ctx, documents.Input{Name: "source.txt", Data: []byte("Saved source")})
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{ConversationID: conversation.ID, ClientRequestID: "first", Body: "Earlier question", Targets: targets, InputContent: documents.Prompt("Earlier question", []documents.Prepared{sourceFile}), Attachments: []documents.Prepared{sourceFile}})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: first.Targets[0].Generation.ID, Body: "Earlier selected answer", Reasoning: "Separate reasoning"}); err != nil {
		t.Fatal(err)
	}
	second, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{ConversationID: conversation.ID, ClientRequestID: "second", Body: "Original question", Targets: targets})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: second.Targets[0].Generation.ID, Body: "Original answer"}); err != nil {
		t.Fatal(err)
	}
	third, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{ConversationID: conversation.ID, ClientRequestID: "third", Body: "Later question", Targets: targets})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: third.Targets[0].Generation.ID, Body: "Later answer"}); err != nil {
		t.Fatal(err)
	}
	input := BeginGenerationBatchInput{ConversationID: conversation.ID, EditOfBatchID: second.ID, ClientRequestID: "edited", Body: "Edited question", Targets: targets}
	edited, err := store.BeginGenerationBatch(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if edited.ConversationID == conversation.ID || len(edited.ContextItems) != 1 || edited.ContextItems[0].AssistantBody != "Earlier selected answer" {
		t.Fatalf("branch context = %#v", edited)
	}
	repeated, err := store.BeginGenerationBatch(ctx, input)
	if err != nil || repeated.ID != edited.ID {
		t.Fatalf("idempotency: %#v %v", repeated, err)
	}
	original, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil || len(original.Messages) != 6 {
		t.Fatalf("source changed: %#v %v", original, err)
	}
	branch, err := store.LoadConversation(ctx, edited.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if branch.Branch == nil || branch.Branch.SourceBatchID != second.ID || len(branch.Messages) != 3 || branch.Messages[1].Reasoning != "Separate reasoning" {
		t.Fatalf("branch = %#v", branch)
	}
	inherited := branch.GenerationBatches[0]
	data, err := store.LoadAttachmentData(ctx, inherited.ID, sourceFile.Snapshot.ID)
	if err != nil || string(data.Data) != "Saved source" {
		t.Fatalf("inherited attachment = %#v %v", data, err)
	}
	if err := store.DeleteConversation(ctx, conversation.ID); err != nil {
		t.Fatal(err)
	}
	contextAfter, err := store.LoadGenerationBatchContext(ctx, edited.ID)
	if err != nil || !reflect.DeepEqual(edited.ContextItems, contextAfter) {
		t.Fatalf("source deletion changed context: %#v %v", contextAfter, err)
	}
	if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: edited.Targets[0].Generation.ID, Body: "Edited answer"}); err != nil {
		t.Fatal(err)
	}
	continuation, err := store.BeginGenerationBatch(ctx, BeginGenerationBatchInput{ConversationID: edited.ConversationID, ClientRequestID: "continue", Body: "Continue the branch", Targets: targets})
	if err != nil || len(continuation.ContextItems) != 2 {
		t.Fatalf("branch continuation = %#v %v", continuation, err)
	}
}
