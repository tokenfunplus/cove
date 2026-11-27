package appcatalog

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
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
	if err := d.Configure(remote); err != nil {
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
		items, err := reopened.List(context.Background())
		if err == nil || len(items) != len(builtin) {
			t.Fatalf("%s: unexpected fallback (%d entries): %v", label, len(items), err)
		}
	}
	code = 503
	checkFallback("unavailable")
	code = 200
	body = "invalid"
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
	_ = json.Unmarshal(builtin[0].Raw, &conflict)
	conflict["name"] = "conflicting release"
	duplicate, _ := json.Marshal(conflict)
	index.Packages = [][]byte{newApp, duplicate}
	body = signed(index)
	checkFallback("reject every remote entry atomically")
}
