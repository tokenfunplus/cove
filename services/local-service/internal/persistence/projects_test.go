package persistence

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
)

func projectTestStore(t *testing.T) *SQLiteStore {
	t.Helper()
	s, e := OpenSQLite(filepath.Join(t.TempDir(), "projects.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func projectTestBatch(t *testing.T, s *SQLiteStore, c Conversation, key string) GenerationBatch {
	t.Helper()
	_, expected, e := s.PreviewProjectContext(context.Background(), c.ID)
	if e != nil {
		t.Fatal(e)
	}
	b, e := s.BeginGenerationBatch(context.Background(), BeginGenerationBatchInput{ConversationID: c.ID, ClientRequestID: key, Body: "Question", ExpectedProject: &expected, Targets: []GenerationTargetInput{{ProviderID: "fixture", ModelID: "model", Snapshot: ProviderSnapshot{ProviderID: "fixture", ModelID: "model"}}}})
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func TestProjectSourcesDeduplicateAndSurviveMovesBranchesAndDissolution(t *testing.T) {
	ctx := context.Background()
	s := projectTestStore(t)
	p, e := s.SaveProject(ctx, "", ProjectInput{Name: "Research", Instructions: "Project rule", Background: "Original background"})
	if e != nil {
		t.Fatal(e)
	}
	source, e := documents.Parse(ctx, documents.Input{Name: "notes.md", Data: []byte("Immutable source")})
	if e != nil {
		t.Fatal(e)
	}
	p, e = s.AddProjectSource(ctx, p.ID, p.Revision, source)
	if e != nil {
		t.Fatal(e)
	}
	first, e := s.CreateProjectConversation(ctx, "First", p.ID, "")
	if e != nil {
		t.Fatal(e)
	}
	b := projectTestBatch(t, s, first, "original")
	g := b.Targets[0].Generation
	if e = s.MarkGenerationStreaming(ctx, g.ID); e != nil {
		t.Fatal(e)
	}
	if e = s.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: g.ID, Body: "Saved answer"}); e != nil {
		t.Fatal(e)
	}
	second := projectTestBatch(t, s, first, "second")
	if second.ProjectContext.ReferencePrefix != b.ProjectContext.ReferencePrefix {
		t.Fatal("background changed between identical snapshots")
	}
	if e = s.TerminateGeneration(ctx, TerminateGenerationInput{GenerationID: second.Targets[0].Generation.ID, State: GenerationStopped}); e != nil {
		t.Fatal(e)
	}
	// Editing the second turn copies the first completed prefix and references.
	branch, e := s.BeginGenerationBatch(ctx, BeginGenerationBatchInput{ConversationID: first.ID, EditOfBatchID: second.ID, ClientRequestID: "branch", ExpectedProject: &second.ProjectContext.ProjectExpectation, Body: "Edited question", Targets: []GenerationTargetInput{{ProviderID: "fixture", ModelID: "model", Snapshot: g.Snapshot}}})
	if e != nil {
		t.Fatal(e)
	}
	if branch.ConversationID == first.ID {
		t.Fatal("branch not created")
	}
	var blobs int
	if e = s.db.QueryRow(`SELECT COUNT(*) FROM project_source_blobs`).Scan(&blobs); e != nil || blobs != 1 {
		t.Fatalf("raw bytes duplicated: %d %v", blobs, e)
	}
	p, e = s.SaveProject(ctx, p.ID, ProjectInput{Name: p.Name, Revision: p.Revision, Background: "Changed background"})
	if e != nil {
		t.Fatal(e)
	}
	saved, e := s.GetGenerationBatch(ctx, b.ID)
	if e != nil || saved.ProjectContext.Background != "Original background" {
		t.Fatalf("snapshot changed: %v", e)
	}
	if e = s.DeleteConversation(ctx, first.ID); e != nil {
		t.Fatal(e)
	}
	if e = s.DeleteProject(ctx, p.ID, p.Revision, false); e != nil {
		t.Fatal(e)
	}
	view, e := s.LoadConversation(ctx, branch.ConversationID)
	if e != nil || view.ProjectID != "" {
		t.Fatalf("dissolve failed: %v", e)
	}
	for _, batch := range view.GenerationBatches {
		original, e := s.ReadBatchProjectOriginal(ctx, batch.ID, source.ID)
		if e != nil || string(original.Data) != "Immutable source" {
			t.Fatalf("branch original lost: %v", e)
		}
	}
	if e = s.DeleteConversation(ctx, branch.ConversationID); e != nil {
		t.Fatal(e)
	}
	if e = s.db.QueryRow(`SELECT COUNT(*) FROM project_source_blobs`).Scan(&blobs); e != nil || blobs != 0 {
		t.Fatalf("last blob not collected: %d %v", blobs, e)
	}
}
func TestProjectAdmissionRevisionAndIdempotency(t *testing.T) {
	ctx := context.Background()
	s := projectTestStore(t)
	p, _ := s.SaveProject(ctx, "", ProjectInput{Name: "A", Background: "Old"})
	c, _ := s.CreateProjectConversation(ctx, "", p.ID, "")
	_, expected, _ := s.PreviewProjectContext(ctx, c.ID)
	_, e := s.SaveProject(ctx, p.ID, ProjectInput{Name: "A", Revision: p.Revision, Background: "New"})
	if e != nil {
		t.Fatal(e)
	}
	input := BeginGenerationBatchInput{ConversationID: c.ID, ClientRequestID: "same-request", ExpectedProject: &expected, Body: "Question", Targets: []GenerationTargetInput{{ProviderID: "fixture", ModelID: "model", Snapshot: ProviderSnapshot{ProviderID: "fixture", ModelID: "model"}}}}
	if _, e = s.BeginGenerationBatch(ctx, input); !errors.Is(e, ErrProjectChanged) {
		t.Fatalf("accepted stale project: %v", e)
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM generation_batches`).Scan(&n)
	if n != 0 {
		t.Fatal("conflict created partial batch")
	}
	_, expected, _ = s.PreviewProjectContext(ctx, c.ID)
	input.ExpectedProject = &expected
	b, e := s.BeginGenerationBatch(ctx, input)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.MoveConversation(ctx, c.ID, "", c.MembershipRevision); e != nil {
		t.Fatal(e)
	}
	replay, e := s.BeginGenerationBatch(ctx, input)
	if e != nil || replay.ID != b.ID {
		t.Fatalf("idempotent replay failed after move: %v", e)
	}
	if _, e = s.db.Exec(`DELETE FROM generation_project_contexts WHERE batch_id=?`, b.ID); e != nil {
		t.Fatal(e)
	}
	if _, e = s.GetGenerationBatch(ctx, b.ID); e == nil {
		t.Fatal("missing required snapshot silently ignored")
	}
}
func TestProjectSourceSaveQuotasAndClearHistoryOwnership(t *testing.T) {
	ctx := context.Background()
	s := projectTestStore(t)
	p, _ := s.SaveProject(ctx, "", ProjectInput{Name: "A"})
	for i, name := range []string{"a.md", "b.md", "c.md"} {
		source, _ := documents.Parse(ctx, documents.Input{Name: name, Data: []byte(strings.Repeat(name, 10))})
		var e error
		p, e = s.AddProjectSource(ctx, p.ID, p.Revision, source)
		if e != nil {
			t.Fatal(i, e)
		}
	}
	extra, _ := documents.Parse(ctx, documents.Input{Name: "extra.md", Data: []byte("extra")})
	if _, e := s.AddProjectSource(ctx, p.ID, p.Revision, extra); !errors.Is(e, ErrInvalidProject) {
		t.Fatal("fourth project source accepted")
	}
	c, _ := s.CreateProjectConversation(ctx, "", p.ID, "")
	projectTestBatch(t, s, c, "with-sources")
	if e := s.ClearChatData(ctx); e != nil {
		t.Fatal(e)
	}
	p, e := s.GetProject(ctx, p.ID)
	if e != nil || len(p.Sources) != 3 {
		t.Fatal("clearing history removed shared sources")
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM project_source_blobs`).Scan(&n)
	if n != 3 {
		t.Fatal("project-owned originals removed")
	}
	side, e := s.CreateProjectConversation(ctx, "", "", c.ID)
	if e == nil || side.ID != "" {
		t.Fatal("side conversation accepted missing origin")
	}
	if e = s.DeleteProject(ctx, p.ID, p.Revision, true); e != nil {
		t.Fatal(e)
	}
	s.db.QueryRow(`SELECT COUNT(*) FROM project_source_blobs`).Scan(&n)
	if n != 0 {
		t.Fatal("project originals leaked")
	}
}

func TestProjectMigrationPreservesSchema22History(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "upgrade.sqlite")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, "Existing history")
	if err != nil {
		t.Fatal(err)
	}
	batch := projectTestBatch(t, store, conversation, "existing-batch")
	if err = store.MarkGenerationStreaming(ctx, batch.Targets[0].Generation.ID); err != nil {
		t.Fatal(err)
	}
	if err = store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: batch.Targets[0].Generation.ID, Body: "Existing answer"}); err != nil {
		t.Fatal(err)
	}
	dropProjectSchema(t, store)
	if _, err = store.db.Exec(`PRAGMA user_version=22`); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	upgraded, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	view, err := upgraded.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if view.ProjectID != "" || view.MembershipRevision != 0 || len(view.Messages) != 2 || view.Messages[1].Body != "Existing answer" || len(view.GenerationBatches) != 1 || view.GenerationBatches[0].ProjectContext != nil {
		t.Fatal("migration changed existing history or injected project input")
	}
	version, err := readPragmaInt(upgraded.db, "user_version")
	if err != nil || version != 24 {
		t.Fatalf("schema migration did not finish: %d %v", version, err)
	}
	if projects, err := upgraded.ListProjects(ctx); err != nil || len(projects) != 0 {
		t.Fatalf("unexpected migrated projects: %v", err)
	}
}

