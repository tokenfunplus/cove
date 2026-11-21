// Package websearch manages search connections and normalizes search evidence.
package websearch

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

var ErrUnavailable = errors.New("configure a search Provider in Settings before enabling Web search")

type Policy struct {
	Provider       string   `json:"provider"`
	MaxSearches    int      `json:"max_searches"`
	MaxPages       int      `json:"max_pages"`
	MaxRounds      int      `json:"max_rounds"`
	MaxResults     int      `json:"max_results"`
	TimeoutSeconds int      `json:"timeout_seconds"`
	Depth          string   `json:"depth"`
	IncludeDomains []string `json:"include_domains,omitempty"`
	ExcludeDomains []string `json:"exclude_domains,omitempty"`
}

func Defaults() Policy {
	return Policy{Provider: "tavily", MaxSearches: 3, MaxPages: 5, MaxRounds: 8, MaxResults: 5, TimeoutSeconds: 90, Depth: "standard"}
}

func ValidProvider(value string) bool {
	return value == "tavily" || value == "linkup" || value == "exa"
}

func (policy Policy) Validate() error {
	if !ValidProvider(policy.Provider) || policy.MaxSearches < 1 || policy.MaxSearches > 20 || policy.MaxPages < 1 || policy.MaxPages > 20 || policy.MaxRounds < 1 || policy.MaxRounds > 32 || policy.MaxResults < 1 || policy.MaxResults > 10 || policy.TimeoutSeconds < 15 || policy.TimeoutSeconds > 180 || (policy.Depth != "standard" && policy.Depth != "deep") {
		return errors.New("Choose valid Web search limits and a supported Provider.")
	}
	for _, domains := range [][]string{policy.IncludeDomains, policy.ExcludeDomains} {
		if len(domains) > 20 {
			return errors.New("Use at most twenty domains per filter.")
		}
		for _, domain := range domains {
			parsed, err := url.Parse("https://" + domain)
			if err != nil || parsed.Hostname() == "" || parsed.Host != domain || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
				return errors.New("Use domain names without paths in search filters.")
			}
		}
	}
	return nil
}

type ConfigStore interface {
	LoadWebSearchSettings(context.Context) (Policy, error)
	SaveWebSearchSettings(context.Context, Policy) error
}

type ProviderStatus struct {
	Provider   string `json:"provider"`
	Configured bool   `json:"configured"`
}

type Settings struct {
	Policy    Policy           `json:"policy"`
	Providers []ProviderStatus `json:"providers"`
}

type Service struct {
	store   ConfigStore
	secrets credentials.SecretStore
	client  *http.Client
	mu      sync.Mutex
}

