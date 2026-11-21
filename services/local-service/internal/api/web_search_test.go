package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/websearch"
)

func TestWebSearchSettingsRequireSessionAndCSRFAndReturnNoSecrets(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "search.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	secrets := credentials.NewMemoryStore()
	if err := secrets.ReplaceAfterValidation(context.Background(), "cove-web-search-tavily", 0, credentials.Secret{Value: "synthetic-private-key"}); err != nil {
		t.Fatal(err)
	}
	server := NewServer(Config{LaunchToken: "launch-token", Chat: &fakeChat{}, SearchService: websearch.NewService(store, secrets, nil)})
	token, csrf := launchBrowserSession(t, server)
	data, _ := json.Marshal(map[string]any{"policy": websearch.Defaults()})
	for _, scenario := range []struct {
		method, path   string
		session, proof bool
		want           int
	}{
		{"GET", "/api/web-search/settings", false, false, 401},
		{"GET", "/api/web-search/settings", true, false, 200},
		{"PUT", "/api/web-search/settings", true, false, 403},
		{"PUT", "/api/web-search/settings", true, true, 200},
		{"POST", "/api/web-search/test", false, false, 401},
		{"POST", "/api/web-search/test", true, false, 403},
		{"DELETE", "/api/web-search/providers/tavily", true, false, 403},
		{"POST", "/api/generations/id/web-search/tools", true, false, 403},
		{"GET", "/api/generations/id/web-search/tools/call", false, false, 401},
		{"DELETE", "/api/web-search/providers/tavily", true, true, 204},
	} {
		request := httptest.NewRequest(scenario.method, "http://127.0.0.1:47123"+scenario.path, strings.NewReader(string(data)))
		request.Header.Set("Origin", "http://127.0.0.1:47123")
		request.Header.Set("Content-Type", "application/json")
		if scenario.session {
			request.Header.Set("X-Cove-Session-Token", token)
		}
		if scenario.proof {
			request.Header.Set("X-Cove-CSRF-Token", csrf)
		}
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != scenario.want {
			t.Fatalf("%s %s: got %d, want %d", scenario.method, scenario.path, response.Code, scenario.want)
		}
		if strings.Contains(response.Body.String(), "synthetic-private-key") {
			t.Fatal("secret returned by settings")
		}
	}
}
