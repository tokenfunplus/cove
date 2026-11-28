package appcatalog

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeLegacyIdentityPreferences(t *testing.T, p preferences) string {
	t.Helper()
	file := filepath.Join(t.TempDir(), "catalog.json")
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	return file
}

func TestLegacyKeyAliasesCannotResetTheHighestCheckpoint(t *testing.T) {
	public, key, _ := ed25519.GenerateKey(nil)
	canonical := base64.StdEncoding.EncodeToString(public)
	alias := canonical[:16] + "\n" + canonical[16:]
	config := Catalog{URL: "https://legacy.example/catalog.json", PublicKey: alias}
	file := writeLegacyIdentityPreferences(t, preferences{TrustPolicy: 2, Config: &config, Checkpoints: map[string]checkpoint{
		alias: {Sequence: 9, Digest: "trusted-nine"}, canonical: {Sequence: 7, Digest: "trusted-seven"},
	}})
	directory, err := Open(file, config)
	if err != nil {
		t.Fatal(err)
	}
	if directory.Config().PublicKey != canonical || directory.Settings().Defaults.PublicKey != canonical || len(directory.prefs.Checkpoints) != 1 || directory.prefs.Checkpoints[canonical].Sequence != 9 {
		t.Fatal("legacy aliases lost their highest checkpoint")
	}
	source := []byte(`{"publisher":"author","app":"notes","name":"Notes","version":"1.0.0","schema_version":1}`)
	prior := http.DefaultTransport
	defer func() { http.DefaultTransport = prior }()
	body := signedTestIndex(t, key, 8, source)
	http.DefaultTransport = catalogTransport(func(request *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: request}, nil
	})
	if _, err := directory.List(t.Context()); err == nil {
		t.Fatal("canonical key accepted sequence 8 after its alias accepted sequence 9")
	}
	directory.cachedUntil = time.Time{}
	body = signedTestIndex(t, key, 10, source)
	if _, err := directory.List(t.Context()); err != nil {
		t.Fatal("strictly newer signed index did not recover", err)
	}
	reopened, err := Open(file, Catalog{})
	if err != nil || len(reopened.prefs.Checkpoints) != 1 || reopened.prefs.Checkpoints[canonical].Sequence != 10 {
		t.Fatal("normalized checkpoint did not persist", err)
	}
}

func TestLegacyAliasConflictsRemainClosedAfterMerging(t *testing.T) {
	public, key, _ := ed25519.GenerateKey(nil)
	canonical := base64.StdEncoding.EncodeToString(public)
	alias := canonical[:16] + "\n" + canonical[16:]
	config := Catalog{URL: "https://legacy.example/catalog.json", PublicKey: alias}
	source := []byte(`{"publisher":"author","app":"notes","name":"Notes","version":"1.0.0","schema_version":1}`)
	other := []byte(strings.Replace(string(source), `"Notes"`, `"Other notes"`, 1))
	first, _ := entry(source, "catalog")
	second, _ := entry(other, "catalog")
	version := "author/notes/1.0.0"
	history := func(digest string) authorityHistory {
		return authorityHistory{Versions: map[string]string{version: digest}, Releases: map[string]bool{digest: true}, Publishers: map[string]bool{"author": true}}
	}
	file := writeLegacyIdentityPreferences(t, preferences{TrustPolicy: 2, Config: &config,
		Checkpoints: map[string]checkpoint{alias: {Sequence: 9, Digest: "first-nine"}, canonical: {Sequence: 9, Digest: "other-nine"}},
		Authorities: map[string]authorityHistory{alias: history(first.Digest), canonical: history(second.Digest)},
	})
	directory, err := Open(file, Catalog{})
	if err != nil {
		t.Fatal(err)
	}
	if directory.prefs.Checkpoints[canonical].Digest != "" || directory.prefs.Authorities[canonical].Versions[version] != "" || directory.KnownRelease(first.Digest) || directory.KnownRelease(second.Digest) {
		t.Fatal("merge arbitrarily attested a conflicted alias")
	}
	prior := http.DefaultTransport
	defer func() { http.DefaultTransport = prior }()
	successor := []byte(strings.Replace(string(source), `"1.0.0"`, `"2.0.0"`, 1))
	body := signedTestIndex(t, key, 9, successor)
	http.DefaultTransport = catalogTransport(func(request *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: request}, nil
	})
	if _, err := directory.List(t.Context()); err == nil {
		t.Fatal("same-sequence conflict was accepted")
	}
	directory.cachedUntil = time.Time{}
	body = signedTestIndex(t, key, 10, source)
	if _, err := directory.List(t.Context()); err == nil {
		t.Fatal("higher sequence blessed a conflicting immutable version")
	}
	directory.cachedUntil = time.Time{}
	body = signedTestIndex(t, key, 10, successor)
	if _, err := directory.List(t.Context()); err != nil {
		t.Fatal("new unambiguous release could not recover", err)
	}
	reloaded, _ := Open(file, Catalog{})
	if reloaded.prefs.Authorities[canonical].Versions[version] != "" || reloaded.KnownRelease(first.Digest) || reloaded.KnownRelease(second.Digest) {
		t.Fatal("saving normalized history revived a conflicted release")
	}
}
