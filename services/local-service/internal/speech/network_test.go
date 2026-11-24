package speech

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/downloadnetwork"
	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestSpeechInstallUsesConfiguredDownloadProxy(t *testing.T) {
	if !localmodels.PlatformSupported() {
		t.Skip("native speech is unsupported")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "cove-speech-worker"), []byte("unused helper"), 0700); err != nil {
		t.Fatal(err)
	}
	weights := []byte("synthetic speech weights")
	digest := sha256.Sum256(weights)
	hash := hex.EncodeToString(digest[:])
	original := Registry
	Registry = []Model{{Model: localmodels.Model{ID: "speech-fixture", Role: "tts", SHA256: hash, Bytes: int64(len(weights))}, Artifacts: []Artifact{{BundleArtifact: persistence.BundleArtifact{Filename: "model.bin", SHA256: hash, Bytes: int64(len(weights))}, URL: "http://speech.invalid/model.bin"}}, Required: []string{"model.bin"}}}
	t.Cleanup(func() { Registry = original })
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Host != "speech.invalid" {
			t.Error("wrong proxy destination")
		}
		_, _ = w.Write(weights)
	}))
	defer proxy.Close()
	network := downloadnetwork.New(persistence.DownloadNetworkFile{Root: root}, nil)
	if _, err := network.Save(context.Background(), downloadnetwork.Settings{Mode: "manual", ProxyURL: proxy.URL}); err != nil {
		t.Fatal(err)
	}
	manager := New(root, root, nil)
	defer manager.Close()
	manager.SetDownloadNetwork(network)
	if err := manager.Install("speech-fixture"); err != nil {
		t.Fatal(err)
	}
	manager.mu.Lock()
	done := manager.installs["speech-fixture"].done
	manager.mu.Unlock()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("speech download did not settle")
	}
	if manager.Statuses()[0].State != "installed" {
		t.Fatalf("speech proxy install failed: %+v", manager.Statuses())
	}
}
