package credentials

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// FileStore is an explicitly insecure test adapter. It prevents macOS
// Keychain prompts by keeping provider secrets in an owner-readable file.
type FileStore struct {
	path string
	mu   sync.Mutex
}

type fileStoreDocument struct {
	Secrets map[string]fileSecret `json:"secrets"`
}

type fileSecret struct {
	Value   string        `json:"value"`
	Version SecretVersion `json:"version"`
}

func NewFileStore(path string) *FileStore {
	return &FileStore{path: path}
}

func (store *FileStore) Exists(ctx context.Context, providerID string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	document, err := store.read()
	if err != nil {
		return false, err
	}
	_, exists := document.Secrets[providerID]
	return exists, nil
}

func (store *FileStore) Get(ctx context.Context, providerID string) (Secret, error) {
	if err := ctx.Err(); err != nil {
		return Secret{}, err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	document, err := store.read()
	if err != nil {
		return Secret{}, err
	}
	saved, exists := document.Secrets[providerID]
	if !exists {
		return Secret{}, fmt.Errorf("provider %q: %w", providerID, ErrSecretNotFound)
	}
	if saved.Version == 0 || saved.Value == "" {
		return Secret{}, fmt.Errorf("provider %q: %w", providerID, ErrInvalidSecret)
	}
	return Secret{Value: saved.Value, Version: saved.Version}, nil
}

func (store *FileStore) ReplaceAfterValidation(ctx context.Context, providerID string, oldVersion SecretVersion, next Secret) error {
	if strings.TrimSpace(next.Value) == "" {
		return errors.New("provider secret is required")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	document, err := store.read()
	if err != nil {
		return err
	}
	current, exists := document.Secrets[providerID]
	if (exists && current.Version != oldVersion) || (!exists && oldVersion != 0) {
		return ErrSecretVersion
	}
	next.Version = current.Version + 1
	document.Secrets[providerID] = fileSecret{Value: next.Value, Version: next.Version}
	if err := ctx.Err(); err != nil {
		return err
	}
	return store.write(document)
}

func (store *FileStore) Delete(ctx context.Context, providerID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	document, err := store.read()
	if err != nil {
		return err
	}
	if _, exists := document.Secrets[providerID]; !exists {
		return nil
	}
	delete(document.Secrets, providerID)
	return store.write(document)
}

func (store *FileStore) read() (fileStoreDocument, error) {
	info, err := os.Lstat(store.path)
	if errors.Is(err, os.ErrNotExist) {
		return fileStoreDocument{Secrets: make(map[string]fileSecret)}, nil
	}
	if err != nil {
		return fileStoreDocument{}, fmt.Errorf("inspect test secret file: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return fileStoreDocument{}, errors.New("test secret file must be a regular owner-only file")
	}
	payload, err := os.ReadFile(store.path)
	if err != nil {
		return fileStoreDocument{}, fmt.Errorf("read test secret file: %w", err)
	}
	var document fileStoreDocument
	if err := json.Unmarshal(payload, &document); err != nil || document.Secrets == nil {
		return fileStoreDocument{}, fmt.Errorf("%w: test secret file is malformed", ErrInvalidSecret)
	}
	return document, nil
}

func (store *FileStore) write(document fileStoreDocument) error {
	directory := filepath.Dir(store.path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create test secret directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".provider-secrets-*")
	if err != nil {
		return fmt.Errorf("create test secret file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect test secret file: %w", err)
	}
	encoder := json.NewEncoder(temporary)
	if err := encoder.Encode(document); err != nil {
		temporary.Close()
		return fmt.Errorf("encode test secret file: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync test secret file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close test secret file: %w", err)
	}
	if err := os.Rename(temporaryPath, store.path); err != nil {
		return fmt.Errorf("replace test secret file: %w", err)
	}
	return nil
}

var _ SecretStore = (*FileStore)(nil)
