package persistence

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestArtifactResumeFallbackIntegrityAndCancellation(t *testing.T) {
	data := []byte("a pinned resumable artifact")
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	size := int64(len(data))
	for _, honorRange := range []bool{true, false} {
		t.Run(fmt.Sprint(honorRange), func(t *testing.T) {
			files := ModelFiles{Root: t.TempDir()}
			directory := filepath.Dir(files.Path("fixture", digest))
			partial := filepath.Join(directory, ".download-"+digest+".partial")
			err := files.Download(context.Background(), "fixture", digest, size, func(offset int64) (io.ReadCloser, bool, error) {
				return io.NopCloser(bytes.NewReader(data[:8])), false, nil
			}, nil)
			if err == nil || files.Installed("fixture", digest, size) {
				t.Fatal("incomplete artifact published")
			}
			if info, err := os.Stat(partial); err != nil || info.Size() != 8 {
				t.Fatal("interrupted bytes lost", err)
			}
			err = files.Download(context.Background(), "fixture", digest, size, func(offset int64) (io.ReadCloser, bool, error) {
				if offset != 8 {
					t.Fatalf("wrong range offset: %d", offset)
				}
				if honorRange {
					return io.NopCloser(bytes.NewReader(data[offset:])), true, nil
				}
				return io.NopCloser(bytes.NewReader(data)), false, nil
			}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = files.Verify(context.Background(), "fixture", digest, size); err != nil {
				t.Fatal(err)
			}
			if _, err = os.Stat(partial); !os.IsNotExist(err) {
				t.Fatal("published artifact retained partial")
			}
		})
	}
	files := ModelFiles{Root: t.TempDir()}
	err := files.Download(context.Background(), "fixture", digest, size, func(int64) (io.ReadCloser, bool, error) {
		return io.NopCloser(bytes.NewReader(bytes.Repeat([]byte("x"), len(data)))), false, nil
	}, nil)
	if err == nil {
		t.Fatal("corrupt artifact published")
	}
	directory := filepath.Dir(files.Path("fixture", digest))
	entries, _ := os.ReadDir(directory)
	if len(entries) != 0 {
		t.Fatal("corrupt resume data retained")
	}
	ctx, cancel := context.WithCancel(context.Background())
	err = files.Download(ctx, "fixture", digest, size, func(int64) (io.ReadCloser, bool, error) { return io.NopCloser(bytes.NewReader(data)), false, nil }, func(n int64) {
		if n > 0 {
			cancel()
		}
	})
	if err == nil {
		t.Fatal("ignored explicit cancellation")
	}
	entries, _ = os.ReadDir(directory)
	if len(entries) != 0 {
		t.Fatal("cancel retained partial")
	}
}

func TestSpeechBundleRetryReusesVerifiedAssetsAndResumesOnlyTheInterruptedFile(t *testing.T) {
	ctx := context.Background()
	files := ModelBundles{Root: t.TempDir()}
	data := map[string][]byte{"first.bin": []byte("first complete asset"), "second.bin": []byte("second complete asset")}
	bundle := ModelBundle{ID: "fixture", SHA256: fmt.Sprintf("%x", sha256.Sum256([]byte("bundle"))), Required: []string{"first.bin", "second.bin"}}
	for _, name := range bundle.Required {
		bundle.Artifacts = append(bundle.Artifacts, BundleArtifact{Filename: name, SHA256: fmt.Sprintf("%x", sha256.Sum256(data[name])), Bytes: int64(len(data[name]))})
	}
	err := files.InstallResumable(ctx, bundle, func(asset BundleArtifact, offset int64) (io.ReadCloser, bool, error) {
		value := data[asset.Filename]
		if asset.Filename == "second.bin" {
			value = value[:4]
		}
		return io.NopCloser(bytes.NewReader(value)), false, nil
	}, nil)
	if err == nil || files.Installed(bundle) {
		t.Fatal("incomplete bundle installed")
	}
	calls := 0
	err = files.InstallResumable(ctx, bundle, func(asset BundleArtifact, offset int64) (io.ReadCloser, bool, error) {
		calls++
		if asset.Filename != "second.bin" || offset != 4 {
			t.Fatalf("verified asset redownloaded or incorrect range: %s %d", asset.Filename, offset)
		}
		return io.NopCloser(bytes.NewReader(data[asset.Filename][offset:])), true, nil
	}, nil)
	if err != nil || calls != 1 || !files.Installed(bundle) {
		t.Fatal("bundle retry failed", err)
	}
	if err = files.Verify(ctx, bundle); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(filepath.Dir(files.Path(bundle)), ".resume-"+bundle.SHA256)); !os.IsNotExist(err) {
		t.Fatal("successful install retained compressed cache")
	}
}

func TestAlreadyCanceledRetryDiscardsSavedPartialWithoutFetching(t *testing.T) {
	files := ModelFiles{Root: t.TempDir()}
	data := []byte("saved interrupted bytes")
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	partial := filepath.Join(filepath.Dir(files.Path("fixture", digest)), ".download-"+digest+".partial")
	if err := os.MkdirAll(filepath.Dir(partial), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(partial, data[:5], 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	fetched := false
	err := files.Download(ctx, "fixture", digest, int64(len(data)), func(int64) (io.ReadCloser, bool, error) { fetched = true; return nil, false, nil }, nil)
	if !errors.Is(err, context.Canceled) || fetched {
		t.Fatal("canceled retry fetched bytes or lost cancellation", err)
	}
	if _, err = os.Stat(partial); !os.IsNotExist(err) {
		t.Fatal("already canceled retry retained partial", err)
	}
}
