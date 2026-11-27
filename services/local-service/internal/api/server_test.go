package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"github.com/tokenfunplus/cove/services/local-service/internal/providerconfig"
)

func TestNearAIProxyAPIUsesTheBrowserSessionAndDoesNotExposeTheProviderKey(t *testing.T) {
	var authorization string
	proxy := provider.NewNearAIProxy(apiNearAIResolver{}, &http.Client{Transport: apiRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		authorization = request.Header.Get("Authorization")
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"gateway_attestation":{}}`)),
		}, nil
	})})
	server := NewServer(Config{LaunchToken: "launch-token", NearAIProxy: proxy})
	token, _ := launchBrowserSession(t, server)

	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/nearai/nearai/v1/attestation/report?nonce=fixture", nil)
	request.Host = "127.0.0.1:47123"
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != `{"gateway_attestation":{}}` {
		t.Fatalf("authorized proxy response = %d %q", response.Code, response.Body.String())
	}
	if authorization != "" {
		t.Fatal("public Gateway attestation must not send the Provider Key")
	}

	unauthorized := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/nearai/nearai/v1/chat/completions", strings.NewReader(`{"messages":[]}`))
	unauthorized.Host = "127.0.0.1:47123"
	unauthorizedResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(unauthorizedResponse, unauthorized)
	if unauthorizedResponse.Code != http.StatusUnauthorized || strings.Contains(unauthorizedResponse.Body.String(), "fixture-provider-key") {
		t.Fatalf("unauthorized proxy response = %d %q", unauthorizedResponse.Code, unauthorizedResponse.Body.String())
	}
}

func TestNearAIModelMetadataPreservesEncodedModelIDsAndRequiresABrowserSession(t *testing.T) {
	forwarded := 0
	proxy := provider.NewNearAIProxy(apiNearAIResolver{}, &http.Client{Transport: apiRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		forwarded++
		if got := request.URL.EscapedPath(); got != "/v1/model/org%2Fprivate-model" {
			t.Fatalf("metadata path = %q; encoded model IDs must stay one path component", got)
		}
		if request.URL.Host != "cloud-api.near.ai" || request.Header.Get("Authorization") != "Bearer fixture-provider-key" {
			t.Fatal("metadata must use the fixed provider and server-held key")
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"metadata":{"providerType":"vllm","attestationSupported":true}}`))}, nil
	})})
	server := NewServer(Config{LaunchToken: "launch-token", NearAIProxy: proxy})
	token, _ := launchBrowserSession(t, server)
	for _, authorized := range []bool{false, true} {
		request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/nearai/nearai/v1/model/org%2Fprivate-model", nil)
		request.Host = "127.0.0.1:47123"
		if authorized {
			request.Header.Set("X-Cove-Session-Token", token)
		}
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		want := http.StatusUnauthorized
		if authorized {
			want = http.StatusOK
		}
		if response.Code != want || strings.Contains(response.Body.String(), "fixture-provider-key") {
			t.Fatalf("metadata authorization=%v: status=%d, want=%d", authorized, response.Code, want)
		}
	}
	if forwarded != 1 {
		t.Fatalf("metadata forwarded %d times, want only the authorized request", forwarded)
	}
}

func TestNearAIProxyAPIForwardsAnEncryptedCompletionOnlyWithBrowserSessionCSRF(t *testing.T) {
	forwarded := 0
	proxy := provider.NewNearAIProxy(apiNearAIResolver{}, &http.Client{Transport: apiRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		forwarded++
		if request.Method != http.MethodPost || request.Header.Get("X-Encryption-Version") != "2" {
			return nil, errors.New("unexpected secure proxy request")
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
			Body:       io.NopCloser(strings.NewReader("data: encrypted-response\n\n")),
		}, nil
	})})
	server := NewServer(Config{LaunchToken: "launch-token", NearAIProxy: proxy})
	token, csrf := launchBrowserSession(t, server)

	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/nearai/nearai/v1/chat/completions", strings.NewReader(`{"messages":[{"content":"ciphertext"}]}`))
	request.Host = "127.0.0.1:47123"
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	request.Header.Set("X-Cove-CSRF-Token", csrf)
	request.Header.Set("X-Encryption-Version", "2")
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || forwarded != 1 {
		t.Fatal("authorized browser completion did not reach the NearAI proxy")
	}

	for _, proof := range []string{"", "wrong-csrf-token"} {
		blocked := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/nearai/nearai/v1/chat/completions", strings.NewReader(`{"messages":[{"content":"ciphertext"}]}`))
		blocked.Host = "127.0.0.1:47123"
		blocked.Header.Set("Origin", "http://127.0.0.1:47123")
		blocked.Header.Set("X-Cove-CSRF-Token", proof)
		blocked.Header.Set("X-Encryption-Version", "2")
		blocked.Header.Set("X-Cove-Session-Token", token)
		blockedResponse := httptest.NewRecorder()
		server.Handler().ServeHTTP(blockedResponse, blocked)
		if blockedResponse.Code != http.StatusForbidden {
			t.Fatal("Local Service accepted a completion without its Browser Session CSRF proof")
		}
	}
	if forwarded != 1 {
		t.Fatal("Local Service forwarded a completion without its Browser Session CSRF proof")
	}
}

func TestNearAIProxyAPIForwardsGatewayResponsesWithBrowserSessionCSRF(t *testing.T) {
	var upstream *http.Request
	forwarded := 0
	proxy := provider.NewNearAIProxy(apiNearAIResolver{}, &http.Client{Transport: apiRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		forwarded++
		cloned := request.Clone(request.Context())
		body, err := io.ReadAll(request.Body)
		if err != nil {
			return nil, err
		}
		cloned.Body = io.NopCloser(bytes.NewReader(body))
		upstream = cloned
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
			Body:       io.NopCloser(strings.NewReader("data: {\"id\":\"resp-1\",\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n")),
		}, nil
	})})
	server := NewServer(Config{LaunchToken: "launch-token", NearAIProxy: proxy})
	token, csrf := launchBrowserSession(t, server)

	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/nearai/nearai/v1/responses", strings.NewReader(`{"model":"openai/gpt-4.1-mini","input":[{"role":"user","content":"ping"}],"stream":true}`))
	request.Host = "127.0.0.1:47123"
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	request.Header.Set("X-Cove-CSRF-Token", csrf)
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || forwarded != 1 {
		t.Fatalf("authorized gateway responses request = %d forwarded=%d body=%q", response.Code, forwarded, response.Body.String())
	}
	if upstream == nil || upstream.URL.Path != "/v1/responses" {
		t.Fatalf("upstream path = %v, want /v1/responses", upstream)
	}

	missing := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/nearai/nearai/v1/responses", strings.NewReader(`{"model":"openai/gpt-4.1-mini"}`))
	missing.Host = "127.0.0.1:47123"
	missing.Header.Set("Origin", "http://127.0.0.1:47123")
	missing.Header.Set("X-Cove-Session-Token", token)
	missingResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(missingResponse, missing)
	if missingResponse.Code != http.StatusForbidden || forwarded != 1 {
		t.Fatalf("responses CSRF gate = %d forwarded=%d, want 403 without forwarding", missingResponse.Code, forwarded)
	}
}

