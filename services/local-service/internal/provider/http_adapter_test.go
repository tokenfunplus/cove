package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
)

func TestHTTPAdapterListsModelsAndValidatesChatWithConfiguredAuthentication(t *testing.T) {
	seen := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		seen = append(seen, request.Method+" "+request.URL.Path)
		if request.Header.Get("X-API-Key") != "test-key" || request.Header.Get("Authorization") != "" {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch request.URL.Path {
		case "/v1/models":
			writeJSONForTest(t, writer, map[string]any{"data": []map[string]string{{"id": "nearai/model-a"}, {"id": "nearai/model-b"}}})
		case "/v1/chat/completions":
			var body struct {
				Model string `json:"model"`
			}
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatalf("decode chat validation body: %v", err)
			}
			if body.Model != "nearai/model-a" {
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			writeJSONForTest(t, writer, map[string]string{"id": "validation-ok"})
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	profile, err := NormalizeProfile(Profile{
		Kind:       KindOpenAICompatible,
		Name:       "Fixture Provider",
		Endpoint:   server.URL,
		Model:      "nearai/model-a",
		AuthMethod: AuthAPIKey,
	})
	if err != nil {
		t.Fatalf("normalize profile: %v", err)
	}
	adapter := NewHTTPAdapter(server.Client())

	models, err := adapter.ListModels(context.Background(), profile, credentials.Secret{Value: "test-key"})
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(models) != 2 || models[0] != "nearai/model-a" || models[1] != "nearai/model-b" {
		t.Fatalf("models = %#v, want catalog order", models)
	}
	if err := adapter.ValidateChat(context.Background(), profile, credentials.Secret{Value: "test-key"}); err != nil {
		t.Fatalf("validate chat: %v", err)
	}
	if got, want := seen, []string{"GET /v1/models", "POST /v1/chat/completions"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("requests = %#v, want %#v", got, want)
	}
}

func TestHTTPAdapterClassifiesProviderModelPrivacyFromCatalogMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/models" {
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		writeJSONForTest(t, writer, map[string]any{"data": []map[string]any{
			{"id": "openai/gpt-4.1-mini", "owned_by": "openai", "description": "Anonymized external model"},
			{"id": "moonshotai/kimi-k2.5", "owned_by": "attested 3p", "description": "Attested model served via Chutes TEE (verified end-to-end by NEAR AI).", "is_ready": false},
			{"id": "moonshotai/kimi-k3", "owned_by": "attested 3p", "description": "Attested model served via Chutes TEE (verified end-to-end by NEAR AI).", "verifiable": true},
			{"id": "nearai/private", "owned_by": "nearai", "description": "Served in a TDX confidential inference CVM"},
			{"id": "qwen/qwen3.5-397b-a17b", "privacy_mode": "chutes", "verifiable": true},
		}})
	}))
	defer server.Close()

	profile, err := NormalizeProfile(Profile{Kind: KindOpenAICompatible, Name: "Fixture", Endpoint: server.URL, AuthMethod: AuthBearer})
	if err != nil {
		t.Fatalf("normalize profile: %v", err)
	}
	metadata, err := NewHTTPAdapter(server.Client()).ListModelMetadata(context.Background(), profile, credentials.Secret{Value: "test-key"})
	if err != nil {
		t.Fatalf("list model metadata: %v", err)
	}
	if len(metadata) != 4 {
		t.Fatalf("metadata = %#v, want ready incognito, chutes, and private_tee models", metadata)
	}
	if metadata[0].ID != "openai/gpt-4.1-mini" || metadata[0].PrivacyMode != PrivacyModeIncognito || metadata[0].Verifiable {
		t.Fatalf("incognito metadata = %#v", metadata[0])
	}
	if metadata[1].ID != "moonshotai/kimi-k3" || metadata[1].PrivacyMode != PrivacyModeChutes || metadata[1].Verifiable {
		t.Fatalf("inferred chutes metadata = %#v, want chutes with verifiable=false", metadata[1])
	}
	if metadata[2].ID != "nearai/private" || metadata[2].PrivacyMode != PrivacyModeIncognito || metadata[2].Verifiable {
		t.Fatalf("tdx copy metadata = %#v, want incognito without SDK-format allowlist", metadata[2])
	}
	if metadata[3].ID != "qwen/qwen3.5-397b-a17b" || metadata[3].PrivacyMode != PrivacyModeChutes || metadata[3].Verifiable {
		t.Fatalf("explicit chutes metadata = %#v, want catalog type preserved without model verification", metadata[3])
	}
	kimi := classifyModelMetadata("moonshotai/kimi-k2.5", "attested 3p", "Attested model served via Chutes TEE (verified end-to-end by NEAR AI).", "", "", "", nil)
	if kimi.PrivacyMode != PrivacyModeChutes || kimi.Verifiable {
		t.Fatalf("Kimi metadata = %#v, want Chutes without current SDK model verification", kimi)
	}
	explicitIncognito := classifyModelMetadata("openai/gpt-4.1", "openai", "", "", "", PrivacyModeIncognito, boolPtr(true))
	if explicitIncognito.PrivacyMode != PrivacyModeIncognito || explicitIncognito.Verifiable {
		t.Fatalf("explicit incognito = %#v, want gateway-only catalog type", explicitIncognito)
	}
	advertisedTEE := classifyModelMetadata("unknown/tee", "nearai", "Served in a TDX confidential inference CVM", "", "", PrivacyModePrivateTEE, boolPtr(true))
	if advertisedTEE.PrivacyMode != PrivacyModeIncognito || advertisedTEE.Verifiable {
		t.Fatalf("advertised TEE without allowlist = %#v, want incognito", advertisedTEE)
	}
	chutesAdvertisedTEE := classifyModelMetadata("unknown/chutes-tee", "chutes", "Chutes TEE", "chutes", "chutes", PrivacyModePrivateTEE, boolPtr(true))
	if chutesAdvertisedTEE.PrivacyMode != PrivacyModeChutes || chutesAdvertisedTEE.Verifiable {
		t.Fatalf("chutes advertised as private_tee = %#v, want chutes with verifiable=false", chutesAdvertisedTEE)
	}
	for _, id := range []string{"Qwen/Qwen3.8-27B", "z-ai/glm-5.3-flash"} {
		classified := classifyModelMetadata(id, "nearai", "", "", "", "", nil)
		if classified.PrivacyMode != PrivacyModePrivateTEE || !classified.Verifiable {
			t.Fatalf("%s metadata = %#v, want verified private_tee", id, classified)
		}
	}
}

