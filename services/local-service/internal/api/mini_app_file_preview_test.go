package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestFileInstallRequiresReviewedIdentityAndExactBytes(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	server := NewServer(Config{Store: store, LaunchToken: "launch-token"})
	token, csrf := launchBrowserSession(t, server)
	source, err := os.ReadFile("../appcatalog/testdata/legacy-releases/reading-inbox.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	source = bytes.Replace(source, []byte(`"bookshelf"`), []byte(`"personal-author"`), 1)
	post := func(operation string, body []byte, reviewed miniapps.Release, want int) []byte {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/mini-apps/packages/"+operation, bytes.NewReader(body))
		request.Header.Set("Origin", "http://127.0.0.1:47123")
		request.Header.Set("X-Cove-Session-Token", token)
		request.Header.Set("X-Cove-CSRF-Token", csrf)
		request.Header.Set("X-Cove-Release-ID", reviewed.ID)
		request.Header.Set("X-Cove-Package-Digest", reviewed.Digest)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s returned %d; want %d: %s", operation, response.Code, want, response.Body.String())
		}
		return response.Body.Bytes()
	}
	var reviewed miniapps.Release
	if err := json.Unmarshal(post("preview", source, miniapps.Release{}, 200), &reviewed); err != nil {
		t.Fatal(err)
	}
	post("install", source, miniapps.Release{}, 409)
	wrongIdentity := reviewed
	wrongIdentity.ID = "another-release"
	post("install", source, wrongIdentity, 409)
	post("install", append(append([]byte{}, source...), '\n'), reviewed, 409)
	releases, err := server.apps.Releases(t.Context())
	if err != nil || len(releases) != 0 {
		t.Fatal("rejected file install created local releases", releases, err)
	}
	post("install", source, reviewed, 200)
	releases, err = server.apps.Releases(t.Context())
	if err != nil || len(releases) != 1 || releases[0].ID != reviewed.ID || releases[0].Digest != reviewed.Digest {
		t.Fatal("accepted file differs from reviewed bytes", releases, err)
	}
}