func TestNvidiaNRASProxyUsesFixedUpstreamAndPreservesTheResponse(t *testing.T) {
	evidence := `{"nonce":"fixture-nonce","evidence":"opaque"}`
	forwarded := 0
	proxy := provider.NewNvidiaNRASProxy(&http.Client{Transport: apiRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		forwarded++
		if request.URL.String() != provider.NvidiaNRASAttestationURL {
			t.Fatalf("NVIDIA proxy target = %q, want fixed NRAS endpoint", request.URL.String())
		}
		if request.Method != http.MethodPost || request.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("NVIDIA proxy request = %s with Content-Type %q", request.Method, request.Header.Get("Content-Type"))
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read NVIDIA proxy request: %v", err)
		}
		if string(body) != evidence {
			t.Fatalf("NVIDIA evidence body changed in transit")
		}
		if request.Header.Get("Cookie") != "" || request.Header.Get("X-Cove-CSRF-Token") != "" {
			t.Fatal("NVIDIA proxy leaked Browser Session credentials upstream")
		}
		return &http.Response{
			StatusCode: http.StatusTeapot,
			Header: http.Header{
				"Content-Type": []string{"application/json"},
				"Set-Cookie":   []string{"upstream=blocked"},
			},
			Body: io.NopCloser(strings.NewReader(`[["JWT","fixture-token"]]`)),
		}, nil
	})})
	server := NewServer(Config{LaunchToken: "launch-token", NvidiaNRASProxy: proxy})
	token, csrf := launchBrowserSession(t, server)

	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/verification/nvidia", strings.NewReader(evidence))
	request.Host = "127.0.0.1:47123"
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Cove-CSRF-Token", csrf)
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusTeapot || response.Body.String() != `[["JWT","fixture-token"]]` {
		t.Fatalf("NVIDIA proxy response = %d %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Type") != "application/json" || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("NVIDIA proxy headers = %#v", response.Header())
	}
	if response.Header().Get("Set-Cookie") != "" {
		t.Fatal("NVIDIA proxy forwarded an upstream cookie")
	}
	if forwarded != 1 {
		t.Fatalf("NVIDIA upstream requests = %d, want 1", forwarded)
	}
}

func TestNvidiaNRASProxyRejectsUnauthorizedAndOversizedEvidenceBeforeForwarding(t *testing.T) {
	forwarded := 0
	proxy := provider.NewNvidiaNRASProxy(&http.Client{Transport: apiRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		forwarded++
		return nil, errors.New("request should not be forwarded")
	})})
	server := NewServer(Config{LaunchToken: "launch-token", NvidiaNRASProxy: proxy})

	unauthorized := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/verification/nvidia", strings.NewReader(`{}`))
	unauthorized.Host = "127.0.0.1:47123"
	unauthorized.Header.Set("Content-Type", "application/json")
	unauthorizedResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(unauthorizedResponse, unauthorized)
	if unauthorizedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized NVIDIA proxy status = %d, want %d", unauthorizedResponse.Code, http.StatusUnauthorized)
	}

	token, csrf := launchBrowserSession(t, server)
	oversized := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/verification/nvidia", bytes.NewReader(bytes.Repeat([]byte("x"), 3<<20)))
	oversized.Host = "127.0.0.1:47123"
	oversized.Header.Set("Origin", "http://127.0.0.1:47123")
	oversized.Header.Set("Content-Type", "application/json")
	oversized.Header.Set("X-Cove-CSRF-Token", csrf)
	oversized.Header.Set("X-Cove-Session-Token", token)
	oversizedResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(oversizedResponse, oversized)
	if oversizedResponse.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized NVIDIA proxy status = %d, want %d", oversizedResponse.Code, http.StatusRequestEntityTooLarge)
	}
	if oversizedResponse.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("oversized NVIDIA proxy response may be cached")
	}
	if forwarded != 0 {
		t.Fatalf("blocked NVIDIA upstream requests = %d, want 0", forwarded)
	}
}

type apiNearAIResolver struct{}

func (apiNearAIResolver) Resolve(context.Context, string) (provider.Profile, credentials.Secret, error) {
	return provider.Profile{ID: "nearai", Kind: provider.KindNearAIPreset, Endpoint: provider.NearAIEndpoint, AuthMethod: provider.AuthBearer}, credentials.Secret{Value: "fixture-provider-key"}, nil
}

type apiRoundTripFunc func(*http.Request) (*http.Response, error)

func (function apiRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestGenerationAPICreatesABatchAndStreamsUnifiedEvents(t *testing.T) {
	generation := persistence.Generation{
		ID: "generation-1", ConversationID: "conversation-1", ClientRequestID: "request-1",
		State:                 persistence.GenerationPending,
		Snapshot:              persistence.ProviderSnapshot{ProviderID: "provider-1", ProviderName: "Fixture", ModelID: "model-a", TransportSecurity: "tls"},
		ConfigurationSnapshot: persistence.GenerationConfigurationSnapshot{SystemPrompt: "Be concise."},
	}
	events := make(chan chat.GenerationEvent, 2)
	events <- chat.GenerationEvent{EventID: "1", GenerationID: generation.ID, Type: chat.EventStarted, Snapshot: &generation.Snapshot}
	events <- chat.GenerationEvent{EventID: "2", GenerationID: generation.ID, Type: chat.EventCompleted}
	close(events)
	chatService := &fakeChat{generation: generation, events: events}
	server := NewServer(Config{LaunchToken: "launch-token", Chat: chatService})
	token, csrf := launchBrowserSession(t, server)

	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/conversations/conversation-1/messages", bytes.NewBufferString(`{"provider_id":"provider-1","model_id":"model-a","client_request_id":"request-1","body":"Hello"}`))
	request.Host = "127.0.0.1:47123"
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	request.Header.Set("X-Cove-CSRF-Token", csrf)
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("generation create status = %d, want %d", response.Code, http.StatusCreated)
	}
	var created generationBatchEnvelope
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		t.Fatalf("decode generation batch response: %v", err)
	}
	if created.ID != "batch-1" || len(created.Targets) != 1 || created.Targets[0].Generation.ID != generation.ID || created.EventsURL != "/api/generation-batches/batch-1/events" {
		t.Fatalf("created generation batch = %#v, want one-target batch", created)
	}
	if created.Targets[0].Generation.ConfigurationSnapshot.SystemPrompt != "Be concise." || created.Targets[0].Generation.ConfigurationSnapshot.Temperature != nil || created.Targets[0].Generation.ConfigurationSnapshot.TopP != nil || created.Targets[0].Generation.ConfigurationSnapshot.MaxTokens != nil {
		t.Fatalf("created attempt configuration = %#v, want the immutable generation configuration", created.Targets[0].Generation.ConfigurationSnapshot)
	}
	if chatService.batchStartInput.SystemPrompt != "" {
		t.Fatalf("batch system prompt = %q, want chat-owned settings", chatService.batchStartInput.SystemPrompt)
	}

	sse := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/generation-batches/batch-1/events", nil)
	sse.Host = "127.0.0.1:47123"
	sse.Header.Set("X-Cove-Session-Token", token)
	sseResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(sseResponse, sse)
	if sseResponse.Code != http.StatusOK || sseResponse.Header().Get("Content-Type") != "text/event-stream" {
		t.Fatalf("SSE response = %d %q, want event stream", sseResponse.Code, sseResponse.Header().Get("Content-Type"))
	}
	if body := sseResponse.Body.String(); !strings.Contains(body, "id: 1\nevent: started\ndata: {\"event_id\":\"1\"") || !strings.Contains(body, "id: 2\nevent: completed") {
		t.Fatalf("SSE body = %q, want encoded generation events", body)
	}
}

func TestGenerationAPIReturnsConflictWhenAnotherGenerationIsActive(t *testing.T) {
	server := NewServer(Config{
		LaunchToken: "launch-token",
		Chat:        &fakeChat{startErr: chat.ErrGenerationInProgress},
	})
	token, csrf := launchBrowserSession(t, server)

	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/conversations/conversation-1/messages", bytes.NewBufferString(`{"provider_id":"provider-1","model_id":"model-a","client_request_id":"request-1","body":"Hello"}`))
	request.Host = "127.0.0.1:47123"
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	request.Header.Set("X-Cove-CSRF-Token", csrf)
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("generation conflict status = %d, want %d", response.Code, http.StatusConflict)
	}
	if code := responseErrorCode(t, response); code != "generation_in_progress" {
		t.Fatalf("generation conflict code = %q, want generation_in_progress", code)
	}
}

func TestGenerationBatchAPIRequiresAComparisonContextDisposition(t *testing.T) {
	server := NewServer(Config{LaunchToken: "launch-token", Chat: &fakeChat{startErr: persistence.ErrContextDispositionRequired}})
	token, csrf := launchBrowserSession(t, server)
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/conversations/conversation-1/messages", bytes.NewBufferString(`{"client_request_id":"request-2","body":"Follow-up"}`))
	request.Host = "127.0.0.1:47123"
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	request.Header.Set("X-Cove-CSRF-Token", csrf)
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusConflict || responseErrorCode(t, response) != "context_disposition_required" {
		t.Fatalf("comparison disposition response = %d %q, want 409 context_disposition_required", response.Code, response.Body.String())
	}
}

