package credentials

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func TestKeychainReadsReuseOneAuthorizedSecretAcrossConcurrentRequests(t *testing.T) {
	backend := &recordingKeychainBackend{value: []byte(encodeSecret(Secret{Version: 1, Value: "fixture-key"}))}
	store := &KeychainStore{service: "test-service", backend: backend}
	var workers sync.WaitGroup
	for range 32 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			secret, err := store.Get(context.Background(), "provider")
			if err != nil || secret.Value != "fixture-key" {
				t.Error("shared key read failed")
			}
		}()
	}
	workers.Wait()
	if backend.getCalls != 1 {
		t.Fatalf("native secret reads = %d, want one authorized read", backend.getCalls)
	}
}

func TestKeychainRotationChecksTheNativeVersionInsteadOfCachedCredentials(t *testing.T) {
	backend := &recordingKeychainBackend{value: []byte(encodeSecret(Secret{Version: 1, Value: "first"}))}
	store := &KeychainStore{service: "test-service", backend: backend}
	if _, err := store.Get(context.Background(), "provider"); err != nil {
		t.Fatal(err)
	}
	backend.value = []byte(encodeSecret(Secret{Version: 2, Value: "external-rotation"}))
	if err := store.ReplaceAfterValidation(context.Background(), "provider", 1, Secret{Value: "replacement"}); !errors.Is(err, ErrSecretVersion) {
		t.Fatalf("stale cached rotation = %v", err)
	}
	if backend.replaceCalls != 0 {
		t.Fatal("stale rotation overwrote the externally updated key")
	}
	current, err := store.Get(context.Background(), "provider")
	if err != nil || current.Version != 2 || current.Value != "external-rotation" {
		t.Fatal("stale cache survived a version conflict")
	}
}

func TestKeychainRotationCachesOnlyTheVerifiedPersistedReplacement(t *testing.T) {
	backend := &recordingKeychainBackend{value: []byte(encodeSecret(Secret{Version: 1, Value: "first"}))}
	store := &KeychainStore{service: "test-service", backend: backend}
	if _, err := store.Get(context.Background(), "provider"); err != nil {
		t.Fatal(err)
	}
	if err := store.ReplaceAfterValidation(context.Background(), "provider", 1, Secret{Value: "replacement"}); err != nil {
		t.Fatal(err)
	}
	reads := backend.getCalls
	current, err := store.Get(context.Background(), "provider")
	if err != nil || current.Version != 2 || current.Value != "replacement" {
		t.Fatal("rotation did not update the cached key")
	}
	if backend.getCalls != reads || reads != 3 {
		t.Fatal("replacement was not independently read back and then reused")
	}
}

func TestKeychainDeletionAndMissingMetadataInvalidateAuthorizedSecrets(t *testing.T) {
	for _, removeThroughStore := range []bool{false, true} {
		backend := &recordingKeychainBackend{value: []byte(encodeSecret(Secret{Version: 1, Value: "first"}))}
		store := &KeychainStore{service: "test-service", backend: backend}
		if _, err := store.Get(context.Background(), "provider"); err != nil {
			t.Fatal(err)
		}
		if removeThroughStore {
			if err := store.Delete(context.Background(), "provider"); err != nil {
				t.Fatal(err)
			}
		} else {
			backend.value = nil
			if exists, err := store.Exists(context.Background(), "provider"); err != nil || exists {
				t.Fatal("missing item was still configured")
			}
		}
		if _, err := store.Get(context.Background(), "provider"); !errors.Is(err, ErrSecretNotFound) {
			t.Fatal("deleted credential was served from memory")
		}
	}
}

type gatedKeychainBackend struct {
	recordingKeychainBackend
	started chan struct{}
	release chan struct{}
}

func (backend *gatedKeychainBackend) Get(service, account string) ([]byte, error) {
	select {
	case <-backend.started:
	default:
		close(backend.started)
	}
	<-backend.release
	return backend.recordingKeychainBackend.Get(service, account)
}

func TestWaitingForSharedKeychainAuthorizationCanBeCancelled(t *testing.T) {
	backend := &gatedKeychainBackend{recordingKeychainBackend: recordingKeychainBackend{value: []byte(encodeSecret(Secret{Version: 1, Value: "first"}))}, started: make(chan struct{}), release: make(chan struct{})}
	store := &KeychainStore{service: "test-service", backend: backend}
	finished := make(chan error, 1)
	go func() { _, err := store.Get(context.Background(), "provider"); finished <- err }()
	<-backend.started
	ctx, cancel := context.WithCancel(context.Background())
	waiting := make(chan error, 1)
	go func() { _, err := store.Get(ctx, "provider"); waiting <- err }()
	cancel()
	if err := <-waiting; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled waiter = %v", err)
	}
	close(backend.release)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if backend.getCalls != 1 {
		t.Fatal("cancelled waiter opened another Keychain read")
	}
}

func TestMissingSecretIsNotCachedAndCanBeRepaired(t *testing.T) {
	backend := &recordingKeychainBackend{}
	store := &KeychainStore{service: "test-service", backend: backend}
	if _, err := store.Get(context.Background(), "provider"); !errors.Is(err, ErrSecretNotFound) {
		t.Fatal("missing secret did not fail")
	}
	backend.value = []byte(encodeSecret(Secret{Version: 1, Value: "repaired"}))
	current, err := store.Get(context.Background(), "provider")
	if err != nil || current.Value != "repaired" || backend.getCalls != 2 {
		t.Fatal("failed authorization prevented a later explicit recovery")
	}
}
