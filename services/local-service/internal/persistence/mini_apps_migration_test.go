package persistence

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
)

// Recreate the schema immediately preceding Mini Apps, keeping user-owned content.
func TestMiniAppsMigrationUpgradesSchema29WithoutChangingConversationOrCard(t *testing.T) {
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
	_, err = store.db.Exec(removeMiniAppsSchema + `PRAGMA user_version=29;`)
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

// Historical database fixtures must omit every Mini App addition, including the
// Generation field, rather than relying on duplicate-column migration guards.
const removeMiniAppsSchema = `DROP TABLE mini_app_activity;
DROP TABLE mini_app_tasks; DROP TABLE mini_app_invocations; DROP TABLE mini_app_blobs;
DROP TABLE mini_app_records; DROP TABLE mini_app_instances; DROP TABLE mini_app_releases;
ALTER TABLE generations DROP COLUMN mini_app_scope; `

func TestObsoleteMiniAppDevelopmentSchemasAreRejectedWithoutChangingData(t *testing.T) {
	for _, version := range []int{30, 31} {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "obsolete.sqlite")
			store, err := OpenSQLite(path)
			if err != nil {
				t.Fatal(err)
			}
			conversation, err := store.CreateConversation(t.Context(), "Keep development data")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = store.db.Exec(fmt.Sprintf("PRAGMA user_version=%d", version)); err != nil {
				t.Fatal(err)
			}
			store.Close()
			if reopened, err := OpenSQLite(path); err == nil {
				reopened.Close()
				t.Fatal("obsolete development schema was migrated")
			}
			db, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if pragmaInt(t, db, "user_version") != version {
				t.Fatal("rejection changed schema version")
			}
			var title string
			if err = db.QueryRow("SELECT title FROM conversations WHERE id=?", conversation.ID).Scan(&title); err != nil || title != conversation.Title {
				t.Fatal("rejection changed saved data", err)
			}
		})
	}
}