func TestSettingsAPIRejectsActiveModelSetChangesWhileABatchIsRunning(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	if err := store.UpdateSettings(context.Background(), persistence.Settings{Theme: "system", Locale: "system", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "model-a"}}}); err != nil {
		t.Fatalf("save settings: %v", err)
	}
	server := NewServer(Config{LaunchToken: "launch-token", Settings: store, Chat: &fakeChat{activeBatch: true}})
	token, csrf := launchBrowserSession(t, server)
	request := httptest.NewRequest(http.MethodPatch, "http://127.0.0.1:47123/api/settings", bytes.NewBufferString(`{"theme":"system","locale":"system","system_prompt":"","active_model_set":[{"provider_id":"provider-b","model_id":"model-b"}]}`))
	request.Host = "127.0.0.1:47123"
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	request.Header.Set("X-Cove-CSRF-Token", csrf)
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusConflict || responseErrorCode(t, response) != "generation_batch_in_progress" {
		t.Fatalf("active set update response = %d %q, want 409 generation_batch_in_progress", response.Code, response.Body.String())
	}
}

func TestGenerationBatchAPICreatesAComparisonAndStreamsTargetIdentifiedEvents(t *testing.T) {
	batch := persistence.GenerationBatch{
		ID: "batch-1", ConversationID: "conversation-1", ClientRequestID: "request-1", State: persistence.GenerationBatchPending,
		Targets: []persistence.GenerationTarget{
			{ID: "target-a", BatchID: "batch-1", ProviderID: "provider-a", ModelID: "model-a", Position: 0, Generation: persistence.Generation{ID: "generation-a", State: persistence.GenerationPending, Snapshot: persistence.ProviderSnapshot{ProviderID: "provider-a", ModelID: "model-a"}}},
			{ID: "target-b", BatchID: "batch-1", ProviderID: "provider-b", ModelID: "model-b", Position: 1, Generation: persistence.Generation{ID: "generation-b", State: persistence.GenerationPending, Snapshot: persistence.ProviderSnapshot{ProviderID: "provider-b", ModelID: "model-b"}}},
		},
	}
	events := make(chan chat.GenerationEvent, 1)
	events <- chat.GenerationEvent{EventID: "1", BatchID: batch.ID, TargetID: "target-b", GenerationID: "generation-b", Type: chat.EventStarted}
	close(events)
	chatService := &fakeChat{batch: batch, batchEvents: events}
	server := NewServer(Config{LaunchToken: "launch-token", Chat: chatService})
	token, csrf := launchBrowserSession(t, server)

	create := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/conversations/conversation-1/messages", bytes.NewBufferString(`{"client_request_id":"request-1","body":"Compare this"}`))
	create.Host = "127.0.0.1:47123"
	create.Header.Set("Origin", "http://127.0.0.1:47123")
	create.Header.Set("X-Cove-CSRF-Token", csrf)
	create.Header.Set("X-Cove-Session-Token", token)
	createResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("batch create status = %d, want %d", createResponse.Code, http.StatusCreated)
	}
	var created generationBatchEnvelope
	if err := json.NewDecoder(createResponse.Body).Decode(&created); err != nil {
		t.Fatalf("decode batch response: %v", err)
	}
	if created.ID != batch.ID || created.EventsURL != "/api/generation-batches/batch-1/events" || len(created.Targets) != 2 {
		t.Fatalf("created batch = %#v, want comparison batch with one events URL", created)
	}
	if chatService.batchStartInput.ProviderID != "" || chatService.batchStartInput.ModelID != "" {
		t.Fatalf("batch input = %#v, want server-owned active model set", chatService.batchStartInput)
	}

	sse := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/generation-batches/batch-1/events", nil)
	sse.Host = "127.0.0.1:47123"
	sse.Header.Set("X-Cove-Session-Token", token)
	sseResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(sseResponse, sse)
	if sseResponse.Code != http.StatusOK || !strings.Contains(sseResponse.Body.String(), `"batch_id":"batch-1"`) || !strings.Contains(sseResponse.Body.String(), `"target_id":"target-b"`) {
		t.Fatalf("batch SSE = %d %q, want target-identified batch event", sseResponse.Code, sseResponse.Body.String())
	}
}

type fakeChat struct {
	attachmentStore         persistence.ChatStore
	batchContext            []provider.ProviderMessage
	createConversation      func(context.Context, string) (persistence.Conversation, error)
	listConversations       func(context.Context, bool) ([]persistence.Conversation, error)
	readConversation        func(context.Context, string) (persistence.ConversationView, error)
	generation              persistence.Generation
	events                  <-chan chat.GenerationEvent
	batch                   persistence.GenerationBatch
	batchEvents             <-chan chat.GenerationEvent
	startErr                error
	startInput              chat.SendInput
	batchStartInput         chat.SendInput
	deleteConversation      func(context.Context, string) error
	deletedConversationID   string
	renameConversation      func(context.Context, string, string) error
	setConversationPinned   func(context.Context, string, bool) error
	setConversationArchived func(context.Context, string, bool) error
	clearChatData           func(context.Context) error
	activeBatch             bool
	clearCalls              int
}

func historyFakeChat(store persistence.ChatStore) *fakeChat {
	return &fakeChat{
		attachmentStore: store,
		createConversation: func(ctx context.Context, title string) (persistence.Conversation, error) {
			return store.CreateConversation(ctx, title)
		},
		listConversations: func(ctx context.Context, archived bool) ([]persistence.Conversation, error) {
			if archived {
				return store.ListArchivedConversations(ctx)
			}
			return store.ListConversations(ctx)
		},
		readConversation:        store.LoadConversation,
		renameConversation:      store.RenameConversation,
		setConversationPinned:   store.SetConversationPinned,
		setConversationArchived: store.SetConversationArchived,
		deleteConversation:      store.DeleteConversation,
		clearChatData:           store.ClearChatData,
	}
}

func (fake *fakeChat) CreateConversation(ctx context.Context, title string) (persistence.Conversation, error) {
	if fake.createConversation == nil {
		return persistence.Conversation{}, sql.ErrNoRows
	}
	return fake.createConversation(ctx, title)
}

func (fake *fakeChat) ListConversations(ctx context.Context, archived bool) ([]persistence.Conversation, error) {
	if fake.listConversations == nil {
		return []persistence.Conversation{}, nil
	}
	return fake.listConversations(ctx, archived)
}

func (fake *fakeChat) ReadConversation(ctx context.Context, conversationID string) (persistence.ConversationView, error) {
	if fake.readConversation == nil {
		return persistence.ConversationView{}, sql.ErrNoRows
	}
	return fake.readConversation(ctx, conversationID)
}

func (fake *fakeChat) SearchConversations(ctx context.Context, query string, archived bool) ([]persistence.ConversationSearchResult, error) {
	if fake.attachmentStore != nil {
		return fake.attachmentStore.SearchConversations(ctx, query, archived)
	}
	return []persistence.ConversationSearchResult{}, nil
}

func (fake *fakeChat) DeleteConversation(ctx context.Context, conversationID string) error {
	fake.deletedConversationID = conversationID
	if fake.deleteConversation == nil {
		return nil
	}
	return fake.deleteConversation(ctx, conversationID)
}

func (fake *fakeChat) RenameConversation(ctx context.Context, conversationID, title string) error {
	if fake.renameConversation == nil {
		return nil
	}
	return fake.renameConversation(ctx, conversationID, title)
}

func (fake *fakeChat) SetConversationPinned(ctx context.Context, conversationID string, pinned bool) error {
	if fake.setConversationPinned == nil {
		return nil
	}
	return fake.setConversationPinned(ctx, conversationID, pinned)
}

func (fake *fakeChat) SetConversationArchived(ctx context.Context, conversationID string, archived bool) error {
	if fake.setConversationArchived == nil {
		return nil
	}
	return fake.setConversationArchived(ctx, conversationID, archived)
}

func (fake *fakeChat) ClearChatData(ctx context.Context) error {
	fake.clearCalls++
	if fake.clearChatData == nil {
		return nil
	}
	return fake.clearChatData(ctx)
}

func (fake *fakeChat) StartGeneration(_ context.Context, input chat.SendInput) (chat.GenerationStart, error) {
	fake.startInput = input
	if fake.startErr != nil {
		return chat.GenerationStart{}, fake.startErr
	}
	return chat.GenerationStart{Generation: fake.generation}, nil
}

