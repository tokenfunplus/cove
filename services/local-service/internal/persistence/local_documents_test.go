package persistence

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
)

func TestLocalDocumentsMigrationPreservesSchema24Projects(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "main24.sqlite")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if store != nil {
			store.Close()
		}
	}()
	project, err := store.SaveProject(ctx, "", ProjectInput{Name: "Existing project", Instructions: "Keep this rule", Background: "Keep this background"})
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateProjectConversation(ctx, "Existing chat", project.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	batch := projectTestBatch(t, store, conversation, "main24-batch")
	var original string
	if err = store.db.QueryRow(`SELECT payload FROM generation_project_contexts WHERE batch_id=?`, batch.ID).Scan(&original); err != nil {
		t.Fatal(err)
	}
	if _, err = store.db.Exec(removeMiniAppsSchema + `DROP TABLE project_source_indexes; ALTER TABLE project_sources DROP COLUMN usage; ALTER TABLE generation_batches DROP COLUMN local_only; DROP TABLE local_document_chunks; DROP TABLE local_documents; PRAGMA user_version=24;`); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	var actual string
	if err = store.db.QueryRow(`SELECT payload FROM generation_project_contexts WHERE batch_id=?`, batch.ID).Scan(&actual); err != nil || actual != original {
		t.Fatal("local-library migration changed the saved project context", err)
	}
	if got := pragmaInt(t, store.db, "user_version"); got != schemaVersion {
		t.Fatalf("schema version = %d", got)
	}
	if library, err := store.ListLocalDocuments(ctx); err != nil || len(library) != 0 {
		t.Fatal("local library was not created empty", err)
	}
	if err = store.ClearChatData(ctx); err != nil {
		t.Fatal(err)
	}
	projects, err := store.ListProjects(ctx)
	if err != nil || len(projects) != 1 || projects[0].Instructions != project.Instructions || projects[0].Background != project.Background {
		t.Fatal("clearing history changed live project configuration", err)
	}
}

func TestLocalPreviewSchema23MigrationPreservesLibraryAndHistory(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "local-preview23.sqlite")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if store != nil {
			store.Close()
		}
	}()
	conversation, err := store.CreateConversation(ctx, "Preview history")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.AddMessage(ctx, conversation.ID, MessageInput{Role: "user", Body: "Keep this message"}); err != nil {
		t.Fatal(err)
	}
	source, err := documents.Parse(ctx, documents.Input{Name: "preview.txt", Data: []byte("Keep this original document.")})
	if err != nil {
		t.Fatal(err)
	}
	vector := make([]float32, 512)
	vector[0] = 1
	if err = store.SaveLocalDocument(ctx, source, "fixture-hash", "fixture-version", []LocalChunk{{DocumentID: source.ID, Ordinal: 0, Sections: []string{"L1"}, Text: source.Sections[0].Text, Vector: vector}}); err != nil {
		t.Fatal(err)
	}
	dropProjectSchema(t, store)
	if _, err = store.db.Exec(removeMiniAppsSchema + `PRAGMA user_version=23;`); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	view, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil || len(view.Messages) != 1 || view.Messages[0].Body != "Keep this message" || view.ProjectID != "" {
		t.Fatal("preview migration changed history", err)
	}
	retained, err := store.ReadLocalDocument(ctx, source.ID)
	if err != nil || string(retained.Data) != string(source.Data) || retained.Snapshot.ID != source.ID {
		t.Fatal("preview migration changed the library original", err)
	}
	chunks, err := store.ReadLocalChunks(ctx, source.ID, "fixture-hash", "fixture-version")
	if err != nil || len(chunks) != 1 || chunks[0].Vector[0] != 1 || chunks[0].Text != source.Sections[0].Text {
		t.Fatal("preview migration changed the embedding index", err)
	}
	if _, err = store.SaveProject(ctx, "", ProjectInput{Name: "New project after upgrade"}); err != nil {
		t.Fatal("preview migration did not add Projects", err)
	}
	if got := pragmaInt(t, store.db, "user_version"); got != schemaVersion {
		t.Fatalf("schema version = %d", got)
	}
	if err = store.ClearChatData(ctx); err != nil {
		t.Fatal(err)
	}
	if library, err := store.ListLocalDocuments(ctx); err != nil || len(library) != 0 {
		t.Fatal("clear retained preview library data", err)
	}
}