func boolPtr(value bool) *bool {
	return &value
}

func TestHTTPAdapterDoesNotFollowProviderRedirects(t *testing.T) {
	redirected := false
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/v1/models" {
			writer.Header().Set("Location", "/v1/redirected-models")
			writer.WriteHeader(http.StatusFound)
			return
		}
		redirected = true
		writeJSONForTest(t, writer, map[string]any{"data": []map[string]string{{"id": "model-a"}}})
	}))
	defer server.Close()

	profile, err := NormalizeProfile(Profile{
		Kind:       KindOpenAICompatible,
		Name:       "Redirecting Provider",
		Endpoint:   server.URL,
		AuthMethod: AuthBearer,
	})
	if err != nil {
		t.Fatalf("normalize profile: %v", err)
	}
	_, err = NewHTTPAdapter(server.Client()).ListModels(context.Background(), profile, credentials.Secret{Value: "test-key"})
	if !errors.Is(err, ErrProtocol) {
		t.Fatalf("list models error = %v, want protocol error for redirect", err)
	}
	if redirected {
		t.Fatal("provider adapter followed a redirect")
	}
}

func TestHTTPAdapterListsAModelCatalogLargerThanTheLegacy64KiBBound(t *testing.T) {
	models := make([]map[string]string, 0, 80)
	for i := 0; i < 80; i++ {
		models = append(models, map[string]string{"id": fmt.Sprintf("fixture/model-%s-%d", strings.Repeat("x", 800), i)})
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writeJSONForTest(t, writer, map[string]any{"data": models})
	}))
	defer server.Close()

	profile, err := NormalizeProfile(Profile{Kind: KindOpenAICompatible, Name: "Fixture", Endpoint: server.URL, AuthMethod: AuthBearer})
	if err != nil {
		t.Fatalf("normalize profile: %v", err)
	}
	got, err := NewHTTPAdapter(server.Client()).ListModels(context.Background(), profile, credentials.Secret{Value: "test-key"})
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(got) != len(models) {
		t.Fatalf("listed %d models, want %d", len(got), len(models))
	}
}

