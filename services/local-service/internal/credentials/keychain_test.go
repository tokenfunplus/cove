package credentials

import (
	"context"
	"fmt"
	"runtime"
	"testing"
	"time"
)

func TestKeychainStoreEncodesSecretBeforeNativeBackend(t *testing.T) {
	backend := &recordingKeychainBackend{value: []byte("1\nold-key\n")}
	store := &KeychainStore{service: "test-service", backend: backend}
	current, err := store.Get(context.Background(), "provider-1")
	if err != nil {
		t.Fatalf("read keychain secret: %v", err)
	}
	if err := store.ReplaceAfterValidation(context.Background(), "provider-1", current.Version, Secret{Value: "new-key"}); err != nil {
		t.Fatalf("replace keychain secret: %v", err)
	}
	if backend.replaceCalls != 1 || backend.lastValue != "cove-v1:2:bmV3LWtleQ" {
		t.Fatalf("backend replace calls = %d, value = %q", backend.replaceCalls, backend.lastValue)
	}
}

func TestKeychainStoreReadsVersionedOneLineSecret(t *testing.T) {
	store := &KeychainStore{service: "test-service", backend: &recordingKeychainBackend{value: []byte("cove-v1:3:bGluZTEKbGluZTI\n")}}

	secret, err := store.Get(context.Background(), "provider-1")
	if err != nil {
		t.Fatalf("read versioned secret: %v", err)
	}
	if secret.Version != 3 || secret.Value != "line1\nline2" {
		t.Fatalf("secret = %#v, want version 3 and original value", secret)
	}
}

func TestKeychainStoreChecksSecretExistenceWithoutReadingIt(t *testing.T) {
	backend := &recordingKeychainBackend{value: []byte("cove-v1:1:Zml4dHVyZS1rZXk")}
	store := &KeychainStore{service: "test-service", backend: backend}

	exists, err := store.Exists(context.Background(), "provider-1")
	if err != nil {
		t.Fatalf("check keychain secret: %v", err)
	}
	if !exists {
		t.Fatal("existing keychain secret was reported missing")
	}
	if backend.getCalls != 0 {
		t.Fatalf("existence check read %d secrets, want metadata-only query", backend.getCalls)
	}
}

func TestKeychainStoreReplacesMalformedExistingSecretAfterValidation(t *testing.T) {
	backend := &recordingKeychainBackend{value: []byte("\n")}
	store := &KeychainStore{service: "test-service", backend: backend}

	if err := store.ReplaceAfterValidation(context.Background(), "provider-1", 0, Secret{Value: "new-key"}); err != nil {
		t.Fatalf("replace malformed secret after validation: %v", err)
	}
	if backend.lastValue != "cove-v1:1:bmV3LWtleQ" {
		t.Fatalf("backend value = %q, want replacement value", backend.lastValue)
	}
}

func TestKeychainStoreRejectsSuccessfulBackendWhenSecretWasNotPersisted(t *testing.T) {
	store := &KeychainStore{service: "test-service", backend: &nonPersistingKeychainBackend{}}

	err := store.ReplaceAfterValidation(context.Background(), "provider-1", 0, Secret{Value: "new-key"})
	if err == nil {
		t.Fatal("replace succeeded even though Keychain did not persist the secret")
	}
}

func TestKeychainStorePersistsThroughTheNativeKeychainBackend(t *testing.T) {
	backend := &recordingKeychainBackend{}
	store := &KeychainStore{service: "test-service", backend: backend}

	if err := store.ReplaceAfterValidation(context.Background(), "provider-1", 0, Secret{Value: "new-key"}); err != nil {
		t.Fatalf("replace provider secret: %v", err)
	}
	if backend.replaceCalls != 1 || backend.lastValue != "cove-v1:1:bmV3LWtleQ" {
		t.Fatalf("backend replace calls = %d, value = %q", backend.replaceCalls, backend.lastValue)
	}
}

func TestKeychainStoreRoundTripsThroughMacOSKeychain(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS Keychain is only available on Darwin")
	}

	serviceName := fmt.Sprintf("io.github.tokenfunplus.cove.test.%d", time.Now().UnixNano())
	accountName := fmt.Sprintf("test-provider-%d", time.Now().UnixNano())
	store := NewKeychainStore(serviceName)
	t.Cleanup(func() {
		_ = store.Delete(context.Background(), accountName)
	})
	if err := store.ReplaceAfterValidation(context.Background(), accountName, 0, Secret{Value: "fixture-key"}); err != nil {
		t.Fatalf("create Keychain secret: %v", err)
	}
	exists, err := store.Exists(context.Background(), accountName)
	if err != nil || !exists {
		t.Fatalf("check created Keychain secret: exists = %t, err = %v", exists, err)
	}
	exists, err = store.Exists(context.Background(), accountName+"-missing")
	if err != nil || exists {
		t.Fatalf("check missing Keychain secret: exists = %t, err = %v", exists, err)
	}
	secret, err := store.Get(context.Background(), accountName)
	if err != nil {
		t.Fatalf("read created Keychain secret: %v", err)
	}
	if secret.Version != 1 || secret.Value != "fixture-key" {
		t.Fatalf("created secret = %#v, want version 1 and fixture key", secret)
	}

	if err := store.ReplaceAfterValidation(context.Background(), accountName, secret.Version, Secret{Value: "fixture-key-rotated"}); err != nil {
		t.Fatalf("rotate Keychain secret: %v", err)
	}
	secret, err = store.Get(context.Background(), accountName)
	if err != nil {
		t.Fatalf("read Keychain secret: %v", err)
	}
	if secret.Version != 2 || secret.Value != "fixture-key-rotated" {
		t.Fatalf("rotated secret = %#v, want version 2 and rotated fixture key", secret)
	}
}

type recordingKeychainBackend struct {
	value        []byte
	getCalls     int
	replaceCalls int
	lastValue    string
}

func (backend *recordingKeychainBackend) Exists(_ string, _ string) (bool, error) {
	return backend.value != nil, nil
}

func (backend *recordingKeychainBackend) Get(_ string, _ string) ([]byte, error) {
	backend.getCalls++
	if backend.value == nil {
		return nil, ErrSecretNotFound
	}
	return append([]byte(nil), backend.value...), nil
}

func (backend *recordingKeychainBackend) Replace(_ string, _ string, value []byte) error {
	backend.replaceCalls++
	backend.lastValue = string(value)
	backend.value = append([]byte(nil), value...)
	return nil
}

func (*recordingKeychainBackend) Delete(_ string, _ string) error {
	return nil
}

type nonPersistingKeychainBackend struct{}

func (nonPersistingKeychainBackend) Exists(string, string) (bool, error) {
	return false, nil
}

func (nonPersistingKeychainBackend) Get(string, string) ([]byte, error) {
	return nil, ErrSecretNotFound
}

func (nonPersistingKeychainBackend) Replace(string, string, []byte) error {
	return nil
}

func (nonPersistingKeychainBackend) Delete(string, string) error {
	return nil
}
