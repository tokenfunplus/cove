package chat

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/retrieval"
)

func TestLegacyPDFIndexReextractsOriginalBytes(t *testing.T) {
	for _, scope := range []string{"library", "project"} {
		t.Run(scope, func(t *testing.T) {
			ctx := context.Background()
			store, err := persistence.OpenSQLite(":memory:")
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			service := NewService(store, nil, nil)
			service.localDocuments = store
			service.retrieval = retrieval.New(store, localFixtureEngine{})

			oldSection := documents.Section{ID: "P11", Text: "O\nl\nd\n text"}
			source := documents.Prepared{Snapshot: documents.Snapshot{
				ID: "fixture-pdf", Name: "reference.pdf", MediaType: "application/pdf", ExtractionVersion: "cove-pdf-v1",
				Sections: []documents.Section{oldSection}, Characters: len(oldSection.Text),
			}, Data: []byte("Synthetic original PDF bytes")}
			var library retrieval.Store = store
			list := service.ListLocalDocuments
			prepare := service.PrepareLocalSources
			refresh := func() error { return service.ReindexLocalDocument(ctx, source.ID) }
			var project persistence.Project
			if scope == "project" {
				project, err = store.SaveProject(ctx, "", persistence.ProjectInput{Name: "Legacy PDF project"})
				if err != nil {
					t.Fatal(err)
				}
				project, err = store.AddProjectSource(ctx, project.ID, project.Revision, source)
				if err != nil {
					t.Fatal(err)
				}
				project, err = store.SetProjectSourceUsage(ctx, project.ID, project.Sources[0].ID, project.Revision, "search")
				if err != nil {
					t.Fatal(err)
				}
				projectLibrary := store.ProjectLibrary(project.ID)
				library = projectLibrary
				list = projectLibrary.ListLocalDocuments
				prepare = func(ctx context.Context, owner string, selections []retrieval.Selection) ([]PreparedWebSource, error) {
					return service.PrepareProjectSources(ctx, project.ID, owner, selections)
				}
				refresh = func() error {
					_, err := service.SearchProjectDocuments(ctx, project.ID, []string{source.ID}, "text")
					return err
				}
			}
			engine := service.retrieval.WithStore(library)
			if err := engine.Import(ctx, source); err != nil {
				t.Fatal(err)
			}
			before, err := list(ctx)
			if err != nil || len(before) != 1 || before[0].Chunks == 0 || !before[0].NeedsReindex {
				t.Fatal("existing PDF index was not marked for refresh", before, err)
			}
			oldSelection := retrieval.Selection{DocumentID: source.ID, Ordinal: 0, ExtractionVersion: source.ExtractionVersion}
			oldSources, err := prepare(ctx, "owner", []retrieval.Selection{oldSelection})
			if err != nil || len(oldSources) != 1 {
				t.Fatal("could not prepare an existing indexed section", err)
			}
			fixtureFailure := errors.New("fixture PDF parser canceled")
			service.SetDocumentParser(func(context.Context, documents.Input) (documents.Prepared, error) {
				return documents.Prepared{}, fixtureFailure
			})
			if err := refresh(); !errors.Is(err, fixtureFailure) {
				t.Fatal("reindex did not surface the re-extraction error", err)
			}
			failed, err := library.ReadLocalDocument(ctx, source.ID)
			if err != nil || len(failed.Sections) != 1 || failed.Sections[0] != oldSection {
				t.Fatal("failed reindex replaced the existing snapshot", err)
			}

			newSection := documents.Section{ID: "P11", Text: "Old text"}
			calls := 0
			service.SetDocumentParser(func(_ context.Context, input documents.Input) (documents.Prepared, error) {
				calls++
				if input.Name != source.Name || !bytes.Equal(input.Data, source.Data) {
					t.Fatal("reindex did not parse the saved original")
				}
				refreshed := source
				refreshed.ExtractionVersion = documents.PDFExtractionVersion
				refreshed.Sections = []documents.Section{newSection}
				refreshed.Characters = len(newSection.Text)
				return refreshed, nil
			})
			if err := refresh(); err != nil {
				t.Fatal(err)
			}
			if err := refresh(); err != nil || calls != 1 {
				t.Fatal("current extraction was unnecessarily parsed again", calls, err)
			}
			after, err := list(ctx)
			if err != nil || len(after) != 1 || after[0].Chunks == 0 || after[0].NeedsReindex || after[0].Characters != len(newSection.Text) {
				t.Fatal("refreshed index status or metadata was not saved", after, err)
			}
			result, err := engine.Search(ctx, []string{source.ID}, "text")
			if err != nil || len(result.Hits) != 1 || result.Hits[0].Text != newSection.Text || result.Hits[0].Source.Sections[0] != newSection {
				t.Fatal("refreshed search lost text or page references", result, err)
			}
			for _, version := range []string{"", source.ExtractionVersion} {
				selection := oldSelection
				selection.ExtractionVersion = version
				if _, err := prepare(ctx, "owner", []retrieval.Selection{selection}); err == nil {
					t.Fatal("stale or unversioned selection resolved into refreshed PDF", version)
				}
			}
			newSelection := oldSelection
			newSelection.ExtractionVersion = result.Hits[0].Source.ExtractionVersion
			selected, err := prepare(ctx, "owner", []retrieval.Selection{newSelection})
			if err != nil || len(selected) != 1 || selected[0].Snapshot.Sections[0] != newSection {
				t.Fatal("current selection lost its source snapshot", err)
			}
			prior, err := service.preparedWebSources("owner", []string{oldSources[0].SourceToken})
			if err != nil || len(prior) != 1 || prior[0].Sections[0] != oldSection {
				t.Fatal("refresh rewrote a previously prepared source", err)
			}
			if project.ID != "" {
				saved, err := store.GetProject(ctx, project.ID)
				if err != nil || saved.Revision != project.Revision || len(saved.Sources) != 1 || saved.Sources[0].Snapshot.Sections[0] != oldSection {
					t.Fatal("search refresh changed the canonical project source or revision", err)
				}
			}
		})
	}
}