func TestProjectIndexMigrationPreservesSchema23Snapshots(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "schema23.sqlite")
	s, e := OpenSQLite(path)
	if e != nil {
		t.Fatal(e)
	}
	p, e := s.SaveProject(ctx, "", ProjectInput{Name: "Indexed project", Background: "Immutable payload"})
	if e != nil {
		t.Fatal(e)
	}
	c, e := s.CreateProjectConversation(ctx, "", p.ID, "")
	if e != nil {
		t.Fatal(e)
	}
	b := projectTestBatch(t, s, c, "schema23")
	var original string
	if e = s.db.QueryRow(`SELECT payload FROM generation_project_contexts WHERE batch_id=?`, b.ID).Scan(&original); e != nil {
		t.Fatal(e)
	}
	if _, e = s.db.Exec(`DROP INDEX project_context_project_idx; DROP INDEX project_sources_blob_idx; DROP INDEX batch_project_sources_blob_idx; PRAGMA user_version=23;`); e != nil {
		t.Fatal(e)
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	s, e = OpenSQLite(path)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	var actual string
	if e = s.db.QueryRow(`SELECT payload FROM generation_project_contexts WHERE batch_id=?`, b.ID).Scan(&actual); e != nil || actual != original {
		t.Fatal("index migration changed immutable payload")
	}
	rows, e := s.db.Query(`EXPLAIN QUERY PLAN SELECT COUNT(*) FROM generation_project_contexts WHERE json_extract(payload,'$.project_id')=?`, p.ID)
	if e != nil {
		t.Fatal(e)
	}
	indexed := false
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if e = rows.Scan(&id, &parent, &unused, &detail); e != nil {
			t.Fatal(e)
		}
		if strings.Contains(detail, "SEARCH generation_project_contexts USING") && strings.Contains(detail, "project_context_project_idx") {
			indexed = true
		}
	}
	if e = rows.Close(); e != nil {
		t.Fatal(e)
	}
	if !indexed {
		t.Fatal("project lookup still scans saved payloads")
	}
	if e = s.MoveConversation(ctx, c.ID, "", c.MembershipRevision); e != nil {
		t.Fatal(e)
	}
	p, e = s.GetProject(ctx, p.ID)
	if e != nil || p.HistoricalCopies != 1 || p.ConversationCount != 0 {
		t.Fatalf("indexed removal counts incorrect: %+v %v", p, e)
	}
}

