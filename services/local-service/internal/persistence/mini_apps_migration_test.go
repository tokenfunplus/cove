package persistence

import (
	"path/filepath"
	"testing"
)

// Recreate the schema immediately preceding Mini Apps, keeping user-owned content.
func TestMiniAppsSchema30UpgradesExistingConversationAndCard(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upgrade.sqlite")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	_, _, card := seedCard(t, store)
	conversation, err := store.CreateConversation(t.Context(), "Saved before upgrade")
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.db.Exec(`DROP TABLE mini_app_tasks; DROP TABLE mini_app_invocations; DROP TABLE mini_app_blobs;
	DROP TABLE mini_app_records; DROP TABLE mini_app_instances; DROP TABLE mini_app_releases; PRAGMA user_version=29;`)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if pragmaInt(t, store.db, "user_version") != schemaVersion {
		t.Fatal("migration did not complete")
	}
	view, err := store.LoadConversation(t.Context(), conversation.ID)
	if err != nil || view.Title != conversation.Title {
		t.Fatal("previous conversation changed", err)
	}
	if _, err = store.MaterializeCard(t.Context(), card.GenerationID); err != nil {
		t.Fatal("previous interactive card changed", err)
	}
	var count int
	if err = store.db.QueryRow("SELECT COUNT(*) FROM mini_app_instances").Scan(&count); err != nil || count != 0 {
		t.Fatal("upgrade created user instances", err)
	}
}
