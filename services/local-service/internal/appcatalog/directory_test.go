package appcatalog

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type catalogTransport func(*http.Request) (*http.Response, error)

func (f catalogTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestDirectoryFallbackAndPersistentTrust(t *testing.T) {
	public, key, _ := ed25519.GenerateKey(nil)
	prefs := filepath.Join(t.TempDir(), "settings.json")
	remote := Catalog{URL: "https://catalog.example/index.json", PublicKey: base64.StdEncoding.EncodeToString(public)}
	d, _ := Open(prefs, Catalog{})
	if err := d.ReplaceTrust(remote, Catalog{}); err != nil {
		t.Fatal(err)
	}
	builtin, _ := (Catalog{}).List(t.Context())
	newApp := []byte(`{"publisher":"fixture","app":"notes","name":"Notes","version":"1.0.0","schema_version":1}`)
	now := time.Now().UTC()
	index := SignedIndex{Format: 2, Sequence: 8, IssuedAt: now, ExpiresAt: now.Add(time.Hour), Packages: [][]byte{newApp}}
	signed := func(idx SignedIndex) string {
		raw, _ := json.Marshal(idx)
		envelope, _ := json.Marshal(map[string][]byte{"payload": raw, "signature": ed25519.Sign(key, raw)})
		return string(envelope)
	}
	body := signed(index)
	code := 200
	orig := http.DefaultTransport
	defer func() { http.DefaultTransport = orig }()
	http.DefaultTransport = catalogTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != remote.URL {
			t.Fatal("unexpected catalog destination")
		}
		return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: r}, nil
	})
	all, err := d.List(t.Context())
	if err != nil || len(all) != len(builtin)+1 || !d.KnownPublisher("fixture") {
		t.Fatal("signed index was not persisted", err)
	}
	reopened, err := Open(prefs, Catalog{})
	if err != nil || reopened.Config() != remote {
		t.Fatal("Finder restart lost preferences", err)
	}
	checkFallback := func(label string) {
		t.Helper()
		reopened.cachedUntil = time.Time{}
		items, err := reopened.List(context.Background())
		if err == nil || len(items) != len(builtin) {
			t.Fatalf("%s: unexpected fallback (%d entries): %v", label, len(items), err)
		}
	}
	code = 503
	checkFallback("unavailable")
	code = 200
	var invalidSignature struct{ Payload, Signature []byte }
	if err := json.Unmarshal([]byte(signed(index)), &invalidSignature); err != nil {
		t.Fatal(err)
	}
	invalidSignature.Signature[0] ^= 1
	invalidEnvelope, err := json.Marshal(invalidSignature)
	if err != nil {
		t.Fatal(err)
	}
	body = string(invalidEnvelope)
	checkFallback("invalid signature")
	index.Sequence--
	body = signed(index)
	checkFallback("rollback after restart")
	index.Sequence += 2
	index.ExpiresAt = now.Add(-time.Second)
	body = signed(index)
	checkFallback("expired")
	index.ExpiresAt = now.Add(time.Hour)
	// A higher sequence may publish a new version or withdraw an old one.
	// Reusing a version with different bytes must also fail after a restart.
	index.Packages = [][]byte{[]byte(strings.Replace(string(newApp), "Notes", "Changed notes", 1))}
	body = signed(index)
	checkFallback("replaced version in a newer signed index")
	var conflict map[string]any
	legacy, err := os.ReadFile("testdata/legacy-releases/japanese-review-book.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(legacy, &conflict)
	conflict["name"] = "conflicting release"
	duplicate, _ := json.Marshal(conflict)
	index.Packages = [][]byte{newApp, duplicate}
	body = signed(index)
	checkFallback("reject every remote entry atomically")
}

func signedTestIndex(t *testing.T, key ed25519.PrivateKey, sequence int64, packages ...[]byte) string {
	t.Helper()
	now := time.Now().UTC()
	raw, err := json.Marshal(SignedIndex{Format: 2, Sequence: sequence, IssuedAt: now, ExpiresAt: now.Add(time.Hour), Packages: packages})
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := json.Marshal(map[string][]byte{"payload": raw, "signature": ed25519.Sign(key, raw)})
	if err != nil {
		t.Fatal(err)
	}
	return string(envelope)
}

