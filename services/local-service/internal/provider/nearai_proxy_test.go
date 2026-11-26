package provider

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
)

func TestNearAIProxyForwardsEncryptedCompletionBytesAndProtocolHeaders(t *testing.T) {
	var upstream *http.Request
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		upstream = request.Clone(request.Context())
		body, err := io.ReadAll(request.Body)
		if err != nil {
			return nil, err
		}
		upstream.Body = io.NopCloser(bytes.NewReader(body))
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/event-stream"}, "Set-Cookie": []string{"cove_session=upstream-value"}, "X-Encryption-Version": []string{"2"}},
			Body:       io.NopCloser(bytes.NewBufferString("data: encrypted-response\n\n")),
		}, nil
	})}
	proxy := NewNearAIProxy(staticNearAIResolver{}, client)
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/nearai/nearai/v1/chat/completions?trace=fixture", bytes.NewBufferString(`{"messages":[{"content":"ciphertext"}]}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Model-Pub-Key", "model-public-key")
	request.Header.Set("X-Client-Pub-Key", "browser-public-key")
	request.Header.Set("X-Encryption-Version", "2")
	request.Header.Set("X-Encrypt-All-Fields", "true")
	request.Header.Set("X-No-Aliasing", "true")
	request.Header.Set("Cookie", "cove_session=local-session")
	request.Header.Set("X-Cove-CSRF-Token", "csrf-token")
	request.Header.Set("X-Cove-Session-Token", "session-token")
	recorder := httptest.NewRecorder()

	if err := proxy.Forward(recorder, request, "nearai", "/v1/chat/completions"); err != nil {
		t.Fatalf("forward encrypted completion: %v", err)
	}

	if upstream == nil {
		t.Fatal("proxy did not make an upstream request")
	}
	if got := upstream.URL.String(); got != "https://cloud-api.near.ai/v1/chat/completions?trace=fixture" {
		t.Fatalf("upstream URL = %q", got)
	}
	if got := upstream.Header.Get("Authorization"); got != "Bearer fixture-provider-key" {
		t.Fatal("proxy did not inject the server-held Provider Key")
	}
	if got := upstream.Header.Get("X-Model-Pub-Key"); got != "model-public-key" {
		t.Fatalf("model routing header = %q", got)
	}
	if got := upstream.Header.Get("X-Client-Pub-Key"); got != "browser-public-key" {
		t.Fatalf("client encryption header = %q", got)
	}
	if got := upstream.Header.Get("X-Encryption-Version"); got != "2" {
		t.Fatalf("encryption version = %q", got)
	}
	if got := upstream.Header.Get("Cookie"); got != "" {
		t.Fatalf("proxy leaked browser cookie upstream: %q", got)
	}
	if got := upstream.Header.Get("X-Cove-CSRF-Token"); got != "" {
		t.Fatalf("proxy leaked local CSRF token upstream: %q", got)
	}
	if upstream.Header.Get("X-Encrypt-All-Fields") != "true" || upstream.Header.Get("X-No-Aliasing") != "true" {
		t.Fatal("proxy dropped a pinned SDK encryption option")
	}
	if upstream.Header.Get("X-Cove-Session-Token") != "" {
		t.Fatal("proxy forwarded a local Browser Session token")
	}
	if recorder.Header().Get("X-Content-Type-Options") != "nosniff" ||
		recorder.Header().Get("Cache-Control") != "no-store" ||
		recorder.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("proxy response is missing local content isolation headers")
	}
	if got, err := io.ReadAll(upstream.Body); err != nil || string(got) != `{"messages":[{"content":"ciphertext"}]}` {
		t.Fatal("proxy did not preserve the protected request body")
	}
	if recorder.Code != http.StatusOK || recorder.Body.String() != "data: encrypted-response\n\n" {
		t.Fatal("proxy did not preserve the protected streamed response")
	}
	if got := recorder.Header().Get("X-Encryption-Version"); got != "2" {
		t.Fatalf("response encryption header = %q", got)
	}
	if got := recorder.Header().Get("Set-Cookie"); got != "" {
		t.Fatalf("proxy allowed an upstream response to change a local browser cookie: %q", got)
	}
}

func TestNearAIProxyRejectsRoutesOutsideTheSDKProtocol(t *testing.T) {
	called := false
	proxy := NewNearAIProxy(staticNearAIResolver{}, &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		called = true
		return nil, nil
	})})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/nearai/nearai/v1/signature/completion-1", nil)

	err := proxy.Forward(recorder, request, "nearai", "/v1/signature/completion-1")
	if err != ErrNearAIProxyRoute {
		t.Fatalf("unsafe route error = %v, want %v", err, ErrNearAIProxyRoute)
	}
	if called {
		t.Fatal("proxy contacted an upstream endpoint for a rejected route")
	}
}

