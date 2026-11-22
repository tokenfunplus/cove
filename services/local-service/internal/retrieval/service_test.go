package retrieval

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

type fixtureEngine struct{}

func (fixtureEngine) Installed(string) bool { return true }
func (fixtureEngine) Embed(_ context.Context, texts []string) ([][]float32, error) {
	result := make([][]float32, len(texts))
	for i, text := range texts {
		result[i] = make([]float32, 512)
		if strings.Contains(text, "orchard") {
			result[i][0] = 1
		} else {
			result[i][1] = 1
		}
	}
	return result, nil
}

func TestCanceledLibraryOperationNeverRuns(t *testing.T) {
	service := New(nil, fixtureEngine{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for range 100 {
		called := false
		err := service.Exclusive(ctx, func() error { called = true; return nil })
		if called || !errors.Is(err, context.Canceled) {
			t.Fatal("already canceled library operation was admitted")
		}
	}
}
func TestSelectedScopeCitationsDeletionAndReindex(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := New(store, fixtureEngine{})
	first, _ := documents.Parse(ctx, documents.Input{Name: "garden.txt", Data: []byte("orchard apples\n" + strings.Repeat("watering instructions ", 30))})
	second, _ := documents.Parse(ctx, documents.Input{Name: "private.txt", Data: []byte("orchard unrelated private source")})
	if err = service.Import(ctx, first); err != nil {
		t.Fatal(err)
	}
	if err = service.Import(ctx, second); err != nil {
		t.Fatal(err)
	}
	result, err := service.Search(ctx, []string{first.ID}, "orchard fruit")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Hits) == 0 {
		t.Fatal("missing search results")
	}
	for _, hit := range result.Hits {
		if hit.DocumentID != first.ID {
			t.Fatal("searched an unselected document")
		}
		for _, section := range hit.Source.Sections {
			found := false
			for _, original := range first.Sections {
				if original == section {
					found = true
				}
			}
			if !found {
				t.Fatal("citation does not point to original text")
			}
		}
	}
	if err = service.Selected(ctx, []Selection{{DocumentID: first.ID, Ordinal: 0}}, func(sources []documents.Prepared) error {
		if len(sources) != 1 || string(sources[0].Data) != string(first.Data) {
			t.Fatal("lost original bytes")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err = store.DeleteLocalDocument(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Search(ctx, []string{first.ID}, "orchard"); err == nil {
		t.Fatal("searched a deleted document")
	}
	if err = service.Selected(ctx, []Selection{{DocumentID: first.ID, Ordinal: 0}}, func([]documents.Prepared) error { return nil }); err == nil {
		t.Fatal("prepared a deleted source")
	}
	if err = store.ClearLocalIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	items, _ := store.ListLocalDocuments(ctx)
	if len(items) != 1 || items[0].Chunks != 0 {
		t.Fatal("index removal lost documents or retained vectors")
	}
	if err = store.ClearChatData(ctx); err != nil {
		t.Fatal(err)
	}
	items, _ = store.ListLocalDocuments(ctx)
	if len(items) != 0 {
		t.Fatal("clearing data retained library sources")
	}
}

func TestChunkBoundsPreserveOriginalSectionIDs(t *testing.T) {
	source := documents.Snapshot{ID: "fixture", Sections: []documents.Section{{ID: "P3", Text: strings.Repeat("word ", 600)}, {ID: "P7", Text: "ending"}}}
	chunks := Chunks(source)
	if len(chunks) < 2 {
		t.Fatal("long section was not split")
	}
	for _, chunk := range chunks {
		if len([]rune(chunk.Text)) > 320 {
			t.Fatal("chunk exceeds model input budget")
		}
		if len(chunk.Sections) == 0 {
			t.Fatal("chunk lost page identity")
		}
	}
}
