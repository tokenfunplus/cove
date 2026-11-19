package provider

import (
	"context"
	"errors"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
)

func TestNearAIValidationChecksTheKeyBeforeTrustingThePublicCatalog(t *testing.T) {
	for _, test := range []struct {
		name      string
		model     string
		keyStatus int
		wantError error
		wantPaths []string
	}{
		{
			name:      "invalid key without a selected model",
			keyStatus: http.StatusUnauthorized, wantError: ErrAuthenticationFailed,
			wantPaths: []string{"/v1/check_api_key"},
		},
		{
			name:      "valid key without a selected model",
			keyStatus: http.StatusOK,
			wantPaths: []string{"/v1/check_api_key", "/v1/models"},
		},
		{
			name:  "valid key with a selected model",
			model: "fixture-model", keyStatus: http.StatusOK,
			wantPaths: []string{"/v1/check_api_key", "/v1/models", "/v1/chat/completions"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			var paths []string
			client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
				paths = append(paths, request.URL.Path)
				if request.URL.Host != "cloud-stg-api.near.ai" || request.Header.Get("Authorization") != "Bearer fixture-key" {
					t.Fatal("validation must use the fixed NearAI destination and the supplied key")
				}
				status, body := http.StatusOK, `{}`
				switch request.URL.Path {
				case "/v1/check_api_key":
					if request.Method != http.MethodPost || request.Body != nil {
						t.Fatal("key verification must not submit a completion or conversation content")
					}
					status = test.keyStatus
				case "/v1/models":
					// NearAI serves this public directory even for an invalid key.
					body = `{"data":[{"id":"fixture-model"}]}`
				case "/v1/chat/completions":
					if test.keyStatus != http.StatusOK {
						t.Fatal("an invalid key must never reach a completion")
					}
				default:
					t.Fatalf("unexpected validation path: %s", request.URL.Path)
				}
				return &http.Response{
					StatusCode: status,
					Header:     http.Header{"Content-Type": []string{"application/json"}},
					Body:       io.NopCloser(strings.NewReader(body)),
				}, nil
			})}
			result, err := NewHTTPAdapter(client).Validate(context.Background(), ValidateInput{
				Profile: Profile{Kind: KindNearAIPreset, Model: test.model},
				Secret:  credentials.Secret{Value: "fixture-key"},
			})
			if !errors.Is(err, test.wantError) {
				t.Fatalf("validation returned %v, want %v", err, test.wantError)
			}
			if err == nil && !reflect.DeepEqual(result.Models, []string{"fixture-model"}) {
				t.Fatalf("validated catalog = %v", result.Models)
			}
			if !reflect.DeepEqual(paths, test.wantPaths) {
				t.Fatalf("validation paths = %v, want %v", paths, test.wantPaths)
			}
		})
	}
}
