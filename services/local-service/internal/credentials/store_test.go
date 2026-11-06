package credentials

import (
	"context"
	"errors"
	"testing"
)

func TestMemorySecretStoreKeepsThePreviousSecretWhenReplacementCannotBeCommitted(t *testing.T) {
	store := NewMemoryStore()
	ctx := context.Background()

	if err := store.ReplaceAfterValidation(ctx, "provider-1", 0, Secret{Value: "old-key"}); err != nil {
		t.Fatalf("seed secret: %v", err)
	}
	old, err := store.Get(ctx, "provider-1")
	if err != nil {
		t.Fatalf("read seeded secret: %v", err)
	}

	store.FailNextReplace(errors.New("keychain unavailable"))
	if err := store.ReplaceAfterValidation(ctx, "provider-1", old.Version, Secret{Value: "new-key"}); err == nil {
		t.Fatal("replacement succeeded while the secret store was unavailable")
	}

	current, err := store.Get(ctx, "provider-1")
	if err != nil {
		t.Fatalf("read secret after failed replacement: %v", err)
	}
	if current.Value != "old-key" {
		t.Fatalf("secret after failed replacement = %q, want old secret", current.Value)
	}
}

func TestMemorySecretStoreReportsSecretExistence(t *testing.T) {
	store := NewMemoryStore()
	ctx := context.Background()

	exists, err := store.Exists(ctx, "provider-1")
	if err != nil || exists {
		t.Fatalf("missing secret existence = %t, %v", exists, err)
	}
	if err := store.ReplaceAfterValidation(ctx, "provider-1", 0, Secret{Value: "fixture-key"}); err != nil {
		t.Fatalf("seed secret: %v", err)
	}
	exists, err = store.Exists(ctx, "provider-1")
	if err != nil || !exists {
		t.Fatalf("stored secret existence = %t, %v", exists, err)
	}
}
