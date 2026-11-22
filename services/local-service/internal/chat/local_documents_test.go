package chat

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/retrieval"
)

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
	for _, id := range []string{localmodels.ChatID, localmodels.Qwen3AbliteratedID} {
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
