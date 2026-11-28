package api

import (
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestMiniAppBackupRequiresSessionAndRestoreProof(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := NewServer(Config{LaunchToken: "launch-token", Store: store, Chat: &fakeChat{}})
	token, csrf := launchBrowserSession(t, server)
	raw, err := os.ReadFile("../appcatalog/testdata/legacy-releases/reading-inbox.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	release, err := server.apps.Install(t.Context(), raw, "local")
	if err != nil {
		t.Fatal(err)
	}
	instance, err := server.apps.Create(t.Context(), miniapps.CreateRequest{ReleaseID: release.ID, Name: "To read"})
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, path, body, session, proof string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://127.0.0.1:47123"+path, strings.NewReader(body))
		r.Header.Set("Origin", "http://127.0.0.1:47123")
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Cove-Session-Token", session)
		r.Header.Set("X-Cove-CSRF-Token", proof)
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w
	}
	path := "/api/mini-apps/instances/" + instance.ID + "/export"
	if got := request("GET", path, "", "", "").Code; got != 401 {
		t.Fatalf("unauthorized export: %d", got)
	}
	export := request("GET", path, "", token, "")
	if export.Code != 200 || export.Header().Get("Cache-Control") != "no-store" || !strings.Contains(export.Header().Get("Content-Disposition"), ".covedata") {
		t.Fatalf("export response: %d, %v", export.Code, export.Header())
	}
	restore := "/api/mini-apps/instances/restore"
	if got := request("POST", restore, export.Body.String(), token, "").Code; got != 403 {
		t.Fatalf("missing CSRF: %d", got)
	}
	if got := request("POST", restore, export.Body.String(), token, csrf).Code; got != 200 {
		t.Fatalf("restore: %d", got)
	}
}
