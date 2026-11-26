package provider

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
)

func TestKeylessAuthenticationIsRestrictedToLoopback(t *testing.T) {
	for _, endpoint := range []string{"http://localhost:11434/v1", "http://127.0.0.1:1234/v1", "http://[::1]:1234/v1", "https://127.0.0.1/v1"} {
		if profile, err := NewProfile(ProfileInput{Kind: KindOpenAICompatible, Endpoint: endpoint, AuthMethod: AuthNone}); err != nil || profile.RuntimeLocation != "User local service" {
			t.Fatal("keyless loopback rejected", err)
		}
	}
	for _, endpoint := range []string{"https://api.openai.com/v1", "https://127.0.0.1.example/v1", "http://192.168.1.1:1234/v1"} {
		if _, err := NewProfile(ProfileInput{Kind: KindOpenAICompatible, Endpoint: endpoint, AuthMethod: AuthNone}); err == nil {
			t.Fatal("remote endpoint accepted keyless authentication")
		}
	}
	if _, err := NewProfile(ProfileInput{Kind: KindOpenAICompatible, Endpoint: "http://localhost:1234/v1", AuthMethod: " none ", Secret: "must-not-be-stored"}); !errors.Is(err, ErrInvalidAuth) {
		t.Fatal("keyless profile accepted a secret", err)
	}
}

func TestCloudPresetsValidateAndStreamAtTheirExpectedRoutes(t *testing.T) {
	for _, p := range presets {
		if p.AuthMethod == AuthNone {
			continue
		}
		t.Run(p.ID, func(t *testing.T) {
			profile, err := NewProfile(ProfileInput{Kind: KindOpenAICompatible, Endpoint: p.Endpoint, AuthMethod: AuthBearer, Model: "fixture-model"})
			if err != nil {
				t.Fatal(err)
			}
			if len(p.Models) > 0 {
				profile.Model = p.Models[0]
			}
			posts := 0
			adapter := NewHTTPAdapter(&http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
				if request.Header.Get("Authorization") != "Bearer fixture-key" || !strings.HasPrefix(request.URL.String(), p.Endpoint+"/") {
					t.Fatal("preset used the wrong authentication or API base")
				}
				body := `{"data":[{"id":"fixture-model"}]}`
				contentType := "application/json"
				if request.Method == http.MethodPost {
					posts++
					if request.URL.String() != p.Endpoint+"/chat/completions" {
						t.Fatal("incorrect chat route")
					}
					var payload map[string]any
					if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
						t.Fatal(err)
					}
					field, absent := "max_tokens", "max_completion_tokens"
					if p.ID == "openai" {
						field, absent = absent, field
					}
					if payload[field] == nil || payload[absent] != nil {
						t.Fatal("incorrect completion token parameter")
					}
					body = `{}`
					if payload["stream"] == true {
						contentType, body = "text/event-stream", "data: {\"choices\":[{\"delta\":{\"content\":\"reply\"}}]}\n\ndata: [DONE]\n\n"
					}
				}
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{contentType}}, Body: io.NopCloser(strings.NewReader(body))}, nil
			})})
			secret := credentials.Secret{Value: "fixture-key"}
			if _, err := adapter.Validate(context.Background(), ValidateInput{Profile: profile, Secret: secret}); err != nil {
				t.Fatal(err)
			}
			limit := 32
			stream, err := adapter.Stream(context.Background(), CompletionInput{Profile: profile, Secret: secret, Messages: []ProviderMessage{{Role: "user", Content: "Synthetic input"}}, GenerationParameters: GenerationParameters{MaxTokens: &limit}})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			var reply strings.Builder
			for {
				event, err := stream.Recv(context.Background())
				if err == io.EOF {
					break
				}
				if err != nil {
					t.Fatal(err)
				}
				reply.WriteString(event.Delta)
			}
			if reply.String() != "reply" || posts != 2 {
				t.Fatal("preset did not validate and stream")
			}
		})
	}
}

func TestMiniMaxCatalogNeverAuthenticatesAnInvalidKeyByItself(t *testing.T) {
	profile, _ := NewProfile(ProfileInput{Kind: KindOpenAICompatible, Endpoint: "https://api.minimax.cn/v1", AuthMethod: AuthBearer})
	calls := 0
	adapter := NewHTTPAdapter(&http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		if request.Method != http.MethodPost || request.URL.Path != "/v1/chat/completions" {
			t.Fatal("MiniMax validation did not use an authenticated chat probe")
		}
		return &http.Response{StatusCode: http.StatusUnauthorized, Body: io.NopCloser(strings.NewReader("{}"))}, nil
	})})
	if _, err := adapter.Validate(context.Background(), ValidateInput{Profile: profile, Secret: credentials.Secret{Value: "rejected-fixture-key"}}); !errors.Is(err, ErrAuthenticationFailed) || calls != 1 {
		t.Fatal("publisher-listed models incorrectly established authentication", err)
	}
}

func TestOpenRouterChecksTheKeyBeforeItsPublicCatalog(t *testing.T) {
	profile, _ := NewProfile(ProfileInput{Kind: KindOpenAICompatible, Endpoint: "https://openrouter.ai/api/v1", AuthMethod: AuthBearer})
	calls := 0
	adapter := NewHTTPAdapter(&http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		if request.Method != http.MethodGet || request.URL.Path != "/api/v1/key" || request.Header.Get("Authorization") != "Bearer rejected-fixture-key" {
			t.Fatal("key validation was replaced by public catalog access")
		}
		return &http.Response{StatusCode: 401, Body: io.NopCloser(strings.NewReader("{}"))}, nil
	})})
	if _, err := adapter.Validate(context.Background(), ValidateInput{Profile: profile, Secret: credentials.Secret{Value: "rejected-fixture-key"}}); !errors.Is(err, ErrAuthenticationFailed) || calls != 1 {
		t.Fatal("OpenRouter accepted an invalid key", err)
	}
}
