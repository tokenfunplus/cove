package provider

import (
	"context"
	"errors"
	"io"
	"mime"
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
	ErrProxyProtocol           = errors.New("invalid upstream protocol response")
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
	if request.Header.Get("Sec-Fetch-Mode") == "navigate" || !isAllowedNearAIProxyRoute(request.Method, upstreamPath) {
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
	return writeProtocolResponse(writer, response, request.Method == http.MethodPost)
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

// Only SDK protocol headers cross the local authentication boundary.
func copyNearAIProxyRequestHeaders(destination, source http.Header) {
	for _, name := range []string{"Accept", "Content-Type", "X-Client-Pub-Key", "X-Model-Pub-Key", "X-Encryption-Version", "X-Signing-Algo", "X-Encrypt-All-Fields", "X-No-Aliasing"} {
		for _, value := range source.Values(name) {
			destination.Add(name, value)
		}
	}
}

const maxProtocolResponseBytes = 16 << 20

func writeProtocolResponse(writer http.ResponseWriter, response *http.Response, allowStream bool) error {
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	streaming := mediaType == "text/event-stream" && allowStream && response.StatusCode == http.StatusOK
	encoding := response.Header.Values("Content-Encoding")
	if err != nil || len(response.Header.Values("Content-Type")) != 1 ||
		(mediaType != "application/json" && !streaming) ||
		(len(encoding) > 0 && (len(encoding) != 1 || !strings.EqualFold(encoding[0], "identity"))) ||
		response.ContentLength > maxProtocolResponseBytes {
		return ErrProxyProtocol
	}
	headers := writer.Header()
	headers.Set("Content-Type", mediaType)
	headers.Set("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'")
	headers.Set("X-Content-Type-Options", "nosniff")
	headers.Set("Cache-Control", "no-store")
	for _, name := range []string{"X-Encryption-Version", "X-Generation-Id", "Retry-After"} {
		for _, value := range response.Header.Values(name) {
			headers.Add(name, value)
		}
	}

	if !streaming {
		raw, err := io.ReadAll(io.LimitReader(response.Body, maxProtocolResponseBytes+1))
		if err != nil || len(raw) > maxProtocolResponseBytes {
			return ErrProxyProtocol
		}
		writer.WriteHeader(response.StatusCode)
		_, _ = writer.Write(raw)
		return nil
	}
	writer.WriteHeader(response.StatusCode)
	if err := copyNearAIProxyStream(writer, response.Body); err != nil {
		// An interrupted stream must fail rather than look like a completed,
		// shorter byte sequence to the receipt verifier.
		panic(http.ErrAbortHandler)
	}
	return nil
}

func copyNearAIProxyStream(writer http.ResponseWriter, body io.Reader) error {
	buffer := make([]byte, 32*1024)
	remaining := maxProtocolResponseBytes
	for {
		read, readErr := body.Read(buffer)
		if read > remaining {
			return ErrProxyProtocol
		}
		remaining -= read
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