func TestConfirmedAuthorityChangesRetainEachKeysRollbackCheckpoint(t *testing.T) {
	pubA, keyA, _ := ed25519.GenerateKey(nil)
	pubB, keyB, _ := ed25519.GenerateKey(nil)
	first := Catalog{URL: "https://first.example/catalog.json", PublicKey: base64.StdEncoding.EncodeToString(pubA)}
	second := Catalog{URL: "https://second.example/catalog.json", PublicKey: base64.StdEncoding.EncodeToString(pubB)}
	source := []byte(`{"publisher":"author","app":"notes","name":"Notes","version":"1.0.0","schema_version":1}`)
	bodies := map[string]string{first.URL: signedTestIndex(t, keyA, 9, source), second.URL: signedTestIndex(t, keyB, 1, source)}
	previous := http.DefaultTransport
	defer func() { http.DefaultTransport = previous }()
	http.DefaultTransport = catalogTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(bodies[r.URL.String()])), Header: make(http.Header), Request: r}, nil
	})
	path := filepath.Join(t.TempDir(), "catalog.json")
	directory, _ := Open(path, Catalog{})
	if err := directory.Configure(first); !errors.Is(err, ErrTrustConfirmation) {
		t.Fatal("initial unconfirmed authority", err)
	}
	if err := directory.ReplaceTrust(first, Catalog{}); err != nil {
		t.Fatal(err)
	}
	if _, err := directory.List(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := directory.Configure(second); !errors.Is(err, ErrTrustConfirmation) {
		t.Fatal("silently changed authority", err)
	}
	if err := directory.ReplaceTrust(second, Catalog{}); !errors.Is(err, ErrCatalogChanged) {
		t.Fatal("accepted stale confirmation", err)
	}
	if err := directory.ReplaceTrust(second, first); err != nil {
		t.Fatal(err)
	}
	if _, err := directory.List(t.Context()); err != nil {
		t.Fatal(err)
	}
	directory, _ = Open(path, Catalog{})
	if directory.Config() != second {
		t.Fatal("lost confirmed key on restart")
	}
	if err := directory.ReplaceTrust(first, second); err != nil {
		t.Fatal(err)
	}
	bodies[first.URL] = signedTestIndex(t, keyA, 8, source)
	if _, err := directory.List(t.Context()); err == nil {
		t.Fatal("lost first key rollback checkpoint")
	}
	if err := directory.ReplaceTrust(Catalog{}, first); err != nil {
		t.Fatal(err)
	}
	if directory.Config() != (Catalog{}) || len(directory.prefs.Checkpoints) != 2 {
		t.Fatal("clearing settings discarded key history")
	}
}

func TestCustomCatalogCannotPublishBundledIdentities(t *testing.T) {
	officialPublic, officialKey, _ := ed25519.GenerateKey(nil)
	customPublic, customKey, _ := ed25519.GenerateKey(nil)
	official := Catalog{URL: "https://official.example/catalog.json", PublicKey: base64.StdEncoding.EncodeToString(officialPublic)}
	custom := Catalog{URL: "https://custom.example/catalog.json", PublicKey: base64.StdEncoding.EncodeToString(customPublic)}
	builtin, _ := (Catalog{}).List(t.Context())
	previous := http.DefaultTransport
	defer func() { http.DefaultTransport = previous }()
	var body string
	http.DefaultTransport = catalogTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: r}, nil
	})
	for _, publisher := range []string{"cove", "bookshelf"} {
		t.Run(publisher, func(t *testing.T) {
			raw := []byte(`{"publisher":"` + publisher + `","app":"future","name":"Future","version":"9.9.9","schema_version":1}`)
			sum := sha256.Sum256(raw)
			digest := hex.EncodeToString(sum[:])
			directory, _ := Open("", official)
			if err := directory.ReplaceTrust(custom, official); err != nil {
				t.Fatal(err)
			}
			body = signedTestIndex(t, customKey, 1, raw)
			entries, err := directory.List(t.Context())
			if err == nil || len(entries) != len(builtin) || directory.KnownRelease(digest) {
				t.Fatal("custom key claimed a bundled publisher", err)
			}
			if err := directory.ReplaceTrust(official, custom); err != nil {
				t.Fatal(err)
			}
			body = signedTestIndex(t, officialKey, 1, raw)
			entries, err = directory.List(t.Context())
			if err != nil || len(entries) != len(builtin)+1 || !directory.KnownRelease(digest) {
				t.Fatal("official authority was rejected", err)
			}
		})
	}
}