func TestHTTPAdapterSendsConfiguredGenerationParameters(t *testing.T) {
	temperature, topP, maxTokens := 0.4, 0.85, 1536
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/v1/chat/completions" {
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		var payload struct {
			Model       string   `json:"model"`
			Temperature *float64 `json:"temperature"`
			TopP        *float64 `json:"top_p"`
			MaxTokens   *int     `json:"max_tokens"`
			Stream      bool     `json:"stream"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode completion request: %v", err)
		}
		if payload.Model != "model-a" || payload.Temperature == nil || *payload.Temperature != temperature || payload.TopP == nil || *payload.TopP != topP || payload.MaxTokens == nil || *payload.MaxTokens != maxTokens || !payload.Stream {
			t.Fatalf("completion payload = %#v, want configured generation parameters", payload)
		}
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	profile, err := NormalizeProfile(Profile{Kind: KindOpenAICompatible, Name: "Fixture Provider", Endpoint: server.URL, Model: "model-a", AuthMethod: AuthBearer})
	if err != nil {
		t.Fatalf("normalize profile: %v", err)
	}
	stream, err := NewHTTPAdapter(server.Client()).Stream(context.Background(), CompletionInput{
		Profile: profile, Secret: credentials.Secret{Value: "test-key"},
		Messages:             []ProviderMessage{{Role: "user", Content: "Hello"}},
		GenerationParameters: GenerationParameters{Temperature: &temperature, TopP: &topP, MaxTokens: &maxTokens},
	})
	if err != nil {
		t.Fatalf("start completion stream: %v", err)
	}
	defer stream.Close()
}

func TestHTTPAdapterOmitsUnsetGenerationParameters(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload map[string]json.RawMessage
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode completion request: %v", err)
		}
		for _, field := range []string{"temperature", "top_p", "max_tokens"} {
			if _, present := payload[field]; present {
				t.Fatalf("completion payload included %q when it was unset: %#v", field, payload)
			}
		}
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	profile, err := NormalizeProfile(Profile{Kind: KindOpenAICompatible, Name: "Fixture Provider", Endpoint: server.URL, Model: "model-a", AuthMethod: AuthBearer})
	if err != nil {
		t.Fatalf("normalize profile: %v", err)
	}
	stream, err := NewHTTPAdapter(server.Client()).Stream(context.Background(), CompletionInput{
		Profile: profile, Secret: credentials.Secret{Value: "test-key"},
		Messages: []ProviderMessage{{Role: "user", Content: "Hello"}},
	})
	if err != nil {
		t.Fatalf("start completion stream: %v", err)
	}
	defer stream.Close()
}

func writeJSONForTest(t *testing.T, writer http.ResponseWriter, value any) {
	t.Helper()
	writer.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(writer).Encode(value); err != nil {
		t.Fatalf("write test JSON: %v", err)
	}
}

func TestLoopbackHTTPProviderBypassesConfiguredProxy(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"data":[{"id":"local-model"}]}`))
	}))
	defer upstream.Close()
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = func(*http.Request) (*url.URL, error) {
		return nil, errors.New("the configured proxy must not handle loopback HTTP")
	}
	adapter := NewHTTPAdapter(&http.Client{Transport: transport})
	for _, host := range []string{"localhost.", "127.0.0.1."} {
		profile := Profile{
			Kind: KindOpenAICompatible, AuthMethod: AuthBearer,
			Endpoint: strings.Replace(upstream.URL, "127.0.0.1", host, 1),
		}
		models, err := adapter.ListModels(context.Background(), profile, credentials.Secret{Value: "fixture-key"})
		if err != nil || len(models) != 1 || models[0] != "local-model" {
			t.Fatalf("list models from loopback host %s: %v", host, err)
		}
	}
}