func (fake *fakeChat) SubscribeGeneration(context.Context, string, string) (<-chan chat.GenerationEvent, error) {
	return fake.events, nil
}

func (fake *fakeChat) GetGeneration(context.Context, string) (persistence.Generation, error) {
	return fake.generation, nil
}

func (fake *fakeChat) CancelGeneration(context.Context, string) (persistence.Generation, error) {
	fake.generation.State = persistence.GenerationStopped
	return fake.generation, nil
}

func (fake *fakeChat) MarkSecureGenerationVerifyingEnvironment(context.Context, string) (persistence.Generation, error) {
	fake.generation.State = persistence.GenerationVerifyingEnvironment
	return fake.generation, nil
}

func (fake *fakeChat) MarkSecureGenerationStreaming(context.Context, string) (persistence.Generation, error) {
	fake.generation.State = persistence.GenerationStreaming
	return fake.generation, nil
}

func (fake *fakeChat) MarkSecureGenerationVerifyingResponse(context.Context, string) (persistence.Generation, error) {
	fake.generation.State = persistence.GenerationVerifyingResponse
	return fake.generation, nil
}

func (fake *fakeChat) SettleSecureGeneration(context.Context, persistence.SecureGenerationSettlementInput) (persistence.Generation, error) {
	fake.generation.State = persistence.GenerationCompleted
	return fake.generation, nil
}

func (fake *fakeChat) StartGenerationBatch(ctx context.Context, input chat.SendInput) (chat.GenerationBatchStart, error) {
	fake.batchStartInput = input
	if fake.startErr != nil {
		return chat.GenerationBatchStart{}, fake.startErr
	}
	if fake.batch.ID != "" {
		return chat.GenerationBatchStart{Batch: fake.batch}, nil
	}
	started, err := fake.StartGeneration(ctx, input)
	if err != nil {
		return chat.GenerationBatchStart{}, err
	}
	return chat.GenerationBatchStart{Batch: persistence.GenerationBatch{ID: "batch-1", ConversationID: started.Generation.ConversationID, ClientRequestID: started.Generation.ClientRequestID, UserMessageID: started.Generation.UserMessageID, State: persistence.GenerationBatchPending, Targets: []persistence.GenerationTarget{{ID: "target-1", BatchID: "batch-1", Generation: started.Generation}}}}, nil
}

func (fake *fakeChat) GetGenerationBatch(context.Context, string) (persistence.GenerationBatch, error) {
	return persistence.GenerationBatch{ID: "batch-1", ConversationID: fake.generation.ConversationID, State: persistence.GenerationBatchCompleted, Targets: []persistence.GenerationTarget{{ID: "target-1", BatchID: "batch-1", Generation: fake.generation}}}, nil
}

func (fake *fakeChat) GetGenerationBatchContext(context.Context, string) ([]provider.ProviderMessage, error) {
	if fake.batchContext == nil {
		return []provider.ProviderMessage{}, nil
	}
	return fake.batchContext, nil
}

func (fake *fakeChat) SubscribeGenerationBatch(ctx context.Context, _, _ string) (<-chan chat.GenerationEvent, error) {
	if fake.batchEvents != nil {
		return fake.batchEvents, nil
	}
	return fake.SubscribeGeneration(ctx, "", "")
}

func (fake *fakeChat) CancelGenerationBatch(context.Context, string) (persistence.GenerationBatch, error) {
	fake.generation.State = persistence.GenerationStopped
	return fake.GetGenerationBatch(context.Background(), "")
}

func (fake *fakeChat) RetryGenerationTarget(context.Context, string, string, ...bool) (chat.GenerationStart, error) {
	return chat.GenerationStart{Generation: fake.generation}, nil
}

func (fake *fakeChat) SelectGenerationAnswer(context.Context, string) error { return nil }

func (fake *fakeChat) SkipGenerationBatchContext(context.Context, string) error { return nil }

func (fake *fakeChat) HasActiveGenerationBatch() bool { return fake.activeBatch }

func TestLaunchTokenCreatesOneBrowserSession(t *testing.T) {
	clock := testClock{now: time.Date(2026, time.September, 9, 9, 0, 0, 0, time.UTC)}
	server := NewServer(Config{
		LaunchToken:  "launch-token",
		ControlToken: "control-token",
		Clock:        clock.Now,
	})

	launch := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/launch?token=launch-token", nil)
	launch.Host = "127.0.0.1:47123"
	launchResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(launchResponse, launch)

	if launchResponse.Code != http.StatusSeeOther {
		t.Fatalf("launch status = %d, want %d", launchResponse.Code, http.StatusSeeOther)
	}
	token := browserSessionFromLaunch(t, launchResponse)
	session := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/session", nil)
	session.Host = "127.0.0.1:47123"
	session.AddCookie(&http.Cookie{Name: "cove_session", Value: token})
	cookieOnly := httptest.NewRecorder()
	server.Handler().ServeHTTP(cookieOnly, session)
	if cookieOnly.Code != http.StatusUnauthorized {
		t.Fatalf("ambient cookie was accepted: %d", cookieOnly.Code)
	}
	session.Header.Set("X-Cove-Session-Token", token)
	sessionResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(sessionResponse, session)

	if sessionResponse.Code != http.StatusOK {
		t.Fatalf("session status = %d, want %d", sessionResponse.Code, http.StatusOK)
	}
	var body struct {
		CSRFToken   string `json:"csrf_token"`
		HasMiniApps bool   `json:"has_mini_apps"`
	}
	if err := json.NewDecoder(sessionResponse.Body).Decode(&body); err != nil {
		t.Fatalf("decode session response: %v", err)
	}
	if body.CSRFToken == "" {
		t.Fatal("session response did not return a CSRF token")
	}

	reused := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/launch?token=launch-token", nil)
	reused.Host = "127.0.0.1:47123"
	reusedResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(reusedResponse, reused)
	if reusedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("reused launch status = %d, want %d", reusedResponse.Code, http.StatusUnauthorized)
	}
}

func TestBrowserMutationsRequireLoopbackOriginAndCSRF(t *testing.T) {
	server := NewServer(Config{
		LaunchToken:  "launch-token",
		ControlToken: "control-token",
	})
	token, csrfToken := launchBrowserSession(t, server)

	foreignHost := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/health", nil)
	foreignHost.Host = "chat.example.test"
	foreignHostResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(foreignHostResponse, foreignHost)
	if foreignHostResponse.Code != http.StatusBadRequest {
		t.Fatalf("foreign host status = %d, want %d", foreignHostResponse.Code, http.StatusBadRequest)
	}
	if code := responseErrorCode(t, foreignHostResponse); code != "invalid_host" {
		t.Fatalf("foreign host error = %q, want invalid_host", code)
	}

	wrongOrigin := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/session", nil)
	wrongOrigin.Host = "127.0.0.1:47123"
	wrongOrigin.Header.Set("Origin", "http://attacker.example.test")
	wrongOrigin.Header.Set("X-Cove-Session-Token", token)
	wrongOriginResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(wrongOriginResponse, wrongOrigin)
	if wrongOriginResponse.Code != http.StatusForbidden {
		t.Fatalf("wrong origin status = %d, want %d", wrongOriginResponse.Code, http.StatusForbidden)
	}
	if code := responseErrorCode(t, wrongOriginResponse); code != "invalid_origin" {
		t.Fatalf("wrong origin error = %q, want invalid_origin", code)
	}

	missingCSRF := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/session", nil)
	missingCSRF.Host = "127.0.0.1:47123"
	missingCSRF.Header.Set("Origin", "http://127.0.0.1:47123")
	missingCSRF.Header.Set("X-Cove-Session-Token", token)
	missingCSRFResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(missingCSRFResponse, missingCSRF)
	if missingCSRFResponse.Code != http.StatusForbidden {
		t.Fatalf("missing CSRF status = %d, want %d", missingCSRFResponse.Code, http.StatusForbidden)
	}
	if code := responseErrorCode(t, missingCSRFResponse); code != "invalid_csrf" {
		t.Fatalf("missing CSRF error = %q, want invalid_csrf", code)
	}

	withCSRF := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/session", nil)
	withCSRF.Host = "127.0.0.1:47123"
	withCSRF.Header.Set("Origin", "http://127.0.0.1:47123")
	withCSRF.Header.Set("X-Cove-CSRF-Token", csrfToken)
	withCSRF.Header.Set("X-Cove-Session-Token", token)
	withCSRFResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(withCSRFResponse, withCSRF)
	if withCSRFResponse.Code != http.StatusNotFound {
		t.Fatalf("valid CSRF status = %d, want %d", withCSRFResponse.Code, http.StatusNotFound)
	}
	if code := responseErrorCode(t, withCSRFResponse); code != "not_found" {
		t.Fatalf("valid CSRF error = %q, want not_found", code)
	}
}