func TestProjectSourceCharacterQuotaIsAtomicAndCountsUnicode(t *testing.T) {
	ctx := context.Background()
	store := projectTestStore(t)
	p, e := store.SaveProject(ctx, "", ProjectInput{Name: "Source boundary"})
	if e != nil {
		t.Fatal(e)
	}
	exact, e := documents.Parse(ctx, documents.Input{Name: "exact.txt", Data: []byte(strings.Repeat("\u754c", 60000))})
	if e != nil {
		t.Fatal(e)
	}
	p, e = store.AddProjectSource(ctx, p.ID, p.Revision, exact)
	if e != nil {
		t.Fatal(e)
	}
	extra, e := documents.Parse(ctx, documents.Input{Name: "extra.txt", Data: []byte("x")})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = store.AddProjectSource(ctx, p.ID, p.Revision, extra); !errors.Is(e, ErrInvalidProject) {
		t.Fatalf("over-quota fixed source was accepted: %v", e)
	}
	saved, e := store.GetProject(ctx, p.ID)
	if e != nil || saved.Revision != p.Revision || len(saved.Sources) != 1 || saved.Sources[0].Snapshot.Characters != 60000 {
		t.Fatal("failed source save changed the project")
	}
	var blobs int
	if e = store.db.QueryRow(`SELECT COUNT(*) FROM project_source_blobs`).Scan(&blobs); e != nil || blobs != 1 {
		t.Fatal("failed source save left an orphan blob")
	}
}
