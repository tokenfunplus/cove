package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
)

var (
	ErrAuthenticationFailed = errors.New("provider authentication failed")
	ErrProviderUnavailable  = errors.New("provider unavailable")
	ErrRateLimited          = errors.New("provider rate limited")
	ErrProtocol             = errors.New("provider protocol is invalid")
	ErrModelUnavailable     = errors.New("provider model is unavailable")
)

type ValidateInput struct {
	Profile Profile
	Secret  credentials.Secret
}

type ValidationResult struct {
	Models        []string        `json:"models"`
	ModelMetadata []ModelMetadata `json:"model_metadata,omitempty"`
}

// ModelMetadata combines normalized catalog details with Cove's transport
// classification. Advertised capabilities and brand identity are presentation
// data and do not authorize a different inference or verification path.
type ModelMetadata struct {
	Name                  string   `json:"name,omitempty"`
	Owner                 string   `json:"owner,omitempty"`
	Description           string   `json:"description,omitempty"`
	ContextLength         *int64   `json:"context_length,omitempty"`
	MaxOutputTokens       *int64   `json:"max_output_tokens,omitempty"`
	InputPricePerMillion  *float64 `json:"input_price_per_million,omitempty"`
	OutputPricePerMillion *float64 `json:"output_price_per_million,omitempty"`
	Capabilities          []string `json:"capabilities,omitempty"`
	ID                    string   `json:"id"`
	PrivacyMode           string   `json:"privacy_mode"`
	Verifiable            bool     `json:"verifiable"`
}

const (
	PrivacyModePrivateTEE = "private_tee"
	PrivacyModeIncognito  = "incognito"
	PrivacyModeChutes     = "chutes"
)

// These models have been verified against the current NearAI attestation
// endpoint. Keep this allowlist exact until the provider exposes the same
// classification in /v1/models; descriptions alone are not authoritative.
var verifiedModelIDs = map[string]struct{}{
	"Qwen/Qwen3.8-27B":   {},
	"z-ai/glm-5.3-flash": {},
}

const providerPreflightTimeout = 10 * time.Second

type HTTPAdapter struct {
	client      *http.Client
	localClient *http.Client
}

func NewHTTPAdapter(client *http.Client) *HTTPAdapter {
	if client == nil {
		client = http.DefaultClient
	}
	clientCopy := *client
	clientCopy.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	adapter := &HTTPAdapter{client: &clientCopy, localClient: &clientCopy}
	transport := clientCopy.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	if base, ok := transport.(*http.Transport); ok {
		direct := base.Clone()
		direct.Proxy = nil
		dialer := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
		direct.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			host = strings.TrimSuffix(host, ".")
			if strings.EqualFold(host, "localhost") {
				conn, err := dialer.DialContext(ctx, network, net.JoinHostPort("127.0.0.1", port))
				if err == nil {
					return conn, nil
				}
				return dialer.DialContext(ctx, network, net.JoinHostPort("::1", port))
			}
			ip := net.ParseIP(host)
			if ip == nil || !ip.IsLoopback() {
				return nil, ErrInsecureEndpoint
			}
			address = net.JoinHostPort(ip.String(), port)
			return dialer.DialContext(ctx, network, address)
		}
		localClient := clientCopy
		localClient.Transport = direct
		adapter.localClient = &localClient
	}
	return adapter
}

func (adapter *HTTPAdapter) do(request *http.Request) (*http.Response, error) {
	if request.URL.Scheme == "http" && isLoopbackHost(request.URL.Hostname()) {
		return adapter.localClient.Do(request)
	}
	return adapter.client.Do(request)
}

func (adapter *HTTPAdapter) Validate(ctx context.Context, input ValidateInput) (ValidationResult, error) {
	profile, err := NormalizeProfile(input.Profile)
	if err != nil {
		return ValidationResult{}, err
	}
	if profile.Kind == KindNearAIPreset {
		if err := adapter.validateNearAIKey(ctx, profile, input.Secret); err != nil {
			return ValidationResult{}, err
		}
	}
	metadata, err := adapter.ListModelMetadata(ctx, profile, input.Secret)
	if err != nil {
		return ValidationResult{}, err
	}
	models := modelIDs(metadata)
	if profile.Model == "" {
		return ValidationResult{Models: models, ModelMetadata: metadata}, nil
	}
	if !containsModel(models, profile.Model) {
		return ValidationResult{}, ErrModelUnavailable
	}
	if err := adapter.ValidateChat(ctx, profile, input.Secret); err != nil {
		return ValidationResult{}, err
	}
	return ValidationResult{Models: models, ModelMetadata: metadata}, nil
}