func TestAuthorizedBrowserLoadsEmbeddedReactShell(t *testing.T) {
	server := NewServer(Config{
		LaunchToken:  "launch-token",
		ControlToken: "control-token",
	})
	token, _ := launchBrowserSession(t, server)

	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/", nil)
	request.Host = "127.0.0.1:47123"
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("shell status = %d, want %d", response.Code, http.StatusOK)
	}
	if body := response.Body.String(); !strings.Contains(body, "<div id=\"root\">") {
		t.Fatalf("shell does not contain the React root: %s", body)
	}
	if policy := response.Header().Get("Content-Security-Policy"); !strings.Contains(policy, "media-src 'self' blob:;") {
		t.Fatal("local speech blob playback is blocked")
	}
	if policy := response.Header().Get("Content-Security-Policy"); !strings.Contains(policy, "default-src 'self'") {
		t.Fatalf("shell CSP = %q, want self-only default source", policy)
	}
	for _, verifier := range []string{"https://pccs.phala.network", "https://nras.attestation.nvidia.com", "frame-src https://cloud-stg.near.ai;", "frame-ancestors 'none'"} {
		if !strings.Contains(response.Header().Get("Content-Security-Policy"), verifier) {
			t.Fatalf("shell CSP does not allow SDK evidence verifier %q", verifier)
		}
	}
}

func TestLauncherControlRequiresItsOwnToken(t *testing.T) {
	shutdowns := 0
	server := NewServer(Config{
		LaunchToken:  "launch-token",
		ControlToken: "control-token",
		Shutdown: func() {
			shutdowns++
		},
	})
	token, _ := launchBrowserSession(t, server)

	browserRequest := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/internal/control/shutdown", nil)
	browserRequest.Host = "127.0.0.1:47123"
	browserRequest.Header.Set("X-Cove-Session-Token", token)
	browserResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(browserResponse, browserRequest)
	if browserResponse.Code != http.StatusUnauthorized {
		t.Fatalf("browser control status = %d, want %d", browserResponse.Code, http.StatusUnauthorized)
	}
	if code := responseErrorCode(t, browserResponse); code != "invalid_control_token" {
		t.Fatalf("browser control error = %q, want invalid_control_token", code)
	}
	if shutdowns != 0 {
		t.Fatalf("browser session called shutdown %d times, want 0", shutdowns)
	}

	controlRequest := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/internal/control/shutdown", nil)
	controlRequest.Host = "127.0.0.1:47123"
	controlRequest.Header.Set("X-Cove-Control-Token", "control-token")
	controlResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(controlResponse, controlRequest)
	if controlResponse.Code != http.StatusAccepted {
		t.Fatalf("launcher control status = %d, want %d", controlResponse.Code, http.StatusAccepted)
	}
	if shutdowns != 1 {
		t.Fatalf("launcher control called shutdown %d times, want 1", shutdowns)
	}
}

func TestLauncherControlRejectsAnEmptyConfiguredToken(t *testing.T) {
	server := NewServer(Config{LaunchToken: "launch-token"})
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/internal/control/shutdown", nil)
	request.Host = "127.0.0.1:47123"
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("empty control token status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if code := responseErrorCode(t, response); code != "invalid_control_token" {
		t.Fatalf("empty control token error = %q, want invalid_control_token", code)
	}
}

func TestAuthorizedBrowserLoadsEmbeddedReactJavaScript(t *testing.T) {
	server := NewServer(Config{
		LaunchToken:  "launch-token",
		ControlToken: "control-token",
	})
	token, _ := launchBrowserSession(t, server)

	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/assets/app.js", nil)
	request.Host = "127.0.0.1:47123"
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("JavaScript status = %d, want %d", response.Code, http.StatusOK)
	}
	if contentType := response.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/javascript") {
		t.Fatalf("JavaScript content type = %q, want text/javascript", contentType)
	}
}

func TestUnknownAPIRequestsUseTheErrorEnvelope(t *testing.T) {
	server := NewServer(Config{
		LaunchToken:  "launch-token",
		ControlToken: "control-token",
	})
	token, _ := launchBrowserSession(t, server)

	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/unknown", nil)
	request.Host = "127.0.0.1:47123"
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("unknown API status = %d, want %d", response.Code, http.StatusNotFound)
	}
	if code := responseErrorCode(t, response); code != "not_found" {
		t.Fatalf("unknown API error = %q, want not_found", code)
	}
}

func TestLauncherControlMintsFreshBrowserTokens(t *testing.T) {
	server := NewServer(Config{
		ControlToken: "control-token",
	})

	first := mintBrowserToken(t, server)
	second := mintBrowserToken(t, server)
	if first == second {
		t.Fatal("launcher control returned the same browser token twice")
	}

	launch := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/launch?token="+first, nil)
	launch.Host = "127.0.0.1:47123"
	launchResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(launchResponse, launch)
	if launchResponse.Code != http.StatusSeeOther {
		t.Fatalf("fresh browser token launch status = %d, want %d", launchResponse.Code, http.StatusSeeOther)
	}
}

func TestErrorEnvelopeMatchesTheVersionedContractFixture(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "..", "packages", "api-contract", "fixtures", "error-envelope.json")
	fixture, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read error envelope fixture: %v", err)
	}
	var expected ErrorEnvelope
	if err := json.Unmarshal(fixture, &expected); err != nil {
		t.Fatalf("decode error envelope fixture: %v", err)
	}

	response := httptest.NewRecorder()
	writeError(response, http.StatusNotFound, "not_found", "The requested API route does not exist.")
	var actual ErrorEnvelope
	if err := json.NewDecoder(response.Body).Decode(&actual); err != nil {
		t.Fatalf("decode API error envelope: %v", err)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("API error envelope = %#v, want %#v", actual, expected)
	}
}

