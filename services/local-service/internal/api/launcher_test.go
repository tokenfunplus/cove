package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/providerconfig"
)

func TestLauncherStatusRequiresControlAuthorization(t *testing.T) {
	server := NewServer(Config{LaunchToken: "launch-token", ControlToken: "fixture-control"})
	token, _ := launchBrowserSession(t, server)
	for _, browserToken := range []string{"", token} {
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/internal/control/status", nil)
		request.Header.Set("X-Cove-Session-Token", browserToken)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want unauthorized", response.Code)
		}
	}
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/internal/control/status", nil)
	request.Header.Set("X-Cove-Control-Token", "fixture-control")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing setup service status = %d, want unavailable", response.Code)
	}
}

func TestLauncherStatusTracksSavedProviderCredentialsWithoutReadingSecrets(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	secrets := statusOnlySecrets{credentials.NewMemoryStore()}
	setup := providerconfig.NewService(store, secrets, nil)
	server := NewServer(Config{ControlToken: "fixture-control", ProviderSetup: setup})
	assertSetupRequired := func(want bool) {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/internal/control/status", nil)
		request.Header.Set("X-Cove-Control-Token", "fixture-control")
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		var status map[string]bool
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &status) != nil {
			t.Fatalf("status response = %d", response.Code)
		}
		if len(status) != 1 || status["provider_setup_required"] != want {
			t.Fatalf("status = %#v, want only provider_setup_required=%t", status, want)
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("status must not be cached")
		}
	}
	assertSetupRequired(true)
	profile := persistence.ProviderProfile{
		ID: "fixture", Kind: "openai_compatible", Name: "Fixture", Endpoint: "https://provider.example.test",
		AuthMethod: "bearer", CredentialRef: "fixture-credential",
	}
	if err := store.UpsertProviderProfile(context.Background(), profile); err != nil {
		t.Fatal(err)
	}
	assertSetupRequired(true)
	if err := secrets.ReplaceAfterValidation(context.Background(), profile.CredentialRef, 0, credentials.Secret{Value: "fixture-secret"}); err != nil {
		t.Fatal(err)
	}
	assertSetupRequired(false)
	if err := secrets.Delete(context.Background(), profile.CredentialRef); err != nil {
		t.Fatal(err)
	}
	assertSetupRequired(true)
}

type statusOnlySecrets struct{ *credentials.MemoryStore }

func (statusOnlySecrets) Get(context.Context, string) (credentials.Secret, error) {
	panic("Launcher status must check credential existence without reading the secret")
}

func TestProviderSetupIntentSurvivesOneTimeLaunchRedirect(t *testing.T) {
	server := NewServer(Config{LaunchToken: "fixture-launch"})
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/launch?token=fixture-launch&intent=provider-setup", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	location, err := response.Result().Location()
	if err != nil || response.Code != http.StatusSeeOther {
		t.Fatal("Provider setup launch did not redirect")
	}
	fragment, err := url.ParseQuery(location.Fragment)
	if err != nil || fragment.Get("intent") != "provider-setup" || fragment.Get("cove-session") == "" {
		t.Fatal("Provider setup intent or Browser Session was missing")
	}
}
