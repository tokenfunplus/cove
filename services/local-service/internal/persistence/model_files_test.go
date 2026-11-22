package persistence

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestModelFilesAtomicIntegrityAndCancellation(t *testing.T) {
	files := ModelFiles{Root: t.TempDir()}
	data := []byte("a disposable model fixture")
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	if err := files.Install(context.Background(), "fixture", digest, int64(len(data)), bytes.NewReader([]byte("incorrect")), nil); err == nil {
		t.Fatal("accepted corrupt download")
	}
	if files.Installed("fixture", digest, int64(len(data))) {
		t.Fatal("published incomplete download")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := files.Install(ctx, "fixture", digest, int64(len(data)), bytes.NewReader(data), nil); err == nil {
		t.Fatal("ignored cancellation")
	}
	if err := files.Install(context.Background(), "fixture", digest, int64(len(data)), bytes.NewReader(data), nil); err != nil {
		t.Fatal(err)
	}
	path, err := files.Verify(context.Background(), "fixture", digest, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, bytes.Repeat([]byte("x"), len(data)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = files.Verify(context.Background(), "fixture", digest, int64(len(data))); err == nil {
		t.Fatal("accepted modified model")
	}
	if err = files.Remove("fixture", digest); err != nil {
		t.Fatal(err)
	}
}

func TestModelRetryAndRemovalCleanOnlyOrphanedDownloadFiles(t *testing.T) {
	files := ModelFiles{Root: t.TempDir()}
	data := []byte("retry fixture")
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	directory := filepath.Dir(files.Path("fixture", digest))
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	orphan := filepath.Join(directory, ".download-interrupted")
	retained := filepath.Join(directory, "retained.txt")
	for _, path := range []string{orphan, retained} {
		if err := os.WriteFile(path, []byte("existing file"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := files.Install(context.Background(), "fixture", digest, int64(len(data)), bytes.NewReader(data), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatal("retry retained an interrupted download")
	}
	if err := os.WriteFile(orphan, []byte("another interrupted download"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := files.Remove("fixture", digest); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatal("removal retained an interrupted download")
	}
	if _, err := os.Stat(retained); err != nil {
		t.Fatal("cleanup removed an unrelated file")
	}
}
