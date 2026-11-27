package api

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/appcatalog"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestCatalogOffersNewestUsableReleaseWhenPublisherTargetsTwoHosts(t *testing.T) {
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile("../appcatalog/packages/reading-inbox.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	var pkg miniapps.Package
	if err = json.Unmarshal(source, &pkg); err != nil {
		t.Fatal(err)
	}
	pkg.Publisher = "author"
	pkg.Version = "1.1.0"
	pkg.MinHostVersion = miniapps.RuntimeVersion
	compatible, err := json.Marshal(pkg)
	if err != nil {
		t.Fatal(err)
	}
	pkg.Version = "2.0.0"
	pkg.MinHostVersion = "9000.0.0"
	newer, err := json.Marshal(pkg)
	if err != nil {
		t.Fatal(err)
	}
	index, err := json.Marshal(appcatalog.SignedIndex{Format: 2, Sequence: 1, IssuedAt: time.Now().UTC(), ExpiresAt: time.Now().UTC().Add(time.Hour), Packages: [][]byte{newer, compatible}})
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := json.Marshal(map[string][]byte{"payload": index, "signature": ed25519.Sign(private, index)})
	if err != nil {
		t.Fatal(err)
	}
	remote := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(envelope) }))
	defer remote.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = remote.Client().Transport
	defer func() { http.DefaultTransport = previous }()
	dir, err := appcatalog.Open(filepath.Join(t.TempDir(), "catalog.json"), appcatalog.Catalog{URL: remote.URL, PublicKey: base64.StdEncoding.EncodeToString(public)})
	if err != nil {
		t.Fatal(err)
	}
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := NewServer(Config{LaunchToken: "launch-token", Store: store, AppCatalog: dir})
	token, csrf := launchBrowserSession(t, server)
	call := func(method, path, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:47123/api/mini-apps/catalog"+path, strings.NewReader(body))
		req.Header.Set("X-Cove-Session-Token", token)
		req.Header.Set("X-Cove-CSRF-Token", csrf)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://127.0.0.1:47123")
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, req)
		if w.Code != status {
			t.Fatalf("%s %s: got status %d; want %d", method, path, w.Code, status)
		}
		return w
	}
	var list struct {
		Packages []appcatalog.Entry
		Warning  string
	}
	if err = json.Unmarshal(call("GET", "", "", 200).Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	var offered []appcatalog.Entry
	for _, e := range list.Packages {
		if e.Publisher == "author" {
			offered = append(offered, e)
		}
	}
	if list.Warning != "" || len(offered) != 1 || offered[0].Version != "1.1.0" {
		t.Fatalf("catalog offered incorrect releases: %+v", offered)
	}
	call("POST", "/author/reading-inbox/1.1.0/install", `{"digest":"`+offered[0].Digest+`"}`, 200)
	call("GET", "/author/reading-inbox/2.0.0", "", 409)
	call("POST", "/author/reading-inbox/2.0.0/install", "{}", 409)
}
