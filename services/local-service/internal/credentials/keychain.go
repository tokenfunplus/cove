package credentials

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
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
	service string
	backend keychainBackend
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
	return exists, nil
}

func (store *KeychainStore) Get(ctx context.Context, providerID string) (Secret, error) {
	if err := ctx.Err(); err != nil {
		return Secret{}, err
	}
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
	current, err := store.Get(ctx, providerID)
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
	saved, err := store.Get(ctx, providerID)
	if err != nil || saved.Version != next.Version || saved.Value != next.Value {
		return errors.New("verify provider secret in Keychain")
	}
	return nil
}

func (store *KeychainStore) Delete(ctx context.Context, providerID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
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
