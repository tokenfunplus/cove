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
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/appcatalog"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestCatalogUpgradeRemainsBoundToItsOriginalSigner(t *testing.T) {
	pubA, keyA, _ := ed25519.GenerateKey(nil)
	pubB, keyB, _ := ed25519.GenerateKey(nil)
	source, err := os.ReadFile("../appcatalog/packages/reading-inbox.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	var pkg miniapps.Package
	if err := json.Unmarshal(source, &pkg); err != nil {
		t.Fatal(err)
	}
	pkg.Publisher, pkg.App = "alice", "notes"
	old, _ := json.Marshal(pkg)
	pkg.Version = "1.1.0"
	next, _ := json.Marshal(pkg)
	pkg.Version = "1.2.0"
	pending, _ := json.Marshal(pkg)
	pkg.Version = "1.1.0"
	pkg.Description = "A different signing authority's package."
	other, _ := json.Marshal(pkg)
	sign := func(key ed25519.PrivateKey, packages ...[]byte) []byte {
		payload, err := json.Marshal(appcatalog.SignedIndex{Format: 2, Sequence: 1, IssuedAt: time.Now().UTC(), ExpiresAt: time.Now().UTC().Add(time.Hour), Packages: packages})
		if err != nil {
			t.Fatal(err)
		}
		envelope, _ := json.Marshal(map[string][]byte{"payload": payload, "signature": ed25519.Sign(key, payload)})
		return envelope
	}
	signedA, signedB := sign(keyA, old, next, pending), sign(keyB, old, other, pending)
	var networkCalls atomic.Int64
	remote := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		networkCalls.Add(1)
		if r.URL.Path == "/a" {
			_, _ = w.Write(signedA)
		} else {
			_, _ = w.Write(signedB)
		}
	}))
	defer remote.Close()
	transport := http.DefaultTransport
	http.DefaultTransport = remote.Client().Transport
	defer func() { http.DefaultTransport = transport }()
	configA := appcatalog.Catalog{URL: remote.URL + "/a", PublicKey: base64.StdEncoding.EncodeToString(pubA)}
	configB := appcatalog.Catalog{URL: remote.URL + "/b", PublicKey: base64.StdEncoding.EncodeToString(pubB)}
	directoryPath := filepath.Join(t.TempDir(), "catalog.json")
	directory, err := appcatalog.Open(directoryPath, configA)
	if err != nil {
		t.Fatal(err)
	}
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := NewServer(Config{LaunchToken: "launch-token", AppCatalog: directory, Store: store})
	token, csrf := launchBrowserSession(t, server)
	call := func(method, path string, body any, want int, reviewed ...miniapps.Release) []byte {
		t.Helper()
		var raw []byte
		if exact, ok := body.(json.RawMessage); ok {
			raw = exact
		} else if body != nil {
			raw, err = json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
		}
		request := httptest.NewRequest(method, "http://127.0.0.1:47123/api/mini-apps"+path, bytes.NewReader(raw))
		request.Header.Set("Origin", "http://127.0.0.1:47123")
		request.Header.Set("X-Cove-Session-Token", token)
		request.Header.Set("X-Cove-CSRF-Token", csrf)
		request.Header.Set("Content-Type", "application/json")
		if len(reviewed) > 0 {
			request.Header.Set("X-Cove-Release-ID", reviewed[0].ID)
			request.Header.Set("X-Cove-Package-Digest", reviewed[0].Digest)
		}
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s %s: %d, want %d: %s", method, path, response.Code, want, response.Body.String())
		}
		return response.Body.Bytes()
	}
	install := func(version string, raw []byte) miniapps.Release {
		sum := sha256.Sum256(raw)
		result := call("POST", "/catalog/alice/notes/"+version+"/install", map[string]string{"digest": hex.EncodeToString(sum[:]), "catalog_authority": appcatalog.Authority(server.catalog.Config().PublicKey)}, 200)
		var release miniapps.Release
		if err := json.Unmarshal(result, &release); err != nil {
			t.Fatal(err)
		}
		return release
	}
	initial := install("1.0.0", old)
	if initial.CatalogAuthority != appcatalog.Authority(configA.PublicKey) || !initial.OfficialCatalog || initial.Origin != "catalog" {
		t.Fatal("official provenance was not bound", initial)
	}
	// A new process can attest an exact downloaded release from persisted,
	// verified history without contacting the catalog again.
	reopenedDirectory, err := appcatalog.Open(directoryPath, configA)
	if err != nil {
		t.Fatal(err)
	}
	server.catalog = reopenedDirectory
	requestsBeforePreview := networkCalls.Load()
	var downloaded miniapps.Release
	if err := json.Unmarshal(call("POST", "/packages/preview", json.RawMessage(next), 200), &downloaded); err != nil {
		t.Fatal(err)
	}
	if networkCalls.Load() != requestsBeforePreview || downloaded.CatalogAuthority != initial.CatalogAuthority || !downloaded.OfficialCatalog {
		t.Fatal("downloaded file lost cached signer provenance", downloaded)
	}
	var reviewedFile miniapps.Release
	if err := json.Unmarshal(call("POST", "/packages/preview", json.RawMessage(pending), 200), &reviewedFile); err != nil {
		t.Fatal(err)
	}
	call("POST", "/packages/install", json.RawMessage(pending), 409)
	call("POST", "/packages/install", json.RawMessage(append(append([]byte{}, pending...), '\n')), 409, reviewedFile)
	var book miniapps.Instance
	if err := json.Unmarshal(call("POST", "/instances", miniapps.CreateRequest{ReleaseID: initial.ID, Name: "My notes", Grants: initial.Package.Capabilities}, 200), &book); err != nil {
		t.Fatal(err)
	}
	// Legacy unbound exports remain recoverable through the ordinary restore
	// endpoint, but only as a separate disabled copy using exact trusted bytes.
	legacyStore, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer legacyStore.Close()
	legacyService := miniapps.New(legacyStore)
	legacy, err := legacyService.Install(t.Context(), old, "catalog")
	if err != nil {
		t.Fatal(err)
	}
	legacyBook, err := legacyService.Create(t.Context(), miniapps.CreateRequest{ReleaseID: legacy.ID, Name: "Legacy notes", Grants: legacy.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	legacySnapshot, err := legacyService.Export(t.Context(), legacyBook.ID)
	if err != nil {
		t.Fatal(err)
	}
	legacyBackup, err := json.Marshal(legacySnapshot)
	if err != nil {
		t.Fatal(err)
	}
	var restored miniapps.Instance
	if err := json.Unmarshal(call("POST", "/instances/restore", json.RawMessage(legacyBackup), 200), &restored); err != nil {
		t.Fatal(err)
	}
	if restored.ID == legacyBook.ID || restored.ReleaseID != initial.ID || restored.Enabled || len(restored.Grants) != 0 {
		t.Fatal("legacy restore did not create a disabled bound copy", restored)
	}
	before := call("GET", "/instances/"+book.ID+"/export", nil, 200)
	call("PUT", "/catalog-settings", map[string]any{"url": configB.URL, "public_key": configB.PublicKey}, 409)
	call("PUT", "/catalog-settings", map[string]any{"url": configB.URL, "public_key": configB.PublicKey, "confirm_trust": true, "previous": configA}, 200)
	// Both authorities offer identical bytes. A review from another window must
	// still fail after settings switch, rather than adopting the new signer.
	packagesBefore := call("GET", "/packages", nil, 200)
	call("POST", "/packages/install", json.RawMessage(pending), 409, reviewedFile)
	// The new directory no longer attests this other reviewed version at all.
	call("POST", "/packages/install", json.RawMessage(next), 409, downloaded)
	call("POST", "/catalog/alice/notes/1.0.0/install", map[string]string{"digest": initial.Digest, "catalog_authority": initial.CatalogAuthority}, 409)
	call("POST", "/catalog/alice/notes/1.0.0/install", map[string]string{"digest": initial.Digest}, 409)
	if after := call("GET", "/packages", nil, 200); !bytes.Equal(packagesBefore, after) {
		t.Fatal("rejected stale preview created a release")
	}
	var refreshedFile miniapps.Release
	if err := json.Unmarshal(call("POST", "/packages/preview", json.RawMessage(pending), 200), &refreshedFile); err != nil {
		t.Fatal(err)
	}
	if refreshedFile.ID == reviewedFile.ID || refreshedFile.CatalogAuthority != appcatalog.Authority(configB.PublicKey) {
		t.Fatal("file preview did not bind the replacement authority", refreshedFile)
	}
	call("POST", "/packages/install", json.RawMessage(pending), 200, refreshedFile)
	refreshed := install("1.0.0", old)
	if refreshed.ID == initial.ID || refreshed.CatalogAuthority != appcatalog.Authority(configB.PublicKey) {
		t.Fatal("fresh review did not bind the selected authority", refreshed)
	}
	foreign := install("1.1.0", other)
	if foreign.CatalogAuthority != appcatalog.Authority(configB.PublicKey) || foreign.OfficialCatalog {
		t.Fatal("custom provenance was relabeled official", foreign)
	}
	call("POST", "/instances/"+book.ID+"/upgrade", miniapps.UpgradeRequest{Revision: book.Revision, ReleaseID: foreign.ID, Grants: book.Grants}, 400)
	if after := call("GET", "/instances/"+book.ID+"/export", nil, 200); !bytes.Equal(before, after) {
		t.Fatal("rejected cross-signer upgrade changed saved data")
	}
	call("PUT", "/catalog-settings", map[string]any{"url": configA.URL, "public_key": configA.PublicKey, "confirm_trust": true, "previous": configB}, 200)
	successor := install("1.1.0", next)
	if successor.ID == foreign.ID {
		t.Fatal("separate signers shared a release identity")
	}
	var updated miniapps.Instance
	if err := json.Unmarshal(call("POST", "/instances/"+book.ID+"/upgrade", miniapps.UpgradeRequest{Revision: book.Revision, ReleaseID: successor.ID, Grants: book.Grants}, 200), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.ID != book.ID || updated.Revision != book.Revision+1 {
		t.Fatal("same-signer update did not retain the instance", updated)
	}
	persisted, err := server.apps.Release(t.Context(), successor.ID)
	if err != nil || persisted.CatalogAuthority != initial.CatalogAuthority || !persisted.OfficialCatalog {
		t.Fatal("release authority was not persisted", persisted, err)
	}
}
