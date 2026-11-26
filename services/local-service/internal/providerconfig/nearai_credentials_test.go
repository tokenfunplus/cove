package providerconfig

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func TestNearAIKeyRotationReachesAttestationAndSurvivesReopening(t *testing.T) {
	for _, backend := range []string{"memory", "keychain"} {
		t.Run(backend, func(t *testing.T) {
			if backend == "keychain" && runtime.GOOS != "darwin" {
				t.Skip("macOS Keychain is only available on Darwin")
			}
			ctx := context.Background()
			dataDirectory := t.TempDir()
			t.Setenv("COVE_DATA_DIR", dataDirectory)
			databasePath := filepath.Join(dataDirectory, "cove.sqlite")
			store, err := persistence.OpenSQLite(databasePath)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = store.Close() })
			memory := credentials.NewMemoryStore()
			keychainService := fmt.Sprintf("io.github.tokenfunplus.cove.test.%d", time.Now().UnixNano())
			newSecrets := func() credentials.SecretStore {
				if backend == "keychain" {
					return credentials.NewKeychainStore(keychainService)
				}
				return memory
			}

			var attestationKey string
			client := &http.Client{Transport: credentialRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				if request.URL.Host != "cloud-api.near.ai" {
					t.Fatal("a NearAI credential left its fixed destination")
				}
				key := request.Header.Get("Authorization")
				status, body := http.StatusOK, `{}`
				if request.URL.Path == "/v1/models" {
					body = `{"data":[{"id":"fixture-model"}]}`
				} else if key != "Bearer first-fixture-key" && key != "Bearer replacement-fixture-key" {
					status = http.StatusUnauthorized
				}
				if request.URL.Path == "/v1/attestation/report" {
					attestationKey = key
					if request.URL.Query().Get("model") != "fixture-model" || request.Header.Get("X-Cove-Session-Token") != "" {
						t.Fatal("attestation lost its model or forwarded a browser credential")
					}
				}
				return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
			})}
			service := NewService(store, newSecrets(), client)
			t.Cleanup(func() { _ = service.Delete(ctx, "nearai") })
			input := ProfileInput{Kind: provider.KindNearAIPreset, Model: "fixture-model", Secret: "first-fixture-key"}
			if _, err := service.Configure(ctx, input); err != nil {
				t.Fatal(err)
			}
			input.ID = "nearai"
			assertAttestationKey := func(service *Service, expected string) {
				t.Helper()
				attestationKey = ""
				request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/nearai/nearai/v1/attestation/report?model=fixture-model&provider=near", nil)
				request.Header.Set("Authorization", "Bearer browser-value-must-not-be-used")
				request.Header.Set("X-Cove-Session-Token", "fixture-session")
				response := httptest.NewRecorder()
				if err := provider.NewNearAIProxy(service, client).Forward(response, request, "nearai", "/v1/attestation/report"); err != nil {
					t.Fatal(err)
				}
				if response.Code != http.StatusOK || attestationKey != "Bearer "+expected {
					t.Fatal("attestation did not use the current saved credential")
				}
			}
			assertAttestationKey(service, "first-fixture-key")

			input.Secret = "replacement-fixture-key"
			if _, err := service.Validate(ctx, input); err != nil {
				t.Fatal(err)
			}
			assertAttestationKey(service, "first-fixture-key")
			if _, err := service.Configure(ctx, input); err != nil {
				t.Fatal(err)
			}
			assertAttestationKey(service, "replacement-fixture-key")

			// A public catalog must not allow an invalid rotation to replace the key.
			input.Secret, input.Model = "invalid-fixture-key", ""
			if _, err := service.Configure(ctx, input); !errors.Is(err, provider.ErrAuthenticationFailed) {
				t.Fatalf("invalid replacement returned %v", err)
			}
			assertAttestationKey(service, "replacement-fixture-key")

			reopened, err := persistence.OpenSQLite(databasePath)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = reopened.Close() })
			assertAttestationKey(NewService(reopened, newSecrets(), client), "replacement-fixture-key")
		})
	}
}

type credentialRoundTripFunc func(*http.Request) (*http.Response, error)

func (function credentialRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}
