package api

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/appcatalog"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestCatalogPreviewValidatesSignedPackagesAndPreservesExactBytes(t *testing.T) {
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile("../appcatalog/testdata/legacy-releases/reading-inbox.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	var pkg miniapps.Package
	if err := json.Unmarshal(source, &pkg); err != nil {
		t.Fatal(err)
	}
	pkg.Publisher, pkg.App = "preview-author", "valid-notes"
	valid, err := json.MarshalIndent(pkg, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	// The package digest covers these exact whitespace-preserving bytes.
	valid = append(valid, '\n', '\n')
	malformed := []byte(`{"publisher":"preview-author","app":"broken-notes","name":"Broken notes","version":"1.0.0","schema_version":1}`)
	index, err := json.Marshal(appcatalog.SignedIndex{
		Format: 2, Sequence: 1, IssuedAt: time.Now().UTC(),
		ExpiresAt: time.Now().UTC().Add(time.Hour), Packages: [][]byte{malformed, valid},
	})
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := json.Marshal(map[string][]byte{"payload": index, "signature": ed25519.Sign(private, index)})
	if err != nil {
		t.Fatal(err)
	}
	remote := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(envelope)
	}))
	t.Cleanup(remote.Close)
	previous := http.DefaultTransport
	http.DefaultTransport = remote.Client().Transport
	t.Cleanup(func() { http.DefaultTransport = previous })
	directory, err := appcatalog.Open(filepath.Join(t.TempDir(), "catalog.json"), appcatalog.Catalog{
		URL: remote.URL, PublicKey: base64.StdEncoding.EncodeToString(public),
	})
	if err != nil {
		t.Fatal(err)
	}
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	server := NewServer(Config{Store: store, AppCatalog: directory, LaunchToken: "launch-token"})
	token, _ := launchBrowserSession(t, server)
	get := func(path string, want int) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/mini-apps"+path, nil)
		request.Header.Set("X-Cove-Session-Token", token)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("GET %s returned %d; want %d: %s", path, response.Code, want, response.Body.String())
		}
		return response
	}
	var listed struct{ Packages []appcatalog.Entry }
	if err := json.Unmarshal(get("/catalog", http.StatusOK).Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, entry := range listed.Packages {
		if entry.Publisher == "preview-author" {
			found[entry.App] = true
		}
	}
	if !found["broken-notes"] || !found["valid-notes"] {
		t.Fatal("the signed metadata fixture did not reach the catalog")
	}
	rejected := get("/catalog/preview-author/broken-notes/1.0.0", http.StatusBadRequest)
	if rejected.Header().Get("X-Cove-Package-Digest") != "" {
		t.Fatal("invalid package was advertised as a usable preview")
	}
	accepted := get("/catalog/preview-author/valid-notes/1.0.0", http.StatusOK)
	digest := sha256.Sum256(valid)
	if !bytes.Equal(accepted.Body.Bytes(), valid) || accepted.Header().Get("X-Cove-Package-Digest") != hex.EncodeToString(digest[:]) {
		t.Fatal("valid preview changed the reviewed package bytes or digest")
	}
	if accepted.Header().Get("Content-Type") != "application/json" || accepted.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("preview response lost its content type or cache policy")
	}
	for _, path := range []string{"/packages", "/instances"} {
		var saved map[string][]json.RawMessage
		if err := json.Unmarshal(get(path, http.StatusOK).Body.Bytes(), &saved); err != nil {
			t.Fatal(err)
		}
		for _, items := range saved {
			if len(items) != 0 {
				t.Fatalf("preview created local data at %s", path)
			}
		}
	}
}