func NewService(store ConfigStore, secrets credentials.SecretStore, client *http.Client) *Service {
	if client == nil {
		client = &http.Client{Timeout: 180 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	return &Service{store: store, secrets: secrets, client: client}
}

func secretID(vendor string) string { return "cove-web-search-" + vendor }

func (service *Service) Settings(ctx context.Context) (Settings, error) {
	policy, err := service.store.LoadWebSearchSettings(ctx)
	if err != nil {
		return Settings{}, err
	}
	settings := Settings{Policy: policy, Providers: make([]ProviderStatus, 0, 3)}
	for _, vendor := range []string{"tavily", "linkup", "exa"} {
		configured, err := service.secrets.Exists(ctx, secretID(vendor))
		if err != nil {
			return Settings{}, errors.New("Search credentials are unavailable.")
		}
		settings.Providers = append(settings.Providers, ProviderStatus{Provider: vendor, Configured: configured})
	}
	return settings, nil
}

func (service *Service) Policy(ctx context.Context) (Policy, error) {
	settings, err := service.Settings(ctx)
	if err != nil {
		return Policy{}, err
	}
	for _, item := range settings.Providers {
		if item.Provider == settings.Policy.Provider && item.Configured {
			return settings.Policy, nil
		}
	}
	return Policy{}, ErrUnavailable
}

// Save validates a replacement key before replacing the existing usable secret.
func (service *Service) Save(ctx context.Context, policy Policy, key string) error {
	if err := policy.Validate(); err != nil {
		return err
	}
	key = strings.TrimSpace(key)
	if len(key) > 4096 || strings.ContainsAny(key, "\r\n") {
		return errors.New("Enter a valid search API key.")
	}
	if key != "" {
		probe := policy
		probe.MaxResults = 1
		probe.Depth = "standard"
		probeContext, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		if _, _, err := service.search(probeContext, probe, "Web search connection test", key); err != nil {
			return err
		}
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	previous, err := service.store.LoadWebSearchSettings(ctx)
	if err != nil {
		return err
	}
	var current credentials.Secret
	if key != "" {
		current, err = service.secrets.Get(ctx, secretID(policy.Provider))
		if err != nil && !errors.Is(err, credentials.ErrSecretNotFound) {
			return errors.New("Search credentials could not be read.")
		}
	}
	if err := service.store.SaveWebSearchSettings(ctx, policy); err != nil {
		return err
	}
	if key != "" {
		if err := service.secrets.ReplaceAfterValidation(ctx, secretID(policy.Provider), current.Version, credentials.Secret{Value: key}); err != nil {
			_ = service.store.SaveWebSearchSettings(context.Background(), previous)
			return errors.New("The search key could not be saved. The previous key is retained.")
		}
	}
	return nil
}

func (service *Service) Delete(ctx context.Context, vendor string) error {
	if !ValidProvider(vendor) {
		return errors.New("Choose a supported search Provider.")
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	return service.secrets.Delete(ctx, secretID(vendor))
}

func (service *Service) Search(ctx context.Context, policy Policy, query string) ([]documents.Prepared, json.RawMessage, error) {
	if err := policy.Validate(); err != nil {
		return nil, nil, err
	}
	query = strings.TrimSpace(query)
	if query == "" || utf8.RuneCountInString(query) > 512 {
		return nil, nil, errors.New("Search queries must contain between 1 and 512 characters.")
	}
	secret, err := service.secrets.Get(ctx, secretID(policy.Provider))
	if err != nil {
		return nil, nil, ErrUnavailable
	}
	bounded, cancel := context.WithTimeout(ctx, time.Duration(policy.TimeoutSeconds)*time.Second)
	defer cancel()
	return service.search(bounded, policy, query, secret.Value)
}

func (service *Service) search(ctx context.Context, policy Policy, query, key string) ([]documents.Prepared, json.RawMessage, error) {
	body := map[string]any{}
	endpoint := ""
	switch policy.Provider {
	case "tavily":
		endpoint = "https://api.tavily.com/search"
		depth := "basic"
		if policy.Depth == "deep" {
			depth = "advanced"
		}
		body = map[string]any{"query": query, "search_depth": depth, "max_results": policy.MaxResults, "include_answer": false, "include_raw_content": false, "include_usage": true, "include_domains": policy.IncludeDomains, "exclude_domains": policy.ExcludeDomains}
	case "linkup":
		endpoint = "https://api.linkup.so/v1/search"
		body = map[string]any{"q": query, "depth": policy.Depth, "outputType": "searchResults", "maxResults": policy.MaxResults, "includeDomains": policy.IncludeDomains, "excludeDomains": policy.ExcludeDomains}
	case "exa":
		endpoint = "https://api.exa.ai/search"
		mode := "auto"
		if policy.Depth == "deep" {
			mode = "deep"
		}
		body = map[string]any{"query": query, "type": mode, "numResults": policy.MaxResults, "contents": map[string]any{"highlights": true}, "includeDomains": policy.IncludeDomains, "excludeDomains": policy.ExcludeDomains}
	default:
		return nil, nil, ErrUnavailable
	}
	for _, names := range [][]string{{"include_domains", "exclude_domains"}, {"includeDomains", "excludeDomains"}} {
		if len(policy.IncludeDomains) == 0 {
			delete(body, names[0])
		}
		if len(policy.ExcludeDomains) == 0 {
			delete(body, names[1])
		}
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return nil, nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	if policy.Provider == "exa" {
		request.Header.Set("x-api-key", key)
	} else {
		request.Header.Set("Authorization", "Bearer "+key)
	}
	response, err := service.client.Do(request)
	if err != nil {
		return nil, nil, errors.New("The search service could not be reached.")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		switch response.StatusCode {
		case 401, 403:
			return nil, nil, errors.New("The search API key was rejected. Update it in Settings.")
		case 402:
			return nil, nil, errors.New("The search Provider reported insufficient credits.")
		case 429:
			return nil, nil, errors.New("The search Provider is rate limiting requests. Try again later.")
		}
		return nil, nil, fmt.Errorf("The search Provider returned HTTP %d.", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 2<<20+1))
	if err != nil || len(data) > 2<<20 {
		return nil, nil, errors.New("The search response exceeded its size limit or was interrupted.")
	}
	var payload struct {
		Results []struct {
			Title         string   `json:"title"`
			Name          string   `json:"name"`
			URL           string   `json:"url"`
			Content       string   `json:"content"`
			Text          string   `json:"text"`
			Highlights    []string `json:"highlights"`
			PublishedAt   string   `json:"publishedAt"`
			PublishedDate string   `json:"publishedDate"`
		} `json:"results"`
		Usage json.RawMessage `json:"usage"`
		Cost  json.RawMessage `json:"costDollars"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, nil, errors.New("The search service returned an invalid response.")
	}
	var sources []documents.Prepared
	for _, result := range payload.Results {
		if len(sources) >= policy.MaxResults {
			break
		}
		if len(result.URL) > 8192 {
			continue
		}
		parsed, err := url.Parse(result.URL)
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Hostname() == "" || parsed.User != nil {
			continue
		}
		text := result.Content
		if text == "" {
			text = strings.Join(result.Highlights, "\n")
		}
		if text == "" {
			text = result.Text
		}
		textRunes := []rune(text)
		if len(textRunes) > 3000 {
			text = string(textRunes[:3000])
		}
		if strings.TrimSpace(text) == "" {
			continue
		}
		source, err := documents.Parse(ctx, documents.Input{Name: "search-result.txt", Data: []byte(text)})
		if err != nil {
			continue
		}
		title := result.Title
		if title == "" {
			title = result.Name
		}
		if title == "" {
			title = parsed.Hostname()
		}
		title = strings.Join(strings.Fields(title), " ")
		runes := []rune(title)
		if len(runes) > 190 {
			title = string(runes[:190])
		}
		source.Name = title
		source.Web = &documents.WebSource{OriginalURL: result.URL, FinalURL: result.URL, FetchedAt: time.Now().UTC().Format(time.RFC3339Nano), ContentSHA256: source.ID, Kind: "search_result"}
		source.Web.PublishedAt = result.PublishedAt
		if source.Web.PublishedAt == "" {
			source.Web.PublishedAt = result.PublishedDate
		}
		if len(source.Web.PublishedAt) > 128 {
			source.Web.PublishedAt = ""
		}
		source.ExtractionVersion = "cove-search-" + policy.Provider + "-v1"
		identity, _ := json.Marshal(source.Snapshot)
		digest := sha256.Sum256(identity)
		source.ID = fmt.Sprintf("%x", digest)
		sources = append(sources, source)
	}
	usage := payload.Usage
	if len(usage) == 0 {
		usage = payload.Cost
	}
	if len(usage) > 16384 || string(usage) == "null" {
		usage = nil
	}
	return sources, usage, nil
}

func Tools() []provider.Tool {
	return []provider.Tool{
		{Type: "function", Function: provider.ToolFunction{Name: "web_search", Description: "Search the public web when fresh information or external evidence is needed. Results contain saved source sections that can be cited.", Parameters: json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","maxLength":512}},"required":["query"],"additionalProperties":false}`)}},
		{Type: "function", Function: provider.ToolFunction{Name: "read_webpage", Description: "Read a public webpage URL supplied by the user or discovered in search. Use this for detail beyond a search excerpt.", Parameters: json.RawMessage(`{"type":"object","properties":{"url":{"type":"string","maxLength":8192}},"required":["url"],"additionalProperties":false}`)}},
	}
}
