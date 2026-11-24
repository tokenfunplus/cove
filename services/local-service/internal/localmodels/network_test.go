package localmodels

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/downloadnetwork"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestRetryUsesSavedProxyAndResumesVerifiedArtifact(t *testing.T) {
	if !platformSupported() {
		t.Skip("native inference is unsupported")
	}
	root := t.TempDir()
	helper := filepath.Join(root, "helper")
	if err := os.WriteFile(helper, []byte("unused helper"), 0700); err != nil {
		t.Fatal(err)
	}
	weights := []byte("synthetic verified weights")
	digest := sha256.Sum256(weights)
	original := Registry
	Registry = []Model{{ID: ChatID, Role: "chat", SHA256: hex.EncodeToString(digest[:]), Bytes: int64(len(weights)), URL: "http://model.invalid/weights"}}
	t.Cleanup(func() { Registry = original })
	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(weights)))
		_, _ = w.Write(weights[:4])
	}))
	defer broken.Close()
	ranges := make(chan string, 1)
	healthy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ranges <- r.Header.Get("Range")
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 4-%d/%d", len(weights)-1, len(weights)))
		w.WriteHeader(206)
		_, _ = w.Write(weights[4:])
	}))
	defer healthy.Close()
	network := downloadnetwork.New(persistence.DownloadNetworkFile{Root: root}, nil)
	if _, err := network.Save(context.Background(), downloadnetwork.Settings{Mode: "manual", ProxyURL: broken.URL}); err != nil {
		t.Fatal(err)
	}
	manager := New(root, helper)
	defer manager.Close()
	manager.SetDownloadNetwork(network)
	wait := func() {
		t.Helper()
		manager.mu.Lock()
		done := manager.jobs[ChatID].done
		manager.mu.Unlock()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Fatal("download did not settle")
		}
	}
	if err := manager.Install(ChatID); err != nil {
		t.Fatal(err)
	}
	wait()
	if manager.Statuses()[0].State != "failed" {
		t.Fatal("interrupted artifact was installed")
	}
	if _, err := network.Save(context.Background(), downloadnetwork.Settings{Mode: "manual", ProxyURL: healthy.URL}); err != nil {
		t.Fatal(err)
	}
	if err := manager.Install(ChatID); err != nil {
		t.Fatal(err)
	}
	wait()
	if !manager.Installed(ChatID) {
		t.Fatalf("retry failed: %+v", manager.Statuses())
	}
	if got := <-ranges; got != "bytes=4-" {
		t.Fatalf("retry did not resume through the new proxy: %s", got)
	}
}
