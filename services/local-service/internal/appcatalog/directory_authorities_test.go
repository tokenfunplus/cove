package appcatalog

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFollowingDefaultsSurvivesUpdatesWithoutOverridingCustomOrBundledChoices(t *testing.T) {
	first := Catalog{URL: "https://official.example/catalog.json", PublicKey: "first"}
	next := Catalog{URL: "https://official.example/catalog.json", PublicKey: "next"}
	custom := Catalog{URL: "https://custom.example/catalog.json", PublicKey: "custom"}
	// Real public keys keep this test on the same validation path as settings.
	for _, config := range []*Catalog{&first, &next, &custom} {
		pub, _, _ := ed25519.GenerateKey(nil)
		config.PublicKey = base64.StdEncoding.EncodeToString(pub)
	}
	path := filepath.Join(t.TempDir(), "catalog.json")
	d, _ := Open(path, first)
	if err := d.Configure(first); err != nil {
		t.Fatal(err)
	}
	d, _ = Open(path, next)
	if d.Config() != next || d.Settings().Mode != "default" {
		t.Fatal("saving defaults pinned the old release authority")
	}
	if err := d.ReplaceTrust(custom, next); err != nil {
		t.Fatal(err)
	}
	d, _ = Open(path, first)
	if d.Config() != custom || d.Settings().Mode != "custom" {
		t.Fatal("Cove update replaced a custom selection")
	}
	if err := d.ReplaceTrust(Catalog{}, custom); err != nil {
		t.Fatal(err)
	}
	d, _ = Open(path, next)
	if d.Config() != (Catalog{}) || d.Settings().Mode != "bundled" {
		t.Fatal("Cove update replaced bundled-only choice")
	}
	if err := d.UseDefaults(nil); !errors.Is(err, ErrTrustConfirmation) {
		t.Fatal("restored a different authority without confirmation", err)
	}
	empty := Catalog{}
	if err := d.UseDefaults(&empty); err != nil {
		t.Fatal(err)
	}
	if d.Config() != next || d.Settings().Defaults != next || d.Settings().Mode != "default" {
		t.Fatal("defaults could not be restored")
	}
	d, _ = Open(path, first)
	if d.Config() != first {
		t.Fatal("restored default mode did not follow next Cove version")
	}
}

func TestDirectoryVersionHistoriesAreScopedToTheirSigningAuthority(t *testing.T) {
	pubA, keyA, _ := ed25519.GenerateKey(nil)
	pubB, keyB, _ := ed25519.GenerateKey(nil)
	a := Catalog{URL: "https://first.example/catalog.json", PublicKey: base64.StdEncoding.EncodeToString(pubA)}
	b := Catalog{URL: "https://second.example/catalog.json", PublicKey: base64.StdEncoding.EncodeToString(pubB)}
	original := []byte(`{"publisher":"author","app":"notes","name":"First notes","version":"1.0.0","schema_version":1}`)
	other := []byte(strings.Replace(string(original), "First notes", "Second notes", 1))
	unique := []byte(`{"publisher":"second-author","app":"other","name":"Other","version":"1.0.0","schema_version":1}`)
	bodies := map[string]string{a.URL: signedTestIndex(t, keyA, 9, original), b.URL: signedTestIndex(t, keyB, 2, other, unique)}
	prior := http.DefaultTransport
	defer func() { http.DefaultTransport = prior }()
	http.DefaultTransport = catalogTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(bodies[r.URL.String()])), Header: make(http.Header), Request: r}, nil
	})
	path := filepath.Join(t.TempDir(), "catalog.json")
	d, _ := Open(path, Catalog{})
	if err := d.ReplaceTrust(a, Catalog{}); err != nil {
		t.Fatal(err)
	}
	if _, err := d.List(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := d.ReplaceTrust(b, a); err != nil {
		t.Fatal(err)
	}
	if _, err := d.List(t.Context()); err != nil {
		t.Fatal("another signer inherited the first signer's version collision", err)
	}
	if !d.KnownPublisher("second-author") {
		t.Fatal("active publisher was not recorded")
	}
	d, _ = Open(path, Catalog{})
	if err := d.ReplaceTrust(a, b); err != nil {
		t.Fatal(err)
	}
	if d.KnownPublisher("second-author") {
		t.Fatal("publisher trust leaked across signing authorities")
	}
	if _, err := d.List(t.Context()); err != nil {
		t.Fatal(err)
	}
	d.cachedUntil = d.cachedUntil.Add(-100000000000)
	bodies[a.URL] = signedTestIndex(t, keyA, 10, other)
	if _, err := d.List(t.Context()); err == nil {
		t.Fatal("same signer was allowed to rewrite a published version")
	}
	bodies[a.URL] = signedTestIndex(t, keyA, 8, original)
	if _, err := d.List(t.Context()); err == nil {
		t.Fatal("switching signers erased rollback protection")
	}
}

