package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/downloadnetwork"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestDownloadNetworkSessionCSRFValidationAndPersistence(t *testing.T) {
	store := persistence.DownloadNetworkFile{Root: t.TempDir()}
	service := downloadnetwork.New(store, nil)
	server := NewServer(Config{LaunchToken: "launch-token", Chat: &fakeChat{}, DownloadNetwork: service})
	token, csrf := launchBrowserSession(t, server)
	for _, scenario := range []struct {
		method, path, body string
		session, proof     bool
		want               int
	}{
		{"GET", "/api/network/settings", "", false, false, 401},
		{"GET", "/api/network/settings", "", true, false, 200},
		{"PUT", "/api/network/settings", `{"mode":"direct"}`, true, false, 403},
		{"POST", "/api/network/test", `{"mode":"direct"}`, false, false, 401},
		{"POST", "/api/network/test", `{"mode":"direct"}`, true, false, 403},
		{"PUT", "/api/network/settings", `{"mode":"manual","proxy_url":"http://private-user:private-password@localhost:7890"}`, true, true, 400},
		{"POST", "/api/network/test", `{"mode":"direct","target":"http://127.0.0.1:1"}`, true, true, 400},
		{"PUT", "/api/network/settings", `{"mode":"direct"} {}`, true, true, 400},
		{"PUT", "/api/network/settings", `{"mode":"direct","proxy_url":"` + strings.Repeat("x", 5000) + `"}`, true, true, 400},
		{"PUT", "/api/network/settings", `{"mode":"manual","proxy_url":"socks5://localhost:1080"}`, true, true, 200},
	} {
		r := httptest.NewRequest(scenario.method, "http://127.0.0.1:47123"+scenario.path, strings.NewReader(scenario.body))
		r.Header.Set("Origin", "http://127.0.0.1:47123")
		r.Header.Set("Content-Type", "application/json")
		if scenario.session {
			r.Header.Set("X-Cove-Session-Token", token)
		}
		if scenario.proof {
			r.Header.Set("X-Cove-CSRF-Token", csrf)
		}
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		if w.Code != scenario.want {
			t.Fatalf("%s %s: %d want %d: %s", scenario.method, scenario.path, w.Code, scenario.want, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "private-") {
			t.Fatal("credentials leaked")
		}
		if scenario.session && scenario.proof && w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("settings response may be cached")
		}
	}
	view, err := downloadnetwork.New(store, nil).Settings()
	if err != nil || view.Configuration.ProxyURL != "socks5://localhost:1080" {
		t.Fatal("save was not durable")
	}
}