type localFixtureEngine struct{}

func (localFixtureEngine) Installed(string) bool { return true }
func (localFixtureEngine) Embed(_ context.Context, texts []string) ([][]float32, error) {
	vectors := make([][]float32, len(texts))
	for i := range texts {
		vectors[i] = make([]float32, 512)
		vectors[i][0] = 1
	}
	return vectors, nil
}

func TestLocalModelRemovalSharesGenerationAdmission(t *testing.T) {
	for _, id := range []string{localmodels.ChatID, localmodels.Qwen3AbliteratedID, localmodels.Qwen15BID, localmodels.QwenCoder15BID, localmodels.Gemma3ID} {
		t.Run(id, func(t *testing.T) { testLocalModelRemovalAdmission(t, id) })
	}
}

func testLocalModelRemovalAdmission(t *testing.T, modelID string) {
	manager := localmodels.New(t.TempDir(), "unused")
	defer manager.Close()
	service := NewService(nil, nil, nil)
	service.localModels = manager
	service.startMu.Lock()
	result := make(chan error, 1)
	go func() { result <- service.RemoveLocalModel(context.Background(), modelID) }()
	select {
	case err := <-result:
		service.startMu.Unlock()
		t.Fatalf("removal bypassed Generation admission: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	service.activeMu.Lock()
	service.active["new-generation"] = &activeGeneration{}
	service.activeMu.Unlock()
	service.startMu.Unlock()
	select {
	case err := <-result:
		if !errors.Is(err, ErrGenerationInProgress) {
			t.Fatalf("removal raced a newly admitted Generation: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("removal did not finish admission")
	}
}

func TestLocalSourcesAreSessionBoundAndInvalidatedOnDeletion(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store, nil, nil)
	service.localDocuments = store
	service.retrieval = retrieval.New(store, localFixtureEngine{})
	source, err := documents.Parse(ctx, documents.Input{Name: "evidence.txt", Data: []byte("The recovery copy is retained for thirty days.")})
	if err != nil {
		t.Fatal(err)
	}
	if err = service.retrieval.Import(ctx, source); err != nil {
		t.Fatal(err)
	}
	selected, err := service.PrepareLocalSources(ctx, "owner-a", []retrieval.Selection{{DocumentID: source.ID, Ordinal: 0}})
	if err != nil {
		t.Fatal(err)
	}
	if selected[0].Snapshot.Retrieval == nil || selected[0].Snapshot.Sections[0] != source.Sections[0] {
		t.Fatal("source provenance or original citation text was lost")
	}
	if _, err = service.preparedWebSources("owner-b", []string{selected[0].SourceToken}); err == nil {
		t.Fatal("another session consumed local source text")
	}
	if _, err = service.preparedWebSources("owner-a", []string{selected[0].SourceToken}); err != nil {
		t.Fatal(err)
	}
	if err = service.DeleteLocalDocument(ctx, source.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = service.preparedWebSources("owner-a", []string{selected[0].SourceToken}); err == nil {
		t.Fatal("deleted document remained in pending sources")
	}
}

func TestClearLibraryWaitsForInFlightDocumentParsing(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store, nil, nil)
	service.localDocuments = store
	service.retrieval = retrieval.New(store, localFixtureEngine{})
	parsing := make(chan struct{})
	finishParsing := make(chan struct{})
	service.documentParser = func(ctx context.Context, input documents.Input) (documents.Prepared, error) {
		close(parsing)
		<-finishParsing
		return documents.Parse(ctx, input)
	}
	imported := make(chan error, 1)
	go func() {
		imported <- service.ImportLocalDocument(ctx, documents.Input{Name: "pending.txt", Data: []byte("Pending source")})
	}()
	<-parsing
	cleared := make(chan error, 1)
	go func() { cleared <- service.ClearChatData(ctx) }()
	premature := false
	select {
	case err := <-cleared:
		if err != nil {
			t.Fatal(err)
		}
		premature = true
	case <-time.After(25 * time.Millisecond):
	}
	close(finishParsing)
	if err := <-imported; err != nil {
		t.Fatal(err)
	}
	if !premature {
		if err := <-cleared; err != nil {
			t.Fatal(err)
		}
	}
	library, err := store.ListLocalDocuments(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if premature || len(library) != 0 {
		t.Fatal("an import in progress repopulated the cleared library")
	}
}