func (adapter *HTTPAdapter) validateNearAIKey(ctx context.Context, profile Profile, secret credentials.Secret) error {
	ctx, cancel := context.WithTimeout(ctx, providerPreflightTimeout)
	defer cancel()
	// The NearAI catalog is public, including for rejected keys. Use its
	// authenticated, non-inference check before reporting a verified connection.
	request, err := adapter.newRequest(ctx, http.MethodPost, profile, "/check_api_key", secret)
	if err != nil {
		return err
	}
	response, err := adapter.do(request)
	if err != nil {
		return fmt.Errorf("validate NearAI key: %w", ErrProviderUnavailable)
	}
	defer response.Body.Close()
	return classifyStatus(response.StatusCode)
}

func (adapter *HTTPAdapter) Stream(ctx context.Context, input CompletionInput) (CompletionStream, error) {
	return adapter.stream(ctx, input, true)
}

func (adapter *HTTPAdapter) stream(ctx context.Context, input CompletionInput, includeUsage bool) (CompletionStream, error) {
	profile, err := NormalizeProfile(input.Profile)
	if err != nil {
		return nil, err
	}
	payload := struct {
		Model         string            `json:"model"`
		Messages      []ProviderMessage `json:"messages"`
		Temperature   *float64          `json:"temperature,omitempty"`
		TopP          *float64          `json:"top_p,omitempty"`
		MaxTokens     *int              `json:"max_tokens,omitempty"`
		Stream        bool              `json:"stream"`
		StreamOptions *struct {
			IncludeUsage bool `json:"include_usage"`
		} `json:"stream_options,omitempty"`
	}{Model: profile.Model, Messages: input.Messages, Temperature: input.GenerationParameters.Temperature, TopP: input.GenerationParameters.TopP, MaxTokens: input.GenerationParameters.MaxTokens, Stream: true}
	if includeUsage {
		payload.StreamOptions = &struct {
			IncludeUsage bool `json:"include_usage"`
		}{true}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode provider completion: %w", ErrProtocol)
	}
	request, err := adapter.newRequest(ctx, http.MethodPost, profile, "/chat/completions", input.Secret)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Body = io.NopCloser(strings.NewReader(string(body)))
	request.ContentLength = int64(len(body))
	response, err := adapter.do(request)
	if err != nil {
		return nil, fmt.Errorf("open provider completion: %w", ErrProviderUnavailable)
	}
	if err := classifyStatus(response.StatusCode); err != nil {
		// Some compatible endpoints explicitly reject this optional field. Retry
		// only that pre-stream rejection, never an accepted or interrupted request.
		if includeUsage && (response.StatusCode == http.StatusBadRequest || response.StatusCode == http.StatusUnprocessableEntity) {
			data, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
			_ = response.Body.Close()
			if rejectsUsageOption(data) {
				return adapter.stream(ctx, input, false)
			}
		}
		_ = response.Body.Close()
		return nil, err
	}
	return newSSECompletionStream(response.Body), nil
}