func TestConversationAPIProvidesOfflineHistoryCRUD(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	chatService := historyFakeChat(store)
	server := NewServer(Config{LaunchToken: "launch-token", Store: store, Chat: chatService})
	token, csrf := launchBrowserSession(t, server)

	create := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/conversations", bytes.NewBufferString(`{"title":"Offline chat"}`))
	create.Host = "127.0.0.1:47123"
	create.Header.Set("Origin", "http://127.0.0.1:47123")
	create.Header.Set("X-Cove-CSRF-Token", csrf)
	create.Header.Set("X-Cove-Session-Token", token)
	createResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d", createResponse.Code, http.StatusCreated)
	}
	var created persistence.Conversation
	if err := json.NewDecoder(createResponse.Body).Decode(&created); err != nil {
		t.Fatalf("decode created conversation: %v", err)
	}
	if created.ID == "" || created.Title != "Offline chat" {
		t.Fatalf("created conversation = %#v", created)
	}

	if _, err := store.AddMessage(context.Background(), created.ID, persistence.MessageInput{Role: "user", Body: "Saved locally"}); err != nil {
		t.Fatalf("seed message: %v", err)
	}

	rename := httptest.NewRequest(http.MethodPatch, "http://127.0.0.1:47123/api/conversations/"+created.ID, bytes.NewBufferString(`{"title":"Renamed offline"}`))
	rename.Host = "127.0.0.1:47123"
	rename.Header.Set("Origin", "http://127.0.0.1:47123")
	rename.Header.Set("X-Cove-CSRF-Token", csrf)
	rename.Header.Set("X-Cove-Session-Token", token)
	renameResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(renameResponse, rename)
	if renameResponse.Code != http.StatusNoContent {
		t.Fatalf("rename status = %d, want %d", renameResponse.Code, http.StatusNoContent)
	}

	list := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/conversations", nil)
	list.Host = "127.0.0.1:47123"
	list.Header.Set("X-Cove-Session-Token", token)
	listResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(listResponse, list)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d", listResponse.Code, http.StatusOK)
	}
	var listed []persistence.Conversation
	if err := json.NewDecoder(listResponse.Body).Decode(&listed); err != nil {
		t.Fatalf("decode conversation list: %v", err)
	}
	if len(listed) != 1 || listed[0].Title != "Renamed offline" {
		t.Fatalf("conversation list = %#v", listed)
	}

	conversationRequest := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/conversations/"+created.ID, nil)
	conversationRequest.Host = "127.0.0.1:47123"
	conversationRequest.Header.Set("X-Cove-Session-Token", token)
	conversationResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(conversationResponse, conversationRequest)
	if conversationResponse.Code != http.StatusOK {
		t.Fatalf("conversation status = %d, want %d", conversationResponse.Code, http.StatusOK)
	}
	var loadedConversation persistence.ConversationView
	if err := json.NewDecoder(conversationResponse.Body).Decode(&loadedConversation); err != nil {
		t.Fatalf("decode conversation view: %v", err)
	}
	if loadedConversation.Title != "Renamed offline" || len(loadedConversation.Messages) != 1 {
		t.Fatalf("conversation view = %#v", loadedConversation)
	}

	messages := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/conversations/"+created.ID+"/messages", nil)
	messages.Host = "127.0.0.1:47123"
	messages.Header.Set("X-Cove-Session-Token", token)
	messagesResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(messagesResponse, messages)
	if messagesResponse.Code != http.StatusOK {
		t.Fatalf("messages status = %d, want %d", messagesResponse.Code, http.StatusOK)
	}
	var loadedMessages []persistence.Message
	if err := json.NewDecoder(messagesResponse.Body).Decode(&loadedMessages); err != nil {
		t.Fatalf("decode conversation messages: %v", err)
	}
	if len(loadedMessages) != 1 || loadedMessages[0].Body != "Saved locally" {
		t.Fatalf("conversation messages = %#v", loadedMessages)
	}
}

func TestConversationAPIDeletesAConversation(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	chatService := &fakeChat{deleteConversation: store.DeleteConversation}
	server := NewServer(Config{LaunchToken: "launch-token", Store: store, Chat: chatService})
	token, csrf := launchBrowserSession(t, server)
	conversation, err := store.CreateConversation(context.Background(), "Delete locally")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}

	request := httptest.NewRequest(http.MethodDelete, "http://127.0.0.1:47123/api/conversations/"+conversation.ID, nil)
	request.Host = "127.0.0.1:47123"
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	request.Header.Set("X-Cove-CSRF-Token", csrf)
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want %d", response.Code, http.StatusNoContent)
	}
	if chatService.deletedConversationID != conversation.ID {
		t.Fatalf("deleted conversation ID = %q, want %q", chatService.deletedConversationID, conversation.ID)
	}
	if _, err := store.LoadConversation(context.Background(), conversation.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("load deleted conversation error = %v, want sql.ErrNoRows", err)
	}
}

func TestConversationAPIUpdatesPinnedAndArchivedConversationState(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	chatService := historyFakeChat(store)
	server := NewServer(Config{LaunchToken: "launch-token", Store: store, Chat: chatService})
	token, csrf := launchBrowserSession(t, server)
	conversation, err := store.CreateConversation(context.Background(), "Organize locally")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}

	update := func(body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPatch, "http://127.0.0.1:47123/api/conversations/"+conversation.ID, bytes.NewBufferString(body))
		request.Host = "127.0.0.1:47123"
		request.Header.Set("Origin", "http://127.0.0.1:47123")
		request.Header.Set("X-Cove-CSRF-Token", csrf)
		request.Header.Set("X-Cove-Session-Token", token)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		return response
	}
	if response := update(`{"pinned":true}`); response.Code != http.StatusNoContent {
		t.Fatalf("pin status = %d, want %d", response.Code, http.StatusNoContent)
	}

	activeRequest := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/conversations", nil)
	activeRequest.Host = "127.0.0.1:47123"
	activeRequest.Header.Set("X-Cove-Session-Token", token)
	activeResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(activeResponse, activeRequest)
	var active []persistence.Conversation
	if err := json.NewDecoder(activeResponse.Body).Decode(&active); err != nil {
		t.Fatalf("decode active conversations: %v", err)
	}
	if len(active) != 1 || !active[0].Pinned || active[0].Archived {
		t.Fatalf("active conversations = %#v, want pinned active conversation", active)
	}

	if response := update(`{"archived":true}`); response.Code != http.StatusNoContent {
		t.Fatalf("archive status = %d, want %d", response.Code, http.StatusNoContent)
	}
	archivedRequest := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/conversations?archived=true", nil)
	archivedRequest.Host = "127.0.0.1:47123"
	archivedRequest.Header.Set("X-Cove-Session-Token", token)
	archivedResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(archivedResponse, archivedRequest)
	var archived []persistence.Conversation
	if err := json.NewDecoder(archivedResponse.Body).Decode(&archived); err != nil {
		t.Fatalf("decode archived conversations: %v", err)
	}
	if len(archived) != 1 || !archived[0].Pinned || !archived[0].Archived {
		t.Fatalf("archived conversations = %#v, want pinned archived conversation", archived)
	}
	if response := update(`{"title":"Nope","pinned":false}`); response.Code != http.StatusBadRequest {
		t.Fatalf("multi-property update status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestChatDataAPIClearsConversationHistoryWithoutLeakingSensitiveErrors(t *testing.T) {
	for _, scenario := range []struct {
		name       string
		clearErr   error
		wantStatus int
		wantCode   string
	}{
		{name: "clears history", wantStatus: http.StatusNoContent},
		{name: "hides underlying failure", clearErr: errors.New("Authorization: Bearer provider-key; body: private conversation"), wantStatus: http.StatusInternalServerError, wantCode: "internal_error"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			chatService := &fakeChat{clearChatData: func(context.Context) error { return scenario.clearErr }}
			server := NewServer(Config{LaunchToken: "launch-token", Chat: chatService})
			token, csrf := launchBrowserSession(t, server)
			request := httptest.NewRequest(http.MethodDelete, "http://127.0.0.1:47123/api/data", nil)
			request.Host = "127.0.0.1:47123"
			request.Header.Set("Origin", "http://127.0.0.1:47123")
			request.Header.Set("X-Cove-CSRF-Token", csrf)
			request.Header.Set("X-Cove-Session-Token", token)
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)

			if response.Code != scenario.wantStatus {
				t.Fatalf("clear chat data status = %d, want %d", response.Code, scenario.wantStatus)
			}
			if chatService.clearCalls != 1 {
				t.Fatalf("clear chat data calls = %d, want 1", chatService.clearCalls)
			}
			body := response.Body.String()
			if scenario.wantCode != "" {
				var envelope ErrorEnvelope
				if err := json.Unmarshal([]byte(body), &envelope); err != nil {
					t.Fatalf("decode clear chat data error: %v", err)
				}
				if envelope.Error.Code != scenario.wantCode {
					t.Fatalf("clear chat data error code = %q, want %q", envelope.Error.Code, scenario.wantCode)
				}
			}
			if strings.Contains(body, "provider-key") || strings.Contains(body, "private conversation") || strings.Contains(body, "Authorization") {
				t.Fatalf("clear chat data error leaked sensitive detail: %q", body)
			}
		})
	}
}

