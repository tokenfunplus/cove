package retrieval_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/retrieval"
)

// Explicit opt-in: downloads public pinned weights and launches the native runtime.
func TestRealLocalRetrievalAcceptance(t *testing.T) {
	if os.Getenv("COVE_TEST_LOCAL_INFERENCE") != "1" {
		t.Skip("set COVE_TEST_LOCAL_INFERENCE=1 for real model acceptance")
	}
	root := os.Getenv("COVE_DATA_DIR")
	if root == "" {
		root = t.TempDir()
	}
	if !temporaryDescendant(root, os.TempDir()) && !temporaryDescendant(root, "/private/tmp") {
		t.Fatal("acceptance requires a temporary COVE_DATA_DIR")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	runtime := os.Getenv("COVE_INFERENCE_RUNTIME")
	if runtime == "" {
		t.Fatal("COVE_INFERENCE_RUNTIME is required")
	}
	manager := localmodels.New(root, runtime)
	defer manager.Close()
	started := time.Now()
	if err := manager.Install(localmodels.EmbeddingID); err != nil {
		t.Fatal(err)
	}
	for !manager.Installed(localmodels.EmbeddingID) {
		if ctx.Err() != nil {
			t.Fatal(ctx.Err())
		}
		for _, s := range manager.Statuses() {
			if s.ID == localmodels.EmbeddingID && s.State == "failed" {
				t.Fatal(s.Error)
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	downloadMS := time.Since(started).Milliseconds()
	store, err := persistence.OpenSQLite(filepath.Join(root, "acceptance.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := retrieval.New(store, manager)
	var cases []struct{ ID, Text, Query string }
	data, err := os.ReadFile("testdata/chinese-retrieval.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	sources := make([]documents.Prepared, 4)
	expected := map[string]struct{ ID, Section string }{}
	for group := 0; group < 4; group++ {
		lines := []string{}
		for _, c := range cases[group*3 : group*3+3] {
			lines = append(lines, strings.Repeat(c.Text, 5))
		}
		source, err := documents.Parse(ctx, documents.Input{Name: fmt.Sprintf("acceptance-%d.txt", group), Data: []byte(strings.Join(lines, "\n"))})
		if err != nil {
			t.Fatal(err)
		}
		sources[group] = source
		for offset, c := range cases[group*3 : group*3+3] {
			expected[c.ID] = struct{ ID, Section string }{source.ID, fmt.Sprintf("L%d", offset+1)}
		}
	}
	started = time.Now()
	if _, err = manager.Embed(ctx, []string{"local model readiness"}); err != nil {
		t.Fatal(err)
	}
	coldMS := time.Since(started).Milliseconds()
	started = time.Now()
	for _, source := range sources {
		if err = service.Import(ctx, source); err != nil {
			t.Fatal(err)
		}
	}
	indexMS := time.Since(started).Milliseconds()
	ids := []string{}
	originals := map[string]documents.Prepared{}
	for _, source := range sources {
		ids = append(ids, source.ID)
		originals[source.ID] = source
	}
	hits, validCitations, citations := 0, 0, 0
	var totalLatency int64
	for _, c := range cases {
		result, err := service.Search(ctx, ids, c.Query)
		if err != nil {
			t.Fatal(err)
		}
		totalLatency += result.ElapsedMS
		found := false
		for rank, hit := range result.Hits {
			want := expected[c.ID]
			if rank < 3 && hit.DocumentID == want.ID {
				for _, section := range hit.Source.Sections {
					if section.ID == want.Section {
						found = true
					}
				}
			}
			for _, section := range hit.Source.Sections {
				citations++
				for _, original := range originals[hit.DocumentID].Sections {
					if original == section {
						validCitations++
						break
					}
				}
			}
		}
		if found {
			hits++
		} else {
			t.Logf("miss: %s", c.ID)
		}
	}
	if hits*10 < len(cases)*9 {
		t.Errorf("Recall@3: %d/%d below 90%% synthetic acceptance gate", hits, len(cases))
	}
	if validCitations != citations || citations == 0 {
		t.Fatalf("source section fidelity: %d/%d", validCitations, citations)
	}
	scoped, err := service.Search(ctx, ids[:1], cases[7].Query)
	if err != nil {
		t.Fatal(err)
	}
	for _, hit := range scoped.Hits {
		if hit.DocumentID != ids[0] {
			t.Fatal("unselected document leaked into search")
		}
	}
	if err = store.DeleteLocalDocument(ctx, ids[0]); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Search(ctx, ids[:1], cases[0].Query); err == nil {
		t.Fatal("deleted document remained searchable")
	}
	if err = manager.Unload(ctx, localmodels.EmbeddingID); err != nil {
		t.Fatal(err)
	}
	t.Logf("REAL ACCEPTANCE: recall@3=%d/%d; citation fidelity=%d/%d; download_ms=%d; cold_embedding_ms=%d; index_ms=%d; mean_query_ms=%d; peak_process_rss_bytes=%d; scope and deletion passed", hits, len(cases), validCitations, citations, downloadMS, coldMS, indexMS, totalLatency/int64(len(cases)), manager.Measurement(localmodels.EmbeddingID).PeakResidentBytes)
}

func temporaryDescendant(path, base string) bool {
	absolute, err := canonicalAcceptancePath(path)
	if err != nil {
		return false
	}
	basePath, err := canonicalAcceptancePath(base)
	if err != nil {
		return false
	}
	relative, err := filepath.Rel(basePath, absolute)
	return err == nil && relative != "." && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
func TestTemporaryAcceptanceContainment(t *testing.T) {
	for _, path := range []string{"/tmp-backup/cove", "/tmp/../cove-outside/cove", "/tmp"} {
		if temporaryDescendant(path, "/tmp") {
			t.Fatalf("accepted outside temporary descendant: %s", path)
		}
	}
	if !temporaryDescendant("/tmp/cove-test", "/tmp") {
		t.Fatal("rejected a temporary descendant")
	}
}

func canonicalAcceptancePath(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	var tail []string
	for {
		resolved, err := filepath.EvalSymlinks(absolute)
		if err == nil {
			for i := len(tail) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, tail[i])
			}
			return resolved, nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(absolute)
		if parent == absolute {
			return "", err
		}
		tail = append(tail, filepath.Base(absolute))
		absolute = parent
	}
}
