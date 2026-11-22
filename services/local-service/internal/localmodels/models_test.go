package localmodels

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type downloadTransport func(*http.Request) (*http.Response, error)

func (transport downloadTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestCanceledInferenceNeverAcquiresAvailableLease(t *testing.T) {
	manager := New(t.TempDir(), "unused")
	defer manager.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for range 100 {
		if err := manager.acquire(ctx); err == nil {
			manager.release()
			t.Fatal("already canceled inference acquired a lease")
		} else if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	}
}

type interruptedDownload struct {
	ctx     context.Context
	first   bool
	waiting chan struct{}
}

func (body *interruptedDownload) Read(buffer []byte) (int, error) {
	if !body.first {
		body.first = true
		return copy(buffer, "test"), nil
	}
	close(body.waiting)
	<-body.ctx.Done()
	return 0, body.ctx.Err()
}
func (*interruptedDownload) Close() error { return nil }

func TestManagedDownloadCancellationRetryAndRemoval(t *testing.T) {
	if !platformSupported() {
		t.Skip("native inference is unsupported on this OS version")
	}
	root := t.TempDir()
	helper := filepath.Join(root, "helper")
	if err := os.WriteFile(helper, []byte("unused test helper"), 0700); err != nil {
		t.Fatal(err)
	}
	weights := []byte("test model weights")
	digest := sha256.Sum256(weights)
	original := Registry
	Registry = []Model{{ID: EmbeddingID, Role: "embedding", SHA256: hex.EncodeToString(digest[:]), Bytes: int64(len(weights)), URL: "https://huggingface.co/test/model"}}
	t.Cleanup(func() { Registry = original })
	manager := New(root, helper)
	defer manager.Close()
	waiting := make(chan struct{})
	manager.client = &http.Client{Transport: downloadTransport(func(request *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: &interruptedDownload{ctx: request.Context(), waiting: waiting}}, nil
	})}
	if err := manager.Install(EmbeddingID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-waiting:
	case <-time.After(time.Second):
		t.Fatal("download did not make progress")
	}
	status := manager.Statuses()[0]
	if status.State != "downloading" || status.Downloaded != 4 || manager.Installed(EmbeddingID) {
		t.Fatalf("partial download was incorrectly exposed: state=%s bytes=%d", status.State, status.Downloaded)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := manager.CancelDownload(ctx, EmbeddingID); err != nil {
		t.Fatal(err)
	}
	if status = manager.Statuses()[0]; status.State != "not_installed" || status.Error != "" {
		t.Fatalf("cancel did not reset state: %s", status.State)
	}
	err := filepath.WalkDir(filepath.Join(root, "models"), func(path string, entry fs.DirEntry, err error) error {
		if err == nil && strings.HasPrefix(entry.Name(), ".download-") {
			t.Error("canceled download retained a partial file")
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	manager.client = &http.Client{Transport: downloadTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(weights))}, nil
	})}
	if err := manager.Install(EmbeddingID); err != nil {
		t.Fatal(err)
	}
	manager.mu.Lock()
	done := manager.jobs[EmbeddingID].done
	manager.mu.Unlock()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("retry did not complete")
	}
	if !manager.Installed(EmbeddingID) || manager.Statuses()[0].State != "installed" {
		t.Fatal("verified retry was not installed")
	}
	removeCtx, removeCancel := context.WithTimeout(context.Background(), time.Second)
	defer removeCancel()
	if err := manager.Remove(removeCtx, EmbeddingID); err != nil {
		t.Fatal(err)
	}
	if manager.Installed(EmbeddingID) || manager.Statuses()[0].State != "not_installed" {
		t.Fatal("model remained installed after removal")
	}
}