func TestUnattributedLegacyVersionHistoryCannotPoisonANewAuthority(t *testing.T) {
	pubA, _, _ := ed25519.GenerateKey(nil)
	pubB, keyB, _ := ed25519.GenerateKey(nil)
	keyA := base64.StdEncoding.EncodeToString(pubA)
	config := Catalog{URL: "https://second.example/catalog.json", PublicKey: base64.StdEncoding.EncodeToString(pubB)}
	old := preferences{TrustPolicy: 1, Config: &config, Versions: map[string]string{"author/notes/1.0.0": "digest-from-another-signer"}, Publishers: map[string]bool{"old-author": true}, Checkpoints: map[string]checkpoint{keyA: {Sequence: 3}, config.PublicKey: {Sequence: 4}}}
	path := filepath.Join(t.TempDir(), "catalog.json")
	raw, _ := json.Marshal(old)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	body := signedTestIndex(t, keyB, 5, []byte(`{"publisher":"author","app":"notes","name":"Notes","version":"1.0.0","schema_version":1}`))
	prior := http.DefaultTransport
	defer func() { http.DefaultTransport = prior }()
	http.DefaultTransport = catalogTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: r}, nil
	})
	d, _ := Open(path, Catalog{})
	if _, err := d.List(t.Context()); err != nil {
		t.Fatal("legacy mixed-signer history blocked a valid directory", err)
	}
	if len(d.prefs.Checkpoints) != 2 || d.KnownPublisher("old-author") {
		t.Fatal("migration lost checkpoints or retained ambiguous publisher authority")
	}
}

func TestLegacyHistoryUsesItsSoleHistoricalSignerAfterSettingsChanged(t *testing.T) {
	pubA, _, _ := ed25519.GenerateKey(nil)
	pubB, _, _ := ed25519.GenerateKey(nil)
	a := base64.StdEncoding.EncodeToString(pubA)
	b := base64.StdEncoding.EncodeToString(pubB)
	for _, ambiguous := range []bool{false, true} {
		name := "sole-signer"
		if ambiguous {
			name = "ambiguous-signers"
		}
		t.Run(name, func(t *testing.T) {
			current := Catalog{URL: "https://new.example/catalog.json", PublicKey: b}
			previous := preferences{Config: &current, Versions: map[string]string{"author/notes/1.0.0": "original-digest"}, Publishers: map[string]bool{"author": true}, ReleaseDigests: map[string]bool{"original-digest": true}, Checkpoints: map[string]checkpoint{a: {Sequence: 7, Digest: "old-index"}}}
			if ambiguous {
				previous.Checkpoints[b] = checkpoint{Sequence: 1, Digest: "other-index"}
			}
			raw, err := json.Marshal(previous)
			if err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(t.TempDir(), "catalog.json")
			if err := os.WriteFile(file, raw, 0600); err != nil {
				t.Fatal(err)
			}
			directory, err := Open(file, Catalog{})
			if err != nil {
				t.Fatal(err)
			}
			retained := directory.prefs.Authorities[a].Versions["author/notes/1.0.0"] == "original-digest"
			if retained == ambiguous {
				t.Fatal("historical signer attribution incorrect", retained, ambiguous)
			}
			if directory.Config() != current || len(directory.prefs.Checkpoints) != len(previous.Checkpoints) || directory.KnownRelease("original-digest") {
				t.Fatal("migration changed preferences or accepted an unverified release")
			}
			if directory.prefs.Authorities[b].Versions["author/notes/1.0.0"] != "" {
				t.Fatal("legacy version transferred to newly selected signer")
			}
		})
	}
}
