package providerconfig

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func TestStoredNearAIPresetUsesProductionAndRetainsItsCredentialAndSelection(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	saved := persistence.ProviderProfile{ID: "nearai", Kind: provider.KindNearAIPreset, Name: "NearAI", Endpoint: legacyNearAIEndpoint, ModelID: "fixture-model", AuthMethod: provider.AuthBearer, CredentialRef: "fixture-credential"}
	if err := store.UpsertProviderProfile(ctx, saved); err != nil {
		t.Fatal(err)
	}
	settings, err := store.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	settings.ActiveModelSet = []persistence.ActiveModelTarget{{ProviderID: saved.ID, ModelID: saved.ModelID}}
	if err := store.UpdateSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	memory := credentials.NewMemoryStore()
	if err := memory.ReplaceAfterValidation(ctx, saved.CredentialRef, 0, credentials.Secret{Value: "fixture-key"}); err != nil {
		t.Fatal(err)
	}
	secrets := &secretReadTrackingStore{MemoryStore: memory}
	requests := 0
	client := &http.Client{Transport: credentialRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		if request.URL.Host != "cloud-api.near.ai" || request.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Fatal("the preset request lost its production destination or saved credential")
		}
		body := `{}`
		if request.URL.Path == "/v1/models" {
			body = `{"data":[{"id":"fixture-model"}]}`
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	service := NewService(store, secrets, client)
	profiles, err := service.List(ctx)
	if err != nil || len(profiles) != 1 || profiles[0].Endpoint != provider.NearAIEndpoint || profiles[0].Destination != "cloud-api.near.ai" || !profiles[0].Configured {
		t.Fatal("the stored staging preset did not appear as a configured production preset", err)
	}
	if secrets.getCalls != 0 || requests != 0 {
		t.Fatal("reading preset metadata retrieved a credential or contacted the network")
	}
	if _, err := service.Validate(ctx, ProfileInput{ID: saved.ID}); err != nil || requests == 0 {
		t.Fatal("the migrated preset could not validate against production", err)
	}
	profile, secret, err := service.Resolve(ctx, saved.ID)
	if err != nil || profile.Endpoint != provider.NearAIEndpoint || secret.Value != "fixture-key" {
		t.Fatal("the preset did not resolve its existing credential for production", err)
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/nearai/nearai/v1/attestation/report?model=fixture-model", nil)
	if err := provider.NewNearAIProxy(service, client).Forward(response, request, saved.ID, "/v1/attestation/report"); err != nil || response.Code != http.StatusOK {
		t.Fatal("the migrated preset could not proxy production attestation", err)
	}
	if _, err := service.Configure(ctx, ProfileInput{ID: profile.ID, Kind: profile.Kind, Name: profile.Name, Endpoint: profile.Endpoint, Model: profile.Model, AuthMethod: profile.AuthMethod}); err != nil {
		t.Fatal("saving the migrated preset required unnecessary credential replacement", err)
	}
	stored, err := store.GetProviderProfile(ctx, saved.ID)
	if err != nil || stored.Endpoint != provider.NearAIEndpoint || stored.CredentialRef != saved.CredentialRef {
		t.Fatal("saving did not retain the credential reference and production endpoint", err)
	}
	current, err := store.GetSettings(ctx)
	if err != nil || len(current.ActiveModelSet) != 1 || current.ActiveModelSet[0] != settings.ActiveModelSet[0] {
		t.Fatal("the endpoint transition changed the selected model", err)
	}
}

func TestLegacyEndpointCompatibilityIsLimitedToTheNearAIPreset(t *testing.T) {
	custom, err := fromStored(persistence.ProviderProfile{ID: "custom", Kind: provider.KindOpenAICompatible, Name: "NearAI staging", Endpoint: legacyNearAIEndpoint, AuthMethod: provider.AuthBearer})
	if err != nil || custom.Endpoint != legacyNearAIEndpoint {
		t.Fatal("a custom staging connection was rewritten", err)
	}
	if _, err := fromStored(persistence.ProviderProfile{ID: "nearai", Kind: provider.KindNearAIPreset, Name: "NearAI", Endpoint: "https://other.example", AuthMethod: provider.AuthBearer}); err == nil {
		t.Fatal("an arbitrary saved endpoint was accepted as the NearAI preset")
	}
}
