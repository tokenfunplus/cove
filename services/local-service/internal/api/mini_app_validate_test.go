package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestMiniAppDraftValidationDoesNotGrantPublisherAuthorityOrInstall(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	server := NewServer(Config{Store: store, LaunchToken: "launch-token"})
	token, csrf := launchBrowserSession(t, server)
	source, err := os.ReadFile("../appcatalog/packages/japanese-review-book-1.2.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	var draft miniapps.Package
	if err := json.Unmarshal(source, &draft); err != nil {
		t.Fatal(err)
	}
	// An author can validate an unpublished draft without claiming its identity.
	draft.Version = "99.0.0"
	raw, err := json.Marshal(draft)
	if err != nil {
		t.Fatal(err)
	}
	post := func(operation string, body []byte, session, crossSite string, want int) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/mini-apps/packages/"+operation, bytes.NewReader(body))
		request.Header.Set("Origin", "http://127.0.0.1:47123")
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Cove-Session-Token", session)
		request.Header.Set("X-Cove-CSRF-Token", crossSite)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s returned %d; want %d: %s", operation, response.Code, want, response.Body.String())
		}
		return response
	}
	post("validate", raw, "", "", http.StatusUnauthorized)
	post("validate", raw, token, "", http.StatusForbidden)
	response := post("validate", raw, token, csrf, http.StatusOK)
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("draft validation must not be cached")
	}
	var result map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if string(result["publisher"]) != `"cove"` || string(result["version"]) != `"99.0.0"` {
		t.Fatal("draft validation did not return the parsed contract")
	}
	for _, attestation := range []string{"id", "origin", "digest", "package"} {
		if _, exists := result[attestation]; exists {
			t.Fatalf("structure validation attested %s", attestation)
		}
	}
	post("preview", raw, token, csrf, http.StatusBadRequest)
	post("install", raw, token, csrf, http.StatusConflict)
	post("validate", []byte(`{}`), token, csrf, http.StatusBadRequest)
	post("validate", []byte(strings.Repeat(" ", (1<<20)+1)), token, csrf, http.StatusBadRequest)
	releases, err := server.apps.Releases(context.Background())
	if err != nil || len(releases) != 0 {
		t.Fatalf("draft validation or rejected install created releases: %v", err)
	}
	instances, err := server.apps.Instances(context.Background())
	if err != nil || len(instances) != 0 {
		t.Fatalf("draft validation created instances: %v", err)
	}
}
