package websearch

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

type memoryConfig struct{ policy Policy }

func (s *memoryConfig) LoadWebSearchSettings(context.Context) (Policy, error) { return s.policy, nil }
func (s *memoryConfig) SaveWebSearchSettings(_ context.Context, p Policy) error {
	s.policy = p
	return nil
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestAdaptersNormalizeEvidenceAndNeverLeakRejectedKeys(t *testing.T) {
	for _, vendor := range []string{"tavily", "linkup", "exa"} {
		t.Run(vendor, func(t *testing.T) {
			ctx := context.Background()
			config := &memoryConfig{Defaults()}
			secrets := credentials.NewMemoryStore()
			calls := 0
			client := &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if r.URL.Scheme != "https" || !strings.Contains(r.URL.Host, map[string]string{"tavily": "tavily.com", "linkup": "linkup.so", "exa": "exa.ai"}[vendor]) {
					t.Fatal("wrong fixed destination")
				}
				key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
				if vendor == "exa" {
					key = r.Header.Get("x-api-key")
				}
				if key == "rejected-key" {
					return &http.Response{StatusCode: 401, Body: io.NopCloser(strings.NewReader(`{"error":"rejected-key"}`))}, nil
				}
				if key != "fixture-key" {
					t.Fatal("missing expected credential")
				}
				if vendor == "tavily" && (body["search_depth"] != "basic" || body["max_results"] == nil) {
					t.Fatal("incorrect Tavily request")
				}
				if vendor == "linkup" && (body["outputType"] != "searchResults" || body["q"] == nil) {
					t.Fatal("incorrect Linkup request")
				}
				if vendor == "exa" && (body["type"] != "auto" || body["contents"] == nil) {
					t.Fatal("incorrect Exa request")
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"results":[{"name":"Official source","url":"https://example.com/doc","content":"Evidence line","publishedAt":"2026-11-01"},{"url":"javascript:invalid","content":"invalid"}],"usage":{"credits":1}}`))}, nil
			})}
			service := NewService(config, secrets, client)
			policy := Defaults()
			policy.Provider = vendor
			if err := service.Save(ctx, policy, "fixture-key"); err != nil {
				t.Fatal(err)
			}
			if err := service.Save(ctx, policy, "rejected-key"); err == nil || strings.Contains(err.Error(), "rejected-key") {
				t.Fatal("validation failed to sanitize key")
			}
			sources, usage, err := service.Search(ctx, policy, "evidence")
			if err != nil || len(sources) != 1 || sources[0].Web.Kind != "search_result" || sources[0].Web.PublishedAt != "2026-11-01" || len(usage) == 0 {
				t.Fatalf("unexpected normalized evidence: %v", err)
			}
			if sources[0].ID == sources[0].Web.ContentSHA256 || sources[0].Sections[0].Text != "Evidence line" {
				t.Fatal("snapshot identity or evidence text incorrect")
			}
			before := calls
			if _, err := service.Settings(ctx); err != nil || calls != before {
				t.Fatal("passive settings contacted search provider")
			}
			secrets.FailNextReplace(errors.New("fixture failure"))
			replacement := policy
			replacement.MaxSearches = 7
			if err := service.Save(ctx, replacement, "fixture-key"); err == nil || config.policy.MaxSearches != policy.MaxSearches {
				t.Fatal("failed key save changed settings")
			}
			if err := service.Delete(ctx, vendor); err != nil {
				t.Fatal(err)
			}
			if _, _, err := service.Search(ctx, policy, "evidence"); !errors.Is(err, ErrUnavailable) {
				t.Fatal("removed key remained usable")
			}
		})
	}
}

func TestPolicyAndSearchResponseBounds(t *testing.T) {
	policy := Defaults()
	policy.IncludeDomains = []string{"example.com/path"}
	if policy.Validate() == nil {
		t.Fatal("path accepted as domain")
	}
	policy = Defaults()
	policy.MaxSearches = 0
	if policy.Validate() == nil {
		t.Fatal("unbounded policy accepted")
	}
	secrets := credentials.NewMemoryStore()
	ctx := context.Background()
	_ = secrets.ReplaceAfterValidation(ctx, secretID("tavily"), 0, credentials.Secret{Value: "fixture"})
	for _, body := range []string{"invalid", strings.Repeat("x", 2<<20+1)} {
		service := NewService(&memoryConfig{Defaults()}, secrets, &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
		})})
		if _, _, err := service.Search(ctx, Defaults(), "bounded"); err == nil {
			t.Fatal("invalid search response accepted")
		}
	}
}