func TestSettingsAPIReadsAndUpdatesWorkspaceSettings(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	server := NewServer(Config{LaunchToken: "launch-token", Settings: store})
	token, csrf := launchBrowserSession(t, server)

	get := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/settings", nil)
	get.Host = "127.0.0.1:47123"
	get.Header.Set("X-Cove-Session-Token", token)
	getResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(getResponse, get)
	if getResponse.Code != http.StatusOK {
		t.Fatalf("get settings status = %d, want %d", getResponse.Code, http.StatusOK)
	}
	var defaults persistence.Settings
	if err := json.NewDecoder(getResponse.Body).Decode(&defaults); err != nil {
		t.Fatalf("decode default settings: %v", err)
	}
	if defaults.Theme != "system" || defaults.Locale != "system" || defaults.SystemPrompt != "" || defaults.Temperature != nil || defaults.TopP != nil || defaults.MaxTokens != nil {
		t.Fatalf("default settings = %#v, want system defaults", defaults)
	}

	patch := httptest.NewRequest(http.MethodPatch, "http://127.0.0.1:47123/api/settings", bytes.NewBufferString(`{"theme":"dark","locale":"zh","system_prompt":"Be concise.","temperature":0.4,"top_p":0.9,"max_tokens":1024}`))
	patch.Host = "127.0.0.1:47123"
	patch.Header.Set("Origin", "http://127.0.0.1:47123")
	patch.Header.Set("X-Cove-CSRF-Token", csrf)
	patch.Header.Set("X-Cove-Session-Token", token)
	patchResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(patchResponse, patch)
	if patchResponse.Code != http.StatusOK {
		t.Fatalf("patch settings status = %d, want %d", patchResponse.Code, http.StatusOK)
	}
	var updated persistence.Settings
	if err := json.NewDecoder(patchResponse.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated settings: %v", err)
	}
	temperature, topP, maxTokens := 0.4, 0.9, 1024
	expected := persistence.Settings{Theme: "dark", Locale: "zh", SystemPrompt: "Be concise.", GenerationParameters: persistence.GenerationParameters{Temperature: &temperature, TopP: &topP, MaxTokens: &maxTokens}, ActiveModelSet: []persistence.ActiveModelTarget{}}
	if !reflect.DeepEqual(updated, expected) {
		t.Fatalf("updated settings = %#v, want updated values", updated)
	}
}

func TestGenerationAPILeavesModelSelectionToChat(t *testing.T) {
	generation := persistence.Generation{ID: "generation-1", ConversationID: "conversation-1", Snapshot: persistence.ProviderSnapshot{ProviderID: "provider-1", ModelID: "model-a"}}
	chatService := &fakeChat{generation: generation, events: closedGenerationEvents()}
	server := NewServer(Config{LaunchToken: "launch-token", Chat: chatService})
	token, csrf := launchBrowserSession(t, server)

	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/conversations/conversation-1/messages", bytes.NewBufferString(`{"provider_id":"provider-1","model_id":"model-a","client_request_id":"request-1","body":"Hello"}`))
	request.Host = "127.0.0.1:47123"
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	request.Header.Set("X-Cove-CSRF-Token", csrf)
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("generation create status = %d, want %d", response.Code, http.StatusCreated)
	}
	if chatService.batchStartInput.ProviderID != "" || chatService.batchStartInput.ModelID != "" {
		t.Fatalf("generation batch input = %#v, want no request-supplied selection", chatService.batchStartInput)
	}
}

func TestGenerationAPIRequiresACompleteActiveProviderAndModelSelection(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	chatService := &fakeChat{startErr: chat.ErrProviderSelectionRequired}
	server := NewServer(Config{LaunchToken: "launch-token", Chat: chatService, Settings: store})
	token, csrf := launchBrowserSession(t, server)

	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/conversations/conversation-1/messages", bytes.NewBufferString(`{"provider_id":"provider-1","model_id":"model-a","client_request_id":"request-1","body":"Hello"}`))
	request.Host = "127.0.0.1:47123"
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	request.Header.Set("X-Cove-CSRF-Token", csrf)
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("generation create status = %d, want %d", response.Code, http.StatusUnprocessableEntity)
	}
	if code := responseErrorCode(t, response); code != "provider_selection_required" {
		t.Fatalf("generation create error = %q, want provider_selection_required", code)
	}
}

func closedGenerationEvents() <-chan chat.GenerationEvent {
	events := make(chan chat.GenerationEvent)
	close(events)
	return events
}

func TestGenerationAPILeavesTheGlobalSystemPromptToChat(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	if err := store.UpdateSettings(context.Background(), persistence.Settings{Theme: "system", Locale: "system", SystemPrompt: "Use the saved prompt.", ActiveProviderID: "provider-1", ActiveModelID: "model-a"}); err != nil {
		t.Fatalf("save workspace settings: %v", err)
	}
	generation := persistence.Generation{ID: "generation-1", ConversationID: "conversation-1", Snapshot: persistence.ProviderSnapshot{ProviderID: "provider-1"}}
	events := make(chan chat.GenerationEvent)
	close(events)
	chatService := &fakeChat{generation: generation, events: events}
	server := NewServer(Config{LaunchToken: "launch-token", Chat: chatService, Settings: store})
	token, csrf := launchBrowserSession(t, server)

	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/conversations/conversation-1/messages", bytes.NewBufferString(`{"provider_id":"provider-1","model_id":"model-a","client_request_id":"request-1","body":"Hello","system_prompt":"Use this untrusted prompt instead."}`))
	request.Host = "127.0.0.1:47123"
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	request.Header.Set("X-Cove-CSRF-Token", csrf)
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("create generation status = %d, want %d", response.Code, http.StatusCreated)
	}
	if chatService.batchStartInput.SystemPrompt != "" {
		t.Fatalf("generation batch system prompt = %q, want Chat to read saved settings", chatService.batchStartInput.SystemPrompt)
	}
}

func TestConversationAPIReportsMissingConversationWhenAddingAMessage(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	server := NewServer(Config{LaunchToken: "launch-token", Store: store, Chat: &fakeChat{startErr: sql.ErrNoRows}})
	token, csrf := launchBrowserSession(t, server)
	if err := store.UpdateSettings(context.Background(), persistence.Settings{Theme: "system", Locale: "system", ActiveProviderID: "provider-1", ActiveModelID: "model-a"}); err != nil {
		t.Fatalf("save active selection: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/conversations/missing/messages", bytes.NewBufferString(`{"provider_id":"provider-1","model_id":"model-a","client_request_id":"request-1","body":"Saved locally"}`))
	request.Host = "127.0.0.1:47123"
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	request.Header.Set("X-Cove-CSRF-Token", csrf)
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("missing conversation status = %d, want %d", response.Code, http.StatusNotFound)
	}
	if code := responseErrorCode(t, response); code != "not_found" {
		t.Fatalf("missing conversation error = %q, want not_found", code)
	}
}

func TestConversationAPIRejectsNonUserOrBlankMessages(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	server := NewServer(Config{LaunchToken: "launch-token", Store: store, Chat: &fakeChat{}})
	token, csrf := launchBrowserSession(t, server)
	conversation, err := store.CreateConversation(context.Background(), "Offline chat")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}

	for _, body := range []string{`{"provider_id":"provider-1","body":"missing request ID"}`, `{"provider_id":"provider-1","client_request_id":"request-1","body":"   "}`} {
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/conversations/"+conversation.ID+"/messages", bytes.NewBufferString(body))
		request.Host = "127.0.0.1:47123"
		request.Header.Set("Origin", "http://127.0.0.1:47123")
		request.Header.Set("X-Cove-CSRF-Token", csrf)
		request.Header.Set("X-Cove-Session-Token", token)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid message status = %d, want %d", response.Code, http.StatusBadRequest)
		}
		if code := responseErrorCode(t, response); code != "validation" {
			t.Fatalf("invalid message error = %q, want validation", code)
		}
	}
}

func TestConversationAPIReturnsAnEmptyArrayForEmptyHistory(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	server := NewServer(Config{LaunchToken: "launch-token", Store: store})
	token, _ := launchBrowserSession(t, server)

	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/conversations", nil)
	request.Host = "127.0.0.1:47123"
	request.Header.Set("X-Cove-Session-Token", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("empty history status = %d, want %d", response.Code, http.StatusOK)
	}
	var conversations []persistence.Conversation
	if err := json.NewDecoder(response.Body).Decode(&conversations); err != nil {
		t.Fatalf("decode empty conversation list: %v", err)
	}
	if conversations == nil {
		t.Fatal("empty conversation list decoded as nil; want an empty JSON array")
	}
	if len(conversations) != 0 {
		t.Fatalf("empty conversation list = %#v, want no conversations", conversations)
	}
}

func TestConversationAPIRequiresABrowserSession(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	server := NewServer(Config{Store: store})

	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/conversations", nil)
	request.Host = "127.0.0.1:47123"
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized conversation list status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if code := responseErrorCode(t, response); code != "invalid_session" {
		t.Fatalf("unauthorized conversation list error = %q, want invalid_session", code)
	}
}

