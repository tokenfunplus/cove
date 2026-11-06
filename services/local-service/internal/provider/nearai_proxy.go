package provider

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
)

var (
	ErrNearAIProxyRoute        = errors.New("NearAI proxy route is not allowed")
	ErrNearAIProxyProvider     = errors.New("NearAI proxy provider is not eligible")
	ErrNearAIProxyUnconfigured = errors.New("NearAI proxy provider is unconfigured")
	ErrNearAIProxyRedirect     = errors.New("NearAI proxy upstream redirected the request")
	ErrNearAIProxyUnavailable  = errors.New("NearAI proxy upstream is unavailable")
)

// NearAIProfileResolver is deliberately limited to server-side profile and
// Keychain lookup. The transparent proxy never returns the Secret to a caller.
type NearAIProfileResolver interface {
	Resolve(ctx context.Context, id string) (Profile, credentials.Secret, error)
}

// NearAIProxy forwards only the byte-sensitive endpoints used by the browser
// inference SDK. It does not parse protected request or response bodies.
type NearAIProxy struct {
	resolver NearAIProfileResolver
	client   *http.Client
}

func NewNearAIProxy(resolver NearAIProfileResolver, client *http.Client) *NearAIProxy {
	if client == nil {
		client = http.DefaultClient
	}
	clientCopy := *client
	clientCopy.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &NearAIProxy{resolver: resolver, client: &clientCopy}
}

// Forward injects the server-held Provider Key and forwards the SDK's request
// and response bytes unchanged. upstreamPath is supplied by a fixed local API
// route, never by an arbitrary destination URL.
func (proxy *NearAIProxy) Forward(writer http.ResponseWriter, request *http.Request, providerID, upstreamPath string) error {
	if proxy == nil || proxy.resolver == nil || proxy.client == nil {
		return ErrNearAIProxyUnavailable
	}
	if !isAllowedNearAIProxyRoute(request.Method, upstreamPath) {
		return ErrNearAIProxyRoute
	}
	profile, secret, err := proxy.resolver.Resolve(request.Context(), providerID)
	if err != nil || strings.TrimSpace(secret.Value) == "" {
		return ErrNearAIProxyUnconfigured
	}
	profile, err = NormalizeProfile(profile)
	if err != nil || profile.Kind != KindNearAIPreset || profile.Endpoint != NearAIEndpoint || profile.AuthMethod != AuthBearer {
		return ErrNearAIProxyProvider
	}
	target, err := nearAIProxyTarget(profile.Endpoint, upstreamPath, request.URL.RawQuery)
	if err != nil {
		return ErrNearAIProxyProvider
	}
	upstream, err := http.NewRequestWithContext(request.Context(), request.Method, target.String(), request.Body)
	if err != nil {
		return ErrNearAIProxyUnavailable
	}
	upstream.ContentLength = request.ContentLength
	copyNearAIProxyRequestHeaders(upstream.Header, request.Header)
	// SDK 0.2.1 verifies public Gateway evidence before authenticated model
	// metadata or inference. Keep the initial Gateway report free of secrets.
	if upstreamPath != "/v1/attestation/report" || request.URL.Query().Get("model") != "" {
		upstream.Header.Set("Authorization", "Bearer "+secret.Value)
	}

	response, err := proxy.client.Do(upstream)
	if err != nil {
		return ErrNearAIProxyUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusMultipleChoices && response.StatusCode < http.StatusBadRequest {
		return ErrNearAIProxyRedirect
	}
	copyNearAIProxyResponseHeaders(writer.Header(), response.Header)
	writer.WriteHeader(response.StatusCode)
	if err := copyNearAIProxyStream(writer, response.Body); err != nil {
		// The HTTP response is already committed. Ending a damaged SSE response
		// lets the browser SDK report a stream failure without appending a JSON
		// error envelope to cryptographic protocol bytes.
		return nil
	}
	return nil
}

func isAllowedNearAIProxyRoute(method, path string) bool {
	switch {
	case method == http.MethodGet && path == "/v1/attestation/report":
		return true
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/model/"):
		escapedID := strings.TrimPrefix(path, "/v1/model/")
		modelID, err := url.PathUnescape(escapedID)
		if err != nil || modelID == "" || strings.Contains(escapedID, "/") {
			return false
		}
		for _, part := range strings.Split(modelID, "/") {
			if part == "." || part == ".." {
				return false
			}
		}
		return true
	case method == http.MethodPost && path == "/v1/chat/completions":
		return true
	case method == http.MethodPost && path == "/v1/responses":
		return true
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/signature/"):
		return strings.TrimPrefix(path, "/v1/signature/") != "" && !strings.Contains(strings.TrimPrefix(path, "/v1/signature/"), "/")
	default:
		return false
	}
}

func nearAIProxyTarget(endpoint, upstreamPath, rawQuery string) (*url.URL, error) {
	target, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}
	decodedPath, err := url.PathUnescape(upstreamPath)
	if err != nil {
		return nil, err
	}
	target.RawPath = strings.TrimRight(target.EscapedPath(), "/") + upstreamPath
	target.Path = strings.TrimRight(target.Path, "/") + decodedPath
	target.RawQuery = rawQuery
	target.Fragment = ""
	return target, nil
}

var hopByHopHeaders = map[string]struct{}{
	"connection":          {},
	"keep-alive":          {},
	"proxy-authenticate":  {},
	"proxy-authorization": {},
	"te":                  {},
	"trailer":             {},
	"transfer-encoding":   {},
	"upgrade":             {},
}

func copyNearAIProxyRequestHeaders(destination, source http.Header) {
	for name, values := range source {
		lower := strings.ToLower(name)
		if _, blocked := hopByHopHeaders[lower]; blocked || lower == "authorization" || lower == "cookie" || lower == "origin" || lower == "referer" || lower == "x-cove-csrf-token" {
			continue
		}
		for _, value := range values {
			destination.Add(name, value)
		}
	}
}

func copyNearAIProxyResponseHeaders(destination, source http.Header) {
	for name, values := range source {
		lower := strings.ToLower(name)
		if _, blocked := hopByHopHeaders[lower]; blocked || lower == "set-cookie" {
			continue
		}
		for _, value := range values {
			destination.Add(name, value)
		}
	}
}

func copyNearAIProxyStream(writer http.ResponseWriter, body io.Reader) error {
	buffer := make([]byte, 32*1024)
	for {
		read, readErr := body.Read(buffer)
		if read > 0 {
			if _, err := writer.Write(buffer[:read]); err != nil {
				return err
			}
			if flusher, ok := writer.(http.Flusher); ok {
				flusher.Flush()
			}
		}
		if errors.Is(readErr, io.EOF) {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}
