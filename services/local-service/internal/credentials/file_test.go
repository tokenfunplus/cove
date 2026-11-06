package credentials

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestFileStorePersistsAndRotatesSecretsWithOwnerOnlyPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "provider-secrets.json")
	store := NewFileStore(path)
	ctx := context.Background()

	if err := store.ReplaceAfterValidation(ctx, "provider-1", 0, Secret{Value: "first-key"}); err != nil {
		t.Fatalf("create file secret: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat secret file: %v", err)
	}
	if permissions := info.Mode().Perm(); permissions != 0o600 {
		t.Fatalf("secret file permissions = %o, want 600", permissions)
	}

	reopened := NewFileStore(path)
	first, err := reopened.Get(ctx, "provider-1")
	if err != nil {
		t.Fatalf("read persisted secret: %v", err)
	}
	if first.Version != 1 || first.Value != "first-key" {
		t.Fatalf("persisted secret = %#v, want version 1 and original value", first)
	}
	if err := reopened.ReplaceAfterValidation(ctx, "provider-1", first.Version, Secret{Value: "second-key"}); err != nil {
		t.Fatalf("rotate file secret: %v", err)
	}
	second, err := store.Get(ctx, "provider-1")
	if err != nil {
		t.Fatalf("read rotated secret: %v", err)
	}
	if second.Version != 2 || second.Value != "second-key" {
		t.Fatalf("rotated secret = %#v, want version 2 and replacement value", second)
	}
}

func TestFileStoreEnforcesVersionAndIdempotentDelete(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "provider-secrets.json"))
	ctx := context.Background()

	if err := store.ReplaceAfterValidation(ctx, "provider-1", 0, Secret{Value: "first-key"}); err != nil {
		t.Fatalf("seed file secret: %v", err)
	}
	if err := store.ReplaceAfterValidation(ctx, "provider-1", 0, Secret{Value: "stale-key"}); !errors.Is(err, ErrSecretVersion) {
		t.Fatalf("stale replacement error = %v, want secret version error", err)
	}
	if err := store.Delete(ctx, "provider-1"); err != nil {
		t.Fatalf("delete file secret: %v", err)
	}
	if err := store.Delete(ctx, "provider-1"); err != nil {
		t.Fatalf("delete absent file secret: %v", err)
	}
	if _, err := store.Get(ctx, "provider-1"); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("deleted secret error = %v, want not found", err)
	}
}