func TestNearAIProxyAllowsOnlyTheSDKEvidenceCompletionAndSignatureRoutes(t *testing.T) {
	allowed := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/v1/attestation/report"},
		{method: http.MethodGet, path: "/v1/model/private-model"},
		{method: http.MethodGet, path: "/v1/model/org%2Fprivate-model"},
		{method: http.MethodPost, path: "/v1/chat/completions"},
		{method: http.MethodPost, path: "/v1/responses"},
		{method: http.MethodGet, path: "/v1/signature/completion-1"},
	}
	for _, route := range allowed {
		if !isAllowedNearAIProxyRoute(route.method, route.path) {
			t.Fatalf("expected SDK route %s %s to be allowed", route.method, route.path)
		}
	}
	for _, route := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/v1/attestation/report"},
		{method: http.MethodGet, path: "/v1/chat/completions"},
		{method: http.MethodGet, path: "/v1/responses"},
		{method: http.MethodGet, path: "/v1/signature/"},
		{method: http.MethodGet, path: "/v1/signature/completion-1/extra"},
		{method: http.MethodGet, path: "/v1/models"},
		{method: http.MethodGet, path: "/v1/model/"},
		{method: http.MethodPost, path: "/v1/model/private-model"},
		{method: http.MethodGet, path: "/v1/model/name/extra"},
		{method: http.MethodGet, path: "/v1/model/.."},
		{method: http.MethodGet, path: "/v1/model/org%2F..%2Fmodels"},
	} {
		if isAllowedNearAIProxyRoute(route.method, route.path) {
			t.Fatalf("unexpectedly allowed non-SDK route %s %s", route.method, route.path)
		}
	}
}

func TestNearAIProxyRejectsAnUpstreamRedirectInsteadOfPassingItToTheBrowser(t *testing.T) {
	proxy := NewNearAIProxy(staticNearAIResolver{}, &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusFound,
			Header:     http.Header{"Location": []string{"https://untrusted.example/"}},
			Body:       io.NopCloser(bytes.NewBufferString("redirect")),
		}, nil
	})})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/nearai/nearai/v1/attestation/report", nil)

	err := proxy.Forward(recorder, request, "nearai", "/v1/attestation/report")
	if err != ErrNearAIProxyRedirect {
		t.Fatalf("redirect error = %v, want %v", err, ErrNearAIProxyRedirect)
	}
	if recorder.Code != http.StatusOK || recorder.Header().Get("Location") != "" || recorder.Body.Len() != 0 {
		t.Fatalf("redirect reached browser: status=%d location=%q body=%q", recorder.Code, recorder.Header().Get("Location"), recorder.Body.String())
	}
}

func TestNearAIProxyReturnsASanitizedErrorWhenTheUpstreamIsUnavailable(t *testing.T) {
	proxy := NewNearAIProxy(staticNearAIResolver{}, &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("upstream connection failed")
	})})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/nearai/nearai/v1/chat/completions", bytes.NewBufferString(`{"messages":[{"content":"ciphertext"}]}`))

	if err := proxy.Forward(recorder, request, "nearai", "/v1/chat/completions"); err != ErrNearAIProxyUnavailable {
		t.Fatal("proxy did not return its sanitized unavailable error")
	}
	if recorder.Body.Len() != 0 {
		t.Fatal("proxy wrote protected request or upstream error bytes to its response")
	}
}

type staticNearAIResolver struct{}

func (staticNearAIResolver) Resolve(context.Context, string) (Profile, credentials.Secret, error) {
	return Profile{ID: "nearai", Kind: KindNearAIPreset, Endpoint: NearAIEndpoint, AuthMethod: AuthBearer}, credentials.Secret{Value: "fixture-provider-key"}, nil
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestProtocolProxyRejectsUnsupportedMedia(t *testing.T) {
	recorder := httptest.NewRecorder()
	response := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/html"}},
		Body:       io.NopCloser(bytes.NewBufferString("document")),
	}
	if err := writeProtocolResponse(recorder, response, false); !errors.Is(err, ErrProxyProtocol) {
		t.Fatalf("unsupported response returned %v", err)
	}
	if recorder.Body.Len() != 0 {
		t.Fatal("the proxy exposed an unsupported response body")
	}
}
