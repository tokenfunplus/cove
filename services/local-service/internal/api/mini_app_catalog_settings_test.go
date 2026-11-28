package api

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/appcatalog"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestCatalogAuthorityReplacementRequiresFreshConfirmation(t *testing.T) {
	public, _, _ := ed25519.GenerateKey(nil)
	key := base64.StdEncoding.EncodeToString(public)
	directory, _ := appcatalog.Open(filepath.Join(t.TempDir(), "catalog.json"), appcatalog.Catalog{})
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := NewServer(Config{LaunchToken: "launch-token", AppCatalog: directory, Store: store})
	token, csrf := launchBrowserSession(t, server)
	call := func(body map[string]any, want int) {
		t.Helper()
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest("PUT", "http://127.0.0.1:47123/api/mini-apps/catalog-settings", strings.NewReader(string(raw)))
		request.Header.Set("Origin", "http://127.0.0.1:47123")
		request.Header.Set("X-Cove-Session-Token", token)
		request.Header.Set("X-Cove-CSRF-Token", csrf)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("settings returned %d; want %d: %s", response.Code, want, response.Body.String())
		}
	}
	initial := appcatalog.Catalog{URL: "https://first.example/catalog.json", PublicKey: key}
	call(map[string]any{"url": initial.URL, "public_key": key}, 409)
	call(map[string]any{"url": initial.URL, "public_key": key, "confirm_trust": true, "previous": appcatalog.Catalog{}}, 200)
	moved := appcatalog.Catalog{URL: "https://moved.example/catalog.json", PublicKey: key}
	call(map[string]any{"url": moved.URL, "public_key": key}, 200)
	call(map[string]any{"url": "", "public_key": "", "confirm_trust": true, "previous": initial}, 409)
	call(map[string]any{"url": "", "public_key": ""}, 409)
	call(map[string]any{"url": "", "public_key": "", "confirm_trust": true, "previous": moved}, 200)
	if directory.Config() != (appcatalog.Catalog{}) {
		t.Fatal("confirmed reset did not select bundled releases")
	}
}

func TestRestorePackagedCatalogDefaultsRequiresConfirmationAndExposesMode(t *testing.T) {
	pub, _, _ := ed25519.GenerateKey(nil)
	defaults := appcatalog.Catalog{URL: "https://official.example/catalog.json", PublicKey: base64.StdEncoding.EncodeToString(pub)}
	directory, _ := appcatalog.Open(filepath.Join(t.TempDir(), "catalog.json"), defaults)
	if err := directory.ReplaceTrust(appcatalog.Catalog{}, defaults); err != nil {
		t.Fatal(err)
	}
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := NewServer(Config{LaunchToken: "launch-token", AppCatalog: directory, Store: store})
	token, csrf := launchBrowserSession(t, server)
	call := func(method string, body string, want int) appcatalog.DirectorySettings {
		t.Helper()
		r := httptest.NewRequest(method, "http://127.0.0.1:47123/api/mini-apps/catalog-settings", strings.NewReader(body))
		r.Header.Set("Origin", "http://127.0.0.1:47123")
		r.Header.Set("X-Cove-Session-Token", token)
		r.Header.Set("X-Cove-CSRF-Token", csrf)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		if w.Code != want {
			t.Fatal(w.Code, w.Body.String())
		}
		var settings appcatalog.DirectorySettings
		if want == 200 {
			if err := json.Unmarshal(w.Body.Bytes(), &settings); err != nil {
				t.Fatal(err)
			}
		}
		return settings
	}
	initial := call("GET", "", 200)
	if initial.Mode != "bundled" || initial.Defaults != defaults {
		t.Fatal("packaged defaults not exposed", initial)
	}
	call("PUT", `{"use_defaults":true}`, 409)
	got := call("PUT", `{"use_defaults":true,"confirm_trust":true,"previous":{"url":"","public_key":""}}`, 200)
	if got.Catalog != defaults || got.Mode != "default" {
		t.Fatal("failed to restore default tracking", got)
	}
}
