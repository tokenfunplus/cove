package providerconfig

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func TestServiceValidatesBeforeReplacingAProviderSecret(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		key := request.Header.Get("Authorization")
		if key != "Bearer old-key" && key != "Bearer new-key" {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		if request.URL.Path == "/v1/models" {
			_ = json.NewEncoder(writer).Encode(map[string]any{"data": []map[string]string{{"id": "model-a"}}})
			return
		}
		_ = json.NewEncoder(writer).Encode(map[string]string{"id": "ok"})
	}))
	defer server.Close()

	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	secrets := credentials.NewMemoryStore()
	service := NewService(store, secrets, server.Client())
	input := ProfileInput{Kind: "openai_compatible", Name: "Fixture", Endpoint: server.URL, Model: "model-a", AuthMethod: "bearer", Secret: "old-key"}
	configured, err := service.Configure(context.Background(), input)
	if err != nil {
		t.Fatalf("configure initial provider: %v", err)
	}
	input.ID = configured.ID

	input.Secret = "bad-key"
	if _, err := service.Configure(context.Background(), input); !errors.Is(err, ErrValidationFailed) {
		t.Fatalf("configure invalid replacement error = %v, want validation failure", err)
	}
	if got, err := service.Validate(context.Background(), ProfileInput{ID: configured.ID}); err != nil || len(got.Models) != 1 {
		t.Fatalf("validate with previous key = %#v, %v; want previous key to remain usable", got, err)
	}

	input.Secret = "new-key"
	if _, err := service.Configure(context.Background(), input); err != nil {
		t.Fatalf("configure valid replacement: %v", err)
	}
	_, secret, err := service.Resolve(context.Background(), input.ID)
	if err != nil {
		t.Fatalf("read replaced secret: %v", err)
	}
	if secret.Value != "new-key" {
		t.Fatal("configured connection did not resolve the replacement key")
	}
}

func TestServiceValidatesAnActiveModelAgainstTheConfiguredProviderCatalog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer fixture-key" {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		if request.URL.Path == "/v1/models" {
			_ = json.NewEncoder(writer).Encode(map[string]any{"data": []map[string]string{{"id": "model-a"}}})
			return
		}
		_ = json.NewEncoder(writer).Encode(map[string]string{"id": "validation-ok"})
	}))
	defer server.Close()

	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	service := NewService(store, credentials.NewMemoryStore(), server.Client())
	profile, err := service.Configure(context.Background(), ProfileInput{
		Kind: provider.KindOpenAICompatible, Name: "Fixture", Endpoint: server.URL,
		Model: "model-a", AuthMethod: provider.AuthBearer, Secret: "fixture-key",
	})
	if err != nil {
		t.Fatalf("configure provider: %v", err)
	}
	if err := service.ValidateSelection(context.Background(), profile.ID, "model-a"); err != nil {
		t.Fatalf("validate listed model: %v", err)
	}
	if err := service.ValidateSelection(context.Background(), profile.ID, "model-b"); !errors.Is(err, provider.ErrModelUnavailable) {
		t.Fatalf("validate unavailable model error = %v, want model unavailable", err)
	}
}

func TestServiceDoesNotMutateANearAIPresetIntoACustomProvider(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	service := NewService(store, credentials.NewMemoryStore(), nil)

	if _, err := service.Configure(context.Background(), ProfileInput{ID: "nearai", Kind: provider.KindNearAIPreset, Endpoint: provider.NearAIEndpoint, AuthMethod: provider.AuthBearer, Name: "NearAI", Model: "model-a"}); err != nil {
		t.Fatalf("configure NearAI preset: %v", err)
	}
	_, err = service.Configure(context.Background(), ProfileInput{ID: "nearai", Kind: provider.KindOpenAICompatible, Endpoint: "https://custom.example", AuthMethod: provider.AuthBearer, Name: "Custom", Model: "model-a"})
	if !errors.Is(err, provider.ErrInvalidProfile) {
		t.Fatalf("mutating NearAI preset error = %v, want invalid profile", err)
	}
}

func TestServiceListsConfiguredProvidersWithoutReadingTheirSecrets(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	profile, err := provider.NewProfile(ProfileInput{
		Kind:       provider.KindOpenAICompatible,
		Name:       "Fixture",
		Endpoint:   "https://provider.example",
		Model:      "model-a",
		AuthMethod: provider.AuthBearer,
	})
	if err != nil {
		t.Fatalf("create profile: %v", err)
	}
	profile.ID = "provider-1"
	if err := store.UpsertProviderProfile(context.Background(), toStored(profile)); err != nil {
		t.Fatalf("seed profile: %v", err)
	}
	memoryStore := credentials.NewMemoryStore()
	if err := memoryStore.ReplaceAfterValidation(context.Background(), profile.ID, 0, credentials.Secret{Value: "fixture-key"}); err != nil {
		t.Fatalf("seed secret: %v", err)
	}
	secrets := &secretReadTrackingStore{MemoryStore: memoryStore}

	profiles, err := NewService(store, secrets, nil).List(context.Background())
	if err != nil {
		t.Fatalf("list profiles: %v", err)
	}
	if len(profiles) != 1 || !profiles[0].Configured {
		t.Fatalf("profiles = %#v, want one configured provider", profiles)
	}
	if secrets.getCalls != 0 {
		t.Fatalf("listing providers read %d secrets, want existence-only checks", secrets.getCalls)
	}
}

