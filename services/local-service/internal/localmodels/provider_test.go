package localmodels

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func TestInstalledChatModelsHaveIndependentCatalogEntries(t *testing.T) {
	if !platformSupported() {
		t.Skip("native inference is unsupported on this OS version")
	}
	root := t.TempDir()
	helper := filepath.Join(root, "helper")
	if err := os.WriteFile(helper, []byte("fixture helper"), 0700); err != nil {
		t.Fatal(err)
	}
	weights := []byte("synthetic chat weights")
	digest := sha256.Sum256(weights)
	original := Registry
	Registry = append([]Model(nil), Registry...)
	t.Cleanup(func() { Registry = original })
	for i := range Registry {
		Registry[i].SHA256 = hex.EncodeToString(digest[:])
		Registry[i].Bytes = int64(len(weights))
	}
	manager := New(root, helper)
	defer manager.Close()
	ctx := context.Background()
	install := func(id string) {
		model, _ := Lookup(id)
		if err := manager.files.Install(ctx, id, model.SHA256, model.Bytes, bytes.NewReader(weights), nil); err != nil {
			t.Fatal(err)
		}
	}
	install(Qwen3AbliteratedID)
	if !manager.Profile().Configured {
		t.Fatal("Qwen3 alone did not configure the managed Provider")
	}
	result, err := (RoutedProvider{Local: manager}).Validate(ctx, provider.ValidateInput{Profile: manager.Profile()})
	if err != nil || len(result.Models) != 1 || result.Models[0] != Qwen3AbliteratedID {
		t.Fatal("the catalog did not identify the installed Qwen3 target")
	}
	install(ChatID)
	if len(manager.Metadata()) != 2 {
		t.Fatal("installing a second chat model replaced the first")
	}
	if err := manager.Remove(ctx, Qwen3AbliteratedID); err != nil {
		t.Fatal(err)
	}
	metadata := manager.Metadata()
	if !manager.Profile().Configured || len(metadata) != 1 || metadata[0].ID != ChatID {
		t.Fatal("removing Qwen3 disabled the other installed chat model")
	}
}

func TestCancelBeforeResponseHeadersStopsLocalWorker(t *testing.T) {
	for _, id := range []string{ChatID, Qwen3AbliteratedID} {
		t.Run(id, func(t *testing.T) { testCancelBeforeResponseHeaders(t, id) })
	}
}

func testCancelBeforeResponseHeaders(t *testing.T, modelID string) {
	manager := New(t.TempDir(), "unused")
	defer manager.Close()
	command := exec.Command("/bin/sleep", "30")
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	w := &worker{command: command, done: make(chan struct{}), endpoint: "http://127.0.0.1:1", key: "synthetic-worker-key"}
	go func() { _ = command.Wait(); close(w.done) }()
	manager.workers[modelID] = w
	requested := make(chan struct{})
	w.client = &http.Client{Transport: downloadTransport(func(request *http.Request) (*http.Response, error) {
		close(requested)
		<-request.Context().Done()
		return nil, request.Context().Err()
	})}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	activity := make(chan string, 3)
	result := make(chan error, 1)
	go func() {
		_, err := (RoutedProvider{Local: manager}).Stream(ctx, provider.CompletionInput{
			Activity: func(value string) { activity <- value },
			Profile:  provider.Profile{ID: ProviderID, Kind: provider.KindLocal, Name: "Local fixture", Model: modelID, AuthMethod: provider.AuthBearer},
			Messages: []provider.ProviderMessage{{Role: "user", Content: "Test input"}},
		})
		result <- err
	}()
	select {
	case <-requested:
	case err := <-result:
		t.Fatalf("local request failed before transport: %v", err)
	case <-time.After(time.Second):
		t.Fatal("local request never started")
	}
	for _, expected := range []string{"Waiting for local inference…", "Preparing local model…", "Generating on this Mac…"} {
		if got := <-activity; got != expected {
			t.Fatalf("unexpected processing state: %q", got)
		}
	}
	cancel()
	select {
	case err := <-result:
		if err == nil || !errors.Is(ctx.Err(), context.Canceled) {
			t.Fatal("canceled request did not fail")
		}
	case <-time.After(time.Second):
		t.Fatal("local request did not stop")
	}
	select {
	case <-w.done:
	case <-time.After(time.Second):
		t.Fatal("Stop left the local worker alive before response headers")
	}
}