func TestOldTrustCacheIsReverifiedAndFailedSavesDoNotChangeAuthority(t *testing.T) {
	public, _, _ := ed25519.GenerateKey(nil)
	initial := Catalog{URL: "https://old.example/catalog.json", PublicKey: base64.StdEncoding.EncodeToString(public)}
	path := filepath.Join(t.TempDir(), "catalog.json")
	old := preferences{Config: &initial, ReleaseDigests: map[string]bool{"old-unattributed-digest": true}, Checkpoints: map[string]checkpoint{initial.PublicKey: {Sequence: 9, Digest: "index"}}}
	raw, _ := json.Marshal(old)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	directory, _ := Open(path, Catalog{})
	if directory.KnownRelease("old-unattributed-digest") || directory.Config() != initial || len(directory.prefs.Checkpoints) != 1 {
		t.Fatal("old preferences lost settings or retained unchecked trust")
	}
	directory.path = filepath.Join(t.TempDir(), "missing", "settings.json")
	if err := directory.ReplaceTrust(Catalog{}, initial); err == nil {
		t.Fatal("save to nonexistent directory succeeded")
	}
	if directory.Config() != initial || len(directory.prefs.Checkpoints) != 1 {
		t.Fatal("failed save changed in-memory authority")
	}
	if err := os.WriteFile(path, []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	broken, _ := Open(path, Catalog{})
	if _, err := broken.List(t.Context()); err == nil {
		t.Fatal("corrupt preferences did not report fallback")
	}
	if err := broken.ReplaceTrust(initial, Catalog{}); err == nil {
		t.Fatal("corrupt preference history was silently discarded")
	}
}

func TestDirectoryCachesVerifiedResultsAndBriefBundledFailures(t *testing.T) {
	public, key, _ := ed25519.GenerateKey(nil)
	config := Catalog{URL: "https://cache.example/catalog.json", PublicKey: base64.StdEncoding.EncodeToString(public)}
	source := []byte(`{"publisher":"author","app":"notes","name":"Notes","version":"1.0.0","schema_version":1}`)
	previous := http.DefaultTransport
	defer func() { http.DefaultTransport = previous }()
	calls := 0
	code := 200
	body := signedTestIndex(t, key, 1, source)
	http.DefaultTransport = catalogTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: r}, nil
	})
	directory, _ := Open("", Catalog{})
	if err := directory.ReplaceTrust(config, Catalog{}); err != nil {
		t.Fatal(err)
	}
	first, err := directory.List(t.Context())
	if err != nil || calls != 1 {
		t.Fatal(err, calls)
	}
	remoteIndex := -1
	for n, item := range first {
		if item.Publisher == "author" {
			remoteIndex = n
		}
	}
	if remoteIndex == -1 || !bytes.Equal(first[remoteIndex].Raw, source) {
		t.Fatal("verified result omitted the remote package")
	}
	first[remoteIndex].Raw[0] ^= 1
	second, err := directory.List(t.Context())
	if err != nil || calls != 1 {
		t.Fatal("verified cache missed", err, calls)
	}
	if !bytes.Equal(second[remoteIndex].Raw, source) {
		t.Fatal("mutating a returned package changed the verified cache")
	}
	cancelled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := directory.List(cancelled); !errors.Is(err, context.Canceled) || calls != 1 {
		t.Fatal("cancelled request reused or populated cache", err)
	}
	code = 503
	directory.cachedUntil = time.Now().Add(-time.Second)
	if _, err := directory.List(t.Context()); err == nil || calls != 2 {
		t.Fatal("expired cache survived a network failure", err, calls)
	}
	fallback, fallbackErr := directory.List(t.Context())
	if fallbackErr == nil || calls != 2 {
		t.Fatal("brief failure cache missed", fallbackErr, calls)
	}
	for _, entry := range fallback {
		if entry.Origin != "builtin" || entry.CatalogAuthority != "" || entry.OfficialCatalog {
			t.Fatal("failure cache attested a remote release", entry)
		}
	}
	if directory.cachedUntil.After(time.Now().Add(5 * time.Second)) {
		t.Fatal("failure cache is not brief")
	}
	if _, err := directory.List(cancelled); !errors.Is(err, context.Canceled) || calls != 2 {
		t.Fatal("failure cache hid cancellation", err, calls)
	}
	directory.cachedUntil = time.Time{}
	code = 200
	now := time.Now().UTC()
	raw, _ := json.Marshal(SignedIndex{Format: 2, Sequence: 2, IssuedAt: now, ExpiresAt: now.Add(5 * time.Second), Packages: [][]byte{source}})
	envelope, _ := json.Marshal(map[string][]byte{"payload": raw, "signature": ed25519.Sign(key, raw)})
	body = string(envelope)
	if _, err := directory.List(t.Context()); err != nil {
		t.Fatal(err)
	}
	if directory.cachedUntil.After(now.Add(5 * time.Second)) {
		t.Fatal("cache outlives signed index expiry")
	}
	changed := config
	changed.URL = "https://moved.example/catalog.json"
	if err := directory.Configure(changed); err != nil {
		t.Fatal(err)
	}
	if !directory.cachedUntil.IsZero() {
		t.Fatal("URL change retained cached releases")
	}
	if _, err := directory.List(t.Context()); err != nil || calls != 4 {
		t.Fatal("new URL reused a previous cache", err, calls)
	}
}
