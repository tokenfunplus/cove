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
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/appcatalog"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

type fileRefreshHost struct {
	server     *Server
	token      string
	csrf       string
	privateKey ed25519.PrivateKey
	publicKey  string
	body       atomic.Value
	status     atomic.Int32
	calls      atomic.Int64
}

func fileRefreshPackage(t *testing.T, publisher, version string) []byte {
	t.Helper()
	raw, err := os.ReadFile("../appcatalog/packages/reading-inbox.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	var pkg miniapps.Package
	if err := json.Unmarshal(raw, &pkg); err != nil {
		t.Fatal(err)
	}
	pkg.Publisher, pkg.Version = publisher, version
	raw, err = json.Marshal(pkg)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func newFileRefreshHost(t *testing.T, initial []byte) *fileRefreshHost {
	t.Helper()
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	host := &fileRefreshHost{privateKey: private, publicKey: base64.StdEncoding.EncodeToString(public)}
	host.publish(t, 1, initial)
	host.status.Store(http.StatusOK)
	remote := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		host.calls.Add(1)
		w.WriteHeader(int(host.status.Load()))
		_, _ = w.Write(host.body.Load().([]byte))
	}))
	t.Cleanup(remote.Close)
	previous := http.DefaultTransport
	http.DefaultTransport = remote.Client().Transport
	t.Cleanup(func() { http.DefaultTransport = previous })
	directory, err := appcatalog.Open("", appcatalog.Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	if err := directory.ReplaceTrust(appcatalog.Catalog{URL: remote.URL, PublicKey: host.publicKey}, appcatalog.Catalog{}); err != nil {
		t.Fatal(err)
	}
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	host.server = NewServer(Config{Store: store, AppCatalog: directory, LaunchToken: "launch-token"})
	host.token, host.csrf = launchBrowserSession(t, host.server)
	return host
}

func (host *fileRefreshHost) publish(t *testing.T, sequence int64, packages ...[]byte) {
	t.Helper()
	now := time.Now().UTC()
	payload, err := json.Marshal(appcatalog.SignedIndex{Format: 2, Sequence: sequence, IssuedAt: now, ExpiresAt: now.Add(time.Hour), Packages: packages})
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := json.Marshal(map[string][]byte{"payload": payload, "signature": ed25519.Sign(host.privateKey, payload)})
	if err != nil {
		t.Fatal(err)
	}
	host.body.Store(envelope)
}

func (host *fileRefreshHost) request(t *testing.T, method, path string, raw []byte, reviewed miniapps.Release) []byte {
	t.Helper()
	request := httptest.NewRequest(method, "http://127.0.0.1:47123/api/mini-apps"+path, bytes.NewReader(raw))
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	request.Header.Set("X-Cove-Session-Token", host.token)
	request.Header.Set("X-Cove-CSRF-Token", host.csrf)
	request.Header.Set("X-Cove-Release-ID", reviewed.ID)
	request.Header.Set("X-Cove-Package-Digest", reviewed.Digest)
	response := httptest.NewRecorder()
	host.server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("%s %s returned %d: %s", method, path, response.Code, response.Body.String())
	}
	return response.Body.Bytes()
}

func (host *fileRefreshHost) file(t *testing.T, operation string, raw []byte, reviewed miniapps.Release) miniapps.Release {
	t.Helper()
	var release miniapps.Release
	if err := json.Unmarshal(host.request(t, http.MethodPost, "/packages/"+operation, raw, reviewed), &release); err != nil {
		t.Fatal(err)
	}
	return release
}

func TestFilePreviewRefreshesCachedCatalogForNewlyPublishedVersion(t *testing.T) {
	old := fileRefreshPackage(t, "catalog-author", "1.0.0")
	next := fileRefreshPackage(t, "catalog-author", "1.1.0")
	host := newFileRefreshHost(t, old)
	host.request(t, http.MethodGet, "/catalog", nil, miniapps.Release{})
	if host.calls.Load() != 1 {
		t.Fatal("catalog was not warmed", host.calls.Load())
	}
	host.publish(t, 2, old, next)
	preview := host.file(t, "preview", next, miniapps.Release{})
	wantDigest := sha256.Sum256(next)
	if host.calls.Load() != 2 || preview.Origin != "catalog" || preview.CatalogAuthority != appcatalog.Authority(host.publicKey) || preview.OfficialCatalog || preview.Digest != hex.EncodeToString(wantDigest[:]) || preview.Package.Version != "1.1.0" {
		t.Fatal("immediate file preview did not verify the newly published release", preview, host.calls.Load())
	}
	if saved, err := host.server.apps.Releases(t.Context()); err != nil || len(saved) != 0 {
		t.Fatal("preview installed a release", saved, err)
	}
	installed := host.file(t, "install", next, preview)
	if installed.ID != preview.ID || installed.Digest != preview.Digest || installed.CatalogAuthority != preview.CatalogAuthority || host.calls.Load() != 2 {
		t.Fatal("installation lost the refreshed file proof or fetched again", installed, host.calls.Load())
	}
}

func TestFilePreviewFailureCachesFallbackAfterBypassingSuccessfulCatalog(t *testing.T) {
	old := fileRefreshPackage(t, "catalog-author", "1.0.0")
	personal := fileRefreshPackage(t, "personal-author", "1.0.0")
	host := newFileRefreshHost(t, old)
	host.request(t, http.MethodGet, "/catalog", nil, miniapps.Release{})
	host.status.Store(http.StatusServiceUnavailable)
	preview := host.file(t, "preview", personal, miniapps.Release{})
	if preview.Origin != "local" || preview.CatalogAuthority != "" || host.calls.Load() != 2 {
		t.Fatal("personal preview did not refresh once before falling back", preview, host.calls.Load())
	}
	installed := host.file(t, "install", personal, preview)
	if installed.ID != preview.ID || installed.Origin != "local" || host.calls.Load() != 2 {
		t.Fatal("install retried the failed catalog instead of using its brief fallback cache", installed, host.calls.Load())
	}
}

func TestFilePreviewKeepsUnknownPersonalPublisherLocalAfterSuccessfulRefresh(t *testing.T) {
	old := fileRefreshPackage(t, "catalog-author", "1.0.0")
	personal := fileRefreshPackage(t, "personal-author", "1.0.0")
	host := newFileRefreshHost(t, old)
	host.request(t, http.MethodGet, "/catalog", nil, miniapps.Release{})
	preview := host.file(t, "preview", personal, miniapps.Release{})
	if preview.Origin != "local" || preview.CatalogAuthority != "" || preview.OfficialCatalog || host.calls.Load() != 2 {
		t.Fatal("a refreshed catalog miss changed personal provenance", preview, host.calls.Load())
	}
	installed := host.file(t, "install", personal, preview)
	if installed.ID != preview.ID || installed.Origin != "local" || installed.CatalogAuthority != "" {
		t.Fatal("personal file installation acquired catalog provenance", installed)
	}
}