func TestProviderAPIConfiguresAndTestsAProviderWithoutReturningItsSecret(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer super-secret-key" {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		if request.URL.Path == "/v1/models" {
			_ = json.NewEncoder(writer).Encode(map[string]any{"data": []map[string]string{{"id": "model-a"}}})
			return
		}
		_ = json.NewEncoder(writer).Encode(map[string]string{"id": "validation-ok"})
	}))
	defer upstream.Close()
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	server := NewServer(Config{
		LaunchToken:   "launch-token",
		ProviderSetup: providerconfig.NewService(store, credentials.NewMemoryStore(), upstream.Client()),
	})
	token, csrf := launchBrowserSession(t, server)

	create := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/models", bytes.NewBufferString(`{"kind":"openai_compatible","name":"Fixture","endpoint":"`+upstream.URL+`","model_id":"model-a","auth_method":"bearer","secret":"super-secret-key"}`))
	create.Host = "127.0.0.1:47123"
	create.Header.Set("Origin", "http://127.0.0.1:47123")
	create.Header.Set("X-Cove-CSRF-Token", csrf)
	create.Header.Set("X-Cove-Session-Token", token)
	createResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create provider status = %d, want %d", createResponse.Code, http.StatusCreated)
	}
	body := createResponse.Body.String()
	if strings.Contains(body, "super-secret-key") || !strings.Contains(body, `"configured":true`) {
		t.Fatalf("provider response = %s, must be configured without returning secret", body)
	}

	list := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/models", nil)
	list.Host = "127.0.0.1:47123"
	list.Header.Set("X-Cove-Session-Token", token)
	listResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(listResponse, list)
	if listResponse.Code != http.StatusOK || strings.Contains(listResponse.Body.String(), "super-secret-key") {
		t.Fatalf("provider list response = %d %s, must be a secret-free success", listResponse.Code, listResponse.Body.String())
	}
}

func TestProviderAPIPersistsAConfiguredSecretThroughTheKeychain(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS Keychain is only available on Darwin")
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer fixture-key" {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		if request.URL.Path == "/v1/models" {
			_ = json.NewEncoder(writer).Encode(map[string]any{"data": []map[string]string{{"id": "fixture-model"}}})
			return
		}
		_ = json.NewEncoder(writer).Encode(map[string]string{"id": "validation-ok"})
	}))
	defer upstream.Close()

	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cove.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()

	serviceName := fmt.Sprintf("io.github.tokenfunplus.cove.test.%d", time.Now().UnixNano())
	keychain := credentials.NewKeychainStore(serviceName)
	var saved providerconfig.Profile
	setup := providerconfig.NewService(store, keychain, upstream.Client())
	defer func() {
		if saved.ID != "" {
			_ = setup.Delete(context.Background(), saved.ID)
		}
	}()
	server := NewServer(Config{LaunchToken: "launch-token", ProviderSetup: setup})
	token, csrf := launchBrowserSession(t, server)

	create := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/models", bytes.NewBufferString(`{"kind":"openai_compatible","name":"Fixture","endpoint":"`+upstream.URL+`","model_id":"fixture-model","auth_method":"bearer","secret":"fixture-key"}`))
	create.Host = "127.0.0.1:47123"
	create.Header.Set("Origin", "http://127.0.0.1:47123")
	create.Header.Set("X-Cove-CSRF-Token", csrf)
	create.Header.Set("X-Cove-Session-Token", token)
	createResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create provider status = %d, want %d", createResponse.Code, http.StatusCreated)
	}

	if err := json.NewDecoder(createResponse.Body).Decode(&saved); err != nil {
		t.Fatalf("decode saved provider: %v", err)
	}
	if !saved.Configured || saved.ID == "" {
		t.Fatalf("saved provider configured = %t, id present = %t", saved.Configured, saved.ID != "")
	}
	_, secret, err := setup.Resolve(context.Background(), saved.ID)
	if err != nil {
		t.Fatalf("read saved provider secret: %v", err)
	}
	if secret.Version != 1 || secret.Value != "fixture-key" {
		t.Fatalf("saved provider secret version = %d, value matches = %t", secret.Version, secret.Value == "fixture-key")
	}
}

func mintBrowserToken(t *testing.T, server *Server) string {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/internal/control/launch-token", nil)
	request.Host = "127.0.0.1:47123"
	request.Header.Set("X-Cove-Control-Token", "control-token")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("mint browser token status = %d, want %d", response.Code, http.StatusOK)
	}
	var body map[string]string
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode browser token response: %v", err)
	}
	if body["launch_token"] == "" {
		t.Fatal("launcher control did not return a browser token")
	}
	return body["launch_token"]
}

func browserSessionFromLaunch(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	if response.Code != http.StatusSeeOther || len(response.Result().Cookies()) != 0 {
		t.Fatal("launch must return a redirect without a cookie")
	}
	location, err := url.Parse(response.Header().Get("Location"))
	if err != nil || location.Path != "/" || location.RawQuery != "" || location.Host != "" {
		t.Fatal("invalid browser session redirect")
	}
	fragment, err := url.ParseQuery(location.Fragment)
	token := fragment.Get("cove-session")
	if err != nil || token == "" {
		t.Fatal("launch redirect is missing its session fragment")
	}
	return token
}

func launchBrowserSession(t *testing.T, server *Server) (string, string) {
	t.Helper()

	launch := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/launch?token=launch-token", nil)
	launchResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(launchResponse, launch)
	token := browserSessionFromLaunch(t, launchResponse)

	session := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/session", nil)
	session.Header.Set("X-Cove-Session-Token", token)
	sessionResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(sessionResponse, session)
	if sessionResponse.Code != http.StatusOK {
		t.Fatalf("session status = %d, want %d", sessionResponse.Code, http.StatusOK)
	}
	var body struct {
		CSRFToken   string `json:"csrf_token"`
		HasMiniApps bool   `json:"has_mini_apps"`
	}
	if err := json.NewDecoder(sessionResponse.Body).Decode(&body); err != nil {
		t.Fatalf("decode session response: %v", err)
	}
	return token, body.CSRFToken
}

func responseErrorCode(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	return body.Error.Code
}

type testClock struct {
	now time.Time
}

func (clock testClock) Now() time.Time {
	return clock.now
}

func TestFrozenBatchContextRequiresABrowserSession(t *testing.T) {
	expected := []provider.ProviderMessage{{Role: "user", Content: "Earlier prompt"}, {Role: "assistant", Content: "Selected result"}}
	server := NewServer(Config{LaunchToken: "launch-token", Chat: &fakeChat{batchContext: expected}})
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/generation-batches/batch-1/context", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated context status = %d", response.Code)
	}
	token, _ := launchBrowserSession(t, server)
	request = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/generation-batches/batch-1/context", nil)
	request.Header.Set("X-Cove-Session-Token", token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("context status = %d", response.Code)
	}
	var actual []provider.ProviderMessage
	if err := json.Unmarshal(response.Body.Bytes(), &actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatal("frozen context read model changed the selected history")
	}
}

func (fake *fakeChat) ExecuteWebTool(context.Context, string, chat.WebToolInput) (chat.WebToolResult, error) {
	return chat.WebToolResult{}, nil
}
func (fake *fakeChat) GetWebSearchRun(context.Context, string) (persistence.WebSearchRun, error) {
	return persistence.WebSearchRun{}, nil
}

func (fake *fakeChat) PrepareWebSource(context.Context, string, string) (chat.PreparedWebSource, error) {
	return chat.PreparedWebSource{}, nil
}

func (fake *fakeChat) ReleaseWebSource(context.Context, string, string) {}

func (fake *fakeChat) PreviewAttachment(ctx context.Context, input documents.Input) (documents.Snapshot, error) {
	parsed, err := documents.Parse(ctx, input)
	return parsed.Snapshot, err
}
func (fake *fakeChat) ReadAttachment(ctx context.Context, batchID, documentID string) (documents.Input, error) {
	if fake.attachmentStore == nil {
		return documents.Input{}, sql.ErrNoRows
	}
	return fake.attachmentStore.LoadAttachmentData(ctx, batchID, documentID)
}

func (fake *fakeChat) PreviewGenerationContext(context.Context, chat.SendInput) ([]provider.ProviderMessage, error) {
	return fake.batchContext, nil
}
