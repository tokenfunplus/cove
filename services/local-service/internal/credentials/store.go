package credentials

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

var (
	ErrSecretNotFound = errors.New("provider secret not found")
	ErrInvalidSecret  = errors.New("provider secret is invalid")
	ErrSecretVersion  = errors.New("provider secret changed")
)

type SecretVersion uint64

type Secret struct {
	Value   string
	Version SecretVersion
}

// SecretStore is the only domain-facing interface for provider secrets.
type SecretStore interface {
	Exists(ctx context.Context, providerID string) (bool, error)
	Get(ctx context.Context, providerID string) (Secret, error)
	ReplaceAfterValidation(ctx context.Context, providerID string, oldVersion SecretVersion, next Secret) error
	Delete(ctx context.Context, providerID string) error
}

type MemoryStore struct {
	mu             sync.Mutex
	secrets        map[string]Secret
	nextReplaceErr error
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{secrets: make(map[string]Secret)}
}

func (store *MemoryStore) Exists(_ context.Context, providerID string) (bool, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	_, ok := store.secrets[providerID]
	return ok, nil
}

func (store *MemoryStore) Get(_ context.Context, providerID string) (Secret, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	secret, ok := store.secrets[providerID]
	if !ok {
		return Secret{}, fmt.Errorf("provider %q: %w", providerID, ErrSecretNotFound)
	}
	return secret, nil
}

func (store *MemoryStore) ReplaceAfterValidation(_ context.Context, providerID string, oldVersion SecretVersion, next Secret) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.nextReplaceErr != nil {
		err := store.nextReplaceErr
		store.nextReplaceErr = nil
		return err
	}
	if next.Value == "" {
		return errors.New("provider secret is required")
	}
	current, exists := store.secrets[providerID]
	if (exists && current.Version != oldVersion) || (!exists && oldVersion != 0) {
		return ErrSecretVersion
	}
	next.Version = current.Version + 1
	store.secrets[providerID] = next
	return nil
}

func (store *MemoryStore) Delete(_ context.Context, providerID string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.secrets, providerID)
	return nil
}

// FailNextReplace is a deterministic failure hook for boundary tests.
func (store *MemoryStore) FailNextReplace(err error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.nextReplaceErr = err
}

var _ SecretStore = (*MemoryStore)(nil)
