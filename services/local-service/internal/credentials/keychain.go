package credentials

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
)

const defaultKeychainService = "io.github.tokenfunplus.cove.provider"

const encodedSecretPrefix = "cove-v1:"

type keychainBackend interface {
	Exists(service, account string) (bool, error)
	Get(service, account string) ([]byte, error)
	Replace(service, account string, value []byte) error
	Delete(service, account string) error
}

// KeychainStore keeps provider secrets in the user's macOS Keychain.
// The platform adapter is isolated here so callers only depend on SecretStore.
type KeychainStore struct {
	service    string
	backend    keychainBackend
	mu         sync.Mutex
	operations sync.Mutex
	cache      map[string]Secret
	reads      map[string]*keychainRead
}

type keychainRead struct {
	done   chan struct{}
	secret Secret
	err    error
}

func NewKeychainStore(service string) *KeychainStore {
	if service == "" {
		service = defaultKeychainService
	}
	return &KeychainStore{service: service, backend: newKeychainBackend()}
}

func (store *KeychainStore) Exists(ctx context.Context, providerID string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	exists, err := store.backend.Exists(store.service, providerID)
	if err != nil {
		return false, fmt.Errorf("check provider secret: %w", err)
	}
	if !exists {
		store.forget(providerID)
	}
	return exists, nil
}

func (store *KeychainStore) Get(ctx context.Context, providerID string) (Secret, error) {
	if err := ctx.Err(); err != nil {
		return Secret{}, err
	}
	store.mu.Lock()
	if secret, ok := store.cache[providerID]; ok {
		store.mu.Unlock()
		return secret, nil
	}
	if pending := store.reads[providerID]; pending != nil {
		store.mu.Unlock()
		select {
		case <-ctx.Done():
			return Secret{}, ctx.Err()
		case <-pending.done:
			return pending.secret, pending.err
		}
	}
	pending := &keychainRead{done: make(chan struct{})}
	if store.reads == nil {
		store.reads = make(map[string]*keychainRead)
	}
	store.reads[providerID] = pending
	store.mu.Unlock()

	// Serialize native reads with rotation/deletion. Concurrent callers share
	// this result, including a cancelled/denied authorization, without queuing dialogs.
	store.operations.Lock()
	defer store.operations.Unlock()
	store.mu.Lock()
	secret, cached := store.cache[providerID]
	store.mu.Unlock()
	var err error
	if !cached {
		if err = ctx.Err(); err == nil {
			secret, err = store.readSecret(providerID)
		}
	}
	store.mu.Lock()
	if err == nil {
		if store.cache == nil {
			store.cache = make(map[string]Secret)
		}
		store.cache[providerID] = secret
	}
	pending.secret, pending.err = secret, err
	delete(store.reads, providerID)
	close(pending.done)
	store.mu.Unlock()
	return secret, err
}

func (store *KeychainStore) readSecret(providerID string) (Secret, error) {
	output, err := store.backend.Get(store.service, providerID)
	if err != nil {
		if errors.Is(err, ErrSecretNotFound) {
			return Secret{}, fmt.Errorf("read provider secret: %w", ErrSecretNotFound)
		}
		return Secret{}, fmt.Errorf("read provider secret: %w", err)
	}
	secret, err := decodeSecret(strings.TrimSuffix(string(output), "\n"))
	if err != nil {
		return Secret{}, fmt.Errorf("%w: %v", ErrInvalidSecret, err)
	}
	return secret, nil
}

func (store *KeychainStore) ReplaceAfterValidation(ctx context.Context, providerID string, oldVersion SecretVersion, next Secret) error {
	if strings.TrimSpace(next.Value) == "" {
		return errors.New("provider secret is required")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	store.operations.Lock()
	defer store.operations.Unlock()
	store.forget(providerID)
	// Compare against Keychain itself, never a process-cached version. Another
	// Local Service may have rotated the key since our last successful read.
	current, err := store.readSecret(providerID)
	if errors.Is(err, ErrSecretNotFound) {
		current = Secret{}
	} else if errors.Is(err, ErrInvalidSecret) {
		current = Secret{}
	} else if err != nil {
		return err
	}
	if current.Version != oldVersion {
		return ErrSecretVersion
	}
	next.Version = current.Version + 1
	payload := encodeSecret(next)
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := store.backend.Replace(store.service, providerID, []byte(payload)); err != nil {
		return errors.New("write provider secret to Keychain")
	}
	saved, err := store.readSecret(providerID)
	if err != nil || saved.Version != next.Version || saved.Value != next.Value {
		return errors.New("verify provider secret in Keychain")
	}
	store.mu.Lock()
	if store.cache == nil {
		store.cache = make(map[string]Secret)
	}
	store.cache[providerID] = saved
	store.mu.Unlock()
	return nil
}

func (store *KeychainStore) Delete(ctx context.Context, providerID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	store.operations.Lock()
	defer store.operations.Unlock()
	store.forget(providerID)
	err := store.backend.Delete(store.service, providerID)
	if errors.Is(err, ErrSecretNotFound) {
		return nil
	}
	if err != nil {
		// Deleting an already absent Keychain item is idempotent.
		return errors.New("delete provider secret from Keychain")
	}
	return nil
}

func (store *KeychainStore) forget(providerID string) {
	store.mu.Lock()
	delete(store.cache, providerID)
	store.mu.Unlock()
}

func encodeSecret(secret Secret) string {
	return encodedSecretPrefix + strconv.FormatUint(uint64(secret.Version), 10) + ":" + base64.RawURLEncoding.EncodeToString([]byte(secret.Value))
}

func decodeSecret(payload string) (Secret, error) {
	if strings.HasPrefix(payload, encodedSecretPrefix) {
		parts := strings.Split(payload, ":")
		if len(parts) != 3 || parts[0]+":" != encodedSecretPrefix || parts[1] == "" || parts[2] == "" {
			return Secret{}, errors.New("versioned provider secret is invalid")
		}
		version, err := strconv.ParseUint(parts[1], 10, 64)
		if err != nil {
			return Secret{}, errors.New("versioned provider secret has an invalid version")
		}
		value, err := base64.RawURLEncoding.DecodeString(parts[2])
		if err != nil || len(value) == 0 {
			return Secret{}, errors.New("versioned provider secret has an invalid value")
		}
		return Secret{Version: SecretVersion(version), Value: string(value)}, nil
	}

	versionAndValue := strings.SplitN(payload, "\n", 2)
	if len(versionAndValue) != 2 {
		return Secret{}, errors.New("provider secret in Keychain is invalid")
	}
	version, err := strconv.ParseUint(versionAndValue[0], 10, 64)
	if err != nil || versionAndValue[1] == "" {
		return Secret{}, errors.New("provider secret in Keychain is invalid")
	}
	return Secret{Version: SecretVersion(version), Value: versionAndValue[1]}, nil
}

var _ SecretStore = (*KeychainStore)(nil)
