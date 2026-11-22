package persistence

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
)

func TestSchema25UpgradeKeepsProjectSourcesAndFrozenInput(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "schema25.sqlite")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	project, err := store.SaveProject(ctx, "", ProjectInput{Name: "Existing project"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := documents.Parse(ctx, documents.Input{Name: "existing.txt", Data: []byte("Existing fixed source")})
	if err != nil {
		t.Fatal(err)
	}
	project, err = store.AddProjectSource(ctx, project.ID, project.Revision, source)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateProjectConversation(ctx, "Existing chat", project.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	batch := projectTestBatch(t, store, conversation, "schema25")
	var before string
	if err = store.db.QueryRow(`SELECT payload FROM generation_project_contexts WHERE batch_id=?`, batch.ID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if _, err = store.db.Exec(`DROP TABLE project_source_indexes; ALTER TABLE project_sources DROP COLUMN usage; ALTER TABLE generation_batches DROP COLUMN local_only; PRAGMA user_version=25;`); err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, err = OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	current, err := store.GetProject(ctx, project.ID)
	if err != nil || len(current.Sources) != 1 || current.Sources[0].Usage != "always" {
		t.Fatal("migration changed an existing source's use", err)
	}
	var after string
	if err = store.db.QueryRow(`SELECT payload FROM generation_project_contexts WHERE batch_id=?`, batch.ID).Scan(&after); err != nil || after != before {
		t.Fatal("migration rewrote frozen project input", err)
	}
	saved, err := store.GetGenerationBatch(ctx, batch.ID)
	if err != nil || saved.LocalOnly {
		t.Fatal("migration changed an existing execution policy", err)
	}
}

func TestSchema26FailureRollsBackSourceAndPolicyColumns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "failed26.sqlite")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.db.Exec(`ALTER TABLE project_sources DROP COLUMN usage; ALTER TABLE generation_batches DROP COLUMN local_only; PRAGMA user_version=25;`); err != nil {
		t.Fatal(err)
	}
	store.Close()
	if reopened, err := OpenSQLite(path); err == nil {
		reopened.Close()
		t.Fatal("migration accepted a conflicting index table")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if got := pragmaInt(t, db, "user_version"); got != 25 {
		t.Fatalf("failed migration advanced schema to %d", got)
	}
	var count int
	if err = db.QueryRow(`SELECT count(*) FROM pragma_table_info('project_sources') WHERE name='usage'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("failed migration retained a partial usage column", err)
	}
	if err = db.QueryRow(`SELECT count(*) FROM pragma_table_info('generation_batches') WHERE name='local_only'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("failed migration retained a partial execution policy", err)
	}
}
