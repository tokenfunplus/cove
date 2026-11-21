package persistence

import (
	"context"
	"path/filepath"
	"testing"
)

func TestSourceMigrationFromVersion13PreservesExistingMessages(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "migration.sqlite")
	store, err := OpenSQLite(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, "Keep this")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddMessage(ctx, conversation.ID, MessageInput{Role: "user", Body: "Existing history"}); err != nil {
		t.Fatal(err)
	}
	dropWebSearchSchema(t, store)
	if _, err := store.db.Exec(`DROP TABLE debate_turns; DROP TABLE debate_interventions; DROP TABLE debate_sessions; DROP TABLE conversation_branches; ALTER TABLE messages DROP COLUMN reasoning; ALTER TABLE generations DROP COLUMN metrics; ALTER TABLE generation_batches DROP COLUMN input_content; ALTER TABLE generation_batches DROP COLUMN attachments; ALTER TABLE generation_batches DROP COLUMN attachment_data; ALTER TABLE provider_profiles DROP COLUMN credential_ref; PRAGMA user_version = 13;`); err != nil {
		t.Fatal(err)
	}
	dropConversationSearchIndex(t, store)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenSQLite(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	view, err := reopened.LoadConversation(ctx, conversation.ID)
	if err != nil || len(view.Messages) != 1 || view.Messages[0].Body != "Existing history" {
		t.Fatal("source migration did not preserve history")
	}
	if got := pragmaInt(t, reopened.db, "user_version"); got != schemaVersion {
		t.Fatalf("schema = %d", got)
	}
}