func rejectsUsageOption(data []byte) bool {
	var rejection struct {
		Error struct {
			Message string `json:"message"`
			Param   string `json:"param"`
			Code    string `json:"code"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if json.Unmarshal(data, &rejection) != nil {
		return false
	}
	message := strings.ToLower(rejection.Error.Message + " " + rejection.Message)
	field := message + " " + strings.ToLower(rejection.Error.Param)
	if !strings.Contains(field, "stream_options") && !strings.Contains(field, "include_usage") {
		return false
	}
	reason := message + " " + strings.ToLower(rejection.Error.Code)
	for _, term := range []string{"unknown", "unsupported", "not supported", "unrecognized", "not permitted", "not allowed", "extra input", "extra_forbidden"} {
		if strings.Contains(reason, term) {
			return true
		}
	}
	return false
}

func (adapter *HTTPAdapter) ListModels(ctx context.Context, profile Profile, secret credentials.Secret) ([]string, error) {
	metadata, err := adapter.ListModelMetadata(ctx, profile, secret)
	if err != nil {
		return nil, err
	}
	return modelIDs(metadata), nil
}

func (adapter *HTTPAdapter) ListModelMetadata(ctx context.Context, profile Profile, secret credentials.Secret) ([]ModelMetadata, error) {
	ctx, cancel := context.WithTimeout(ctx, providerPreflightTimeout)
	defer cancel()
	request, err := adapter.newRequest(ctx, http.MethodGet, profile, "/models", secret)
	if err != nil {
		return nil, err
	}
	response, err := adapter.do(request)
	if err != nil {
		return nil, fmt.Errorf("list provider models: %w", ErrProviderUnavailable)
	}
	defer response.Body.Close()
	if err := classifyStatus(response.StatusCode); err != nil {
		return nil, err
	}
	var payload struct {
		Data []catalogModel `json:"data"`
	}
	if err := decodeBoundedJSON(response.Body, &payload); err != nil {
		return nil, fmt.Errorf("decode provider models: %w", ErrProtocol)
	}
	models := make([]ModelMetadata, 0, len(payload.Data))
	for _, model := range payload.Data {
		if model.IsReady != nil && !*model.IsReady {
			continue
		}
		if strings.TrimSpace(model.ID) != "" {
			metadata := classifyModelMetadata(model.ID, model.OwnedBy, model.Description, model.Provider, model.ProviderType, model.PrivacyMode, model.Verifiable)
			models = append(models, enrichModelMetadata(metadata, model, profile.Kind == KindNearAIPreset))
		}
	}
	return models, nil
}

func modelIDs(metadata []ModelMetadata) []string {
	models := make([]string, 0, len(metadata))
	for _, model := range metadata {
		models = append(models, model.ID)
	}
	return models
}

// classifyModelMetadata consumes provider model-directory metadata.
// Chutes stays a distinct catalog type with verifiable=false even when the
// upstream directory advertises TEE: the current SDK cannot verify that
// attestation format. Private TEE is enabled only for the SDK-supported
// allowlist. Unknown models, advertised verifiable flags, and TDX copy
// never default a model into Private TEE.
func classifyModelMetadata(id, ownedBy, description, providerName, providerType, advertisedPrivacyMode string, advertisedVerifiable *bool) ModelMetadata {
	if advertisedPrivacyMode == PrivacyModeChutes || looksLikeChutesModel(id, ownedBy, description, providerName, providerType) {
		return ModelMetadata{ID: id, PrivacyMode: PrivacyModeChutes, Verifiable: false}
	}
	if advertisedPrivacyMode == PrivacyModeIncognito {
		return ModelMetadata{ID: id, PrivacyMode: PrivacyModeIncognito, Verifiable: false}
	}
	if _, ok := verifiedModelIDs[id]; ok {
		return ModelMetadata{ID: id, PrivacyMode: PrivacyModePrivateTEE, Verifiable: true}
	}
	return ModelMetadata{ID: id, PrivacyMode: PrivacyModeIncognito, Verifiable: false}
}

func looksLikeChutesModel(id, ownedBy, description, providerName, providerType string) bool {
	haystack := strings.ToLower(strings.Join([]string{id, ownedBy, description, providerName, providerType}, " "))
	return strings.Contains(haystack, "chutes")
}

func (adapter *HTTPAdapter) ValidateChat(ctx context.Context, profile Profile, secret credentials.Secret) error {
	ctx, cancel := context.WithTimeout(ctx, providerPreflightTimeout)
	defer cancel()
	payload := struct {
		Model    string `json:"model"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		MaxTokens int  `json:"max_tokens"`
		Stream    bool `json:"stream"`
	}{
		Model: profile.Model,
		Messages: []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		}{{Role: "user", Content: "Connection test"}},
		MaxTokens: 1,
		Stream:    false,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode provider validation: %w", ErrProtocol)
	}
	request, err := adapter.newRequest(ctx, http.MethodPost, profile, "/chat/completions", secret)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Body = io.NopCloser(strings.NewReader(string(body)))
	request.ContentLength = int64(len(body))
	response, err := adapter.do(request)
	if err != nil {
		return fmt.Errorf("validate provider chat: %w", ErrProviderUnavailable)
	}
	defer response.Body.Close()
	if err := classifyStatus(response.StatusCode); err != nil {
		return err
	}
	return nil
}

func (adapter *HTTPAdapter) newRequest(ctx context.Context, method string, profile Profile, suffix string, secret credentials.Secret) (*http.Request, error) {
	profile, err := NormalizeProfile(profile)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(secret.Value) == "" {
		return nil, ErrAuthenticationFailed
	}
	endpoint, err := url.Parse(profile.Endpoint)
	if err != nil {
		return nil, ErrInvalidEndpoint
	}
	path := strings.TrimRight(endpoint.Path, "/")
	if !strings.HasSuffix(path, "/v1") {
		path += "/v1"
	}
	endpoint.Path = path + suffix
	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), nil)
	if err != nil {
		return nil, ErrInvalidEndpoint
	}
	request.Header.Set("Accept", "application/json")
	switch profile.AuthMethod {
	case AuthBearer:
		request.Header.Set("Authorization", "Bearer "+secret.Value)
	case AuthAPIKey:
		request.Header.Set("X-API-Key", secret.Value)
	default:
		return nil, ErrInvalidAuth
	}
	return request, nil
}

func classifyStatus(status int) error {
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return ErrAuthenticationFailed
	case status == http.StatusTooManyRequests:
		return ErrRateLimited
	case status >= http.StatusInternalServerError:
		return ErrProviderUnavailable
	case status < http.StatusOK || status >= http.StatusMultipleChoices:
		return ErrProtocol
	default:
		return nil
	}
}

func decodeBoundedJSON(reader io.Reader, target any) error {
	decoder := json.NewDecoder(io.LimitReader(reader, 1<<20))
	return decoder.Decode(target)
}

func containsModel(models []string, wanted string) bool {
	for _, model := range models {
		if model == wanted {
			return true
		}
	}
	return false
}