func TestServiceKeepsTheProviderProfileWhenItsKeyCannotBeDeleted(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	secrets := &deleteFailingSecretStore{MemoryStore: credentials.NewMemoryStore()}
	service := NewService(store, secrets, nil)
	profile, err := provider.NewProfile(ProfileInput{
		Kind:       provider.KindOpenAICompatible,
		Name:       "Fixture",
		Endpoint:   "https://provider.example",
		Model:      "model-a",
		AuthMethod: provider.AuthBearer,
	})
	if err != nil {
		t.Fatalf("create profile: %v", err)
	}
	profile.ID = "provider-1"
	if err := store.UpsertProviderProfile(context.Background(), toStored(profile)); err != nil {
		t.Fatalf("seed profile: %v", err)
	}

	if err := service.Delete(context.Background(), profile.ID); !errors.Is(err, errDeleteSecret) {
		t.Fatalf("delete provider error = %v, want Keychain deletion failure", err)
	}
	if _, err := service.Get(context.Background(), profile.ID); err != nil {
		t.Fatalf("profile was removed before its Keychain secret: %v", err)
	}
}

var errDeleteSecret = errors.New("delete provider secret")

type deleteFailingSecretStore struct {
	*credentials.MemoryStore
}

func (*deleteFailingSecretStore) Delete(context.Context, string) error {
	return errDeleteSecret
}

type secretReadTrackingStore struct {
	*credentials.MemoryStore
	getCalls int
}

func (store *secretReadTrackingStore) Get(ctx context.Context, providerID string) (credentials.Secret, error) {
	store.getCalls++
	return store.MemoryStore.Get(ctx, providerID)
}

func TestSavedKeyStaysBoundToItsNormalizedDestination(t *testing.T) {
	ctx := context.Background()
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/v1/models" {
			_, _ = writer.Write([]byte(`{"data":[{"id":"model-a"}]}`))
		}
	}))
	defer upstream.Close()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store, credentials.NewMemoryStore(), upstream.Client())
	input := ProfileInput{Kind: provider.KindOpenAICompatible, Name: "Fixture", Endpoint: upstream.URL, Model: "model-a", AuthMethod: provider.AuthBearer, Secret: "fixture-key"}
	profile, err := service.Configure(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	input.ID = profile.ID
	input.Secret = ""
	input.Endpoint += "/"
	if _, err := service.Discover(ctx, input); err != nil {
		t.Fatalf("discover at the normalized saved destination: %v", err)
	}
	input.Endpoint = upstream.URL + "/second"
	if _, err := service.Validate(ctx, input); !errors.Is(err, ErrDestinationChanged) {
		t.Fatalf("changed validation destination returned %v", err)
	}
	if _, err := service.Discover(ctx, input); !errors.Is(err, ErrDestinationChanged) {
		t.Fatalf("changed catalog destination returned %v", err)
	}
	if _, err := service.Configure(ctx, input); !errors.Is(err, ErrDestinationChanged) {
		t.Fatalf("changed saved destination returned %v", err)
	}
	if err := service.DeleteKey(ctx, profile.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Resolve(ctx, profile.ID); !errors.Is(err, ErrUnconfigured) {
		t.Fatalf("deleted key resolved with error %v", err)
	}
}

func TestPreviewModelMetadataUsesOnlyLocalCatalogCache(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"id": "small", "context_length": 4096}}})
	}))
	defer server.Close()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	s := NewService(store, credentials.NewMemoryStore(), server.Client())
	profile, err := s.Configure(context.Background(), ProfileInput{Kind: "openai_compatible", Name: "Fixture", Endpoint: server.URL, AuthMethod: "bearer", Secret: "fixture-key"})
	if err != nil {
		t.Fatal(err)
	}
	baseline := calls.Load()
	_, metadata, err := s.PreviewModelMetadata(context.Background(), profile.ID, "small")
	if err != nil || calls.Load() != baseline {
		t.Fatal("uncached preview contacted Provider", err)
	}
	if _, _, _, err = s.ResolveCatalog(context.Background(), profile.ID); err != nil {
		t.Fatal(err)
	}
	_, metadata, err = s.PreviewModelMetadata(context.Background(), profile.ID, "small")
	if err != nil || calls.Load() != baseline+1 || metadata.ContextLength == nil || *metadata.ContextLength != 4096 {
		t.Fatal("cached preview contacted Provider or lost capacity", err)
	}
	server.Close()
	if _, _, err = s.PreviewModelMetadata(context.Background(), profile.ID, "small"); err != nil || calls.Load() != baseline+1 {
		t.Fatal("offline preview required Provider", err)
	}
}
