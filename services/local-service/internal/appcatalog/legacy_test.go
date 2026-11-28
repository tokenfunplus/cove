package appcatalog

import (
	"crypto/ed25519"
	"encoding/base64"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestLegacyMetadataDoesNotDistributeApplicationPackages(t *testing.T) {
	entries, err := (Catalog{}).List(t.Context())
	if err != nil || len(entries) != 0 {
		t.Fatal("host still distributes business apps", err, len(entries))
	}
	for _, name := range []string{"japanese-review-book.coveapp", "japanese-review-book-1.1.coveapp", "japanese-review-book-1.2.coveapp", "reading-inbox.coveapp", "reading-inbox-1.1.coveapp"} {
		raw, err := os.ReadFile("testdata/legacy-releases/" + name)
		if err != nil {
			t.Fatal(err)
		}
		e, err := entry(raw, "builtin")
		if err != nil || !IsLegacyRelease(e.Publisher, e.App, e.Version, e.Digest) || !ReservedPublisher(e.Publisher) {
			t.Fatal("legacy identity was lost", name, err)
		}
		changed, _ := entry(append(raw, '\n'), "builtin")
		if IsBundledDigest(changed.Digest) || IsLegacyRelease(e.Publisher, e.App, "99.0.0", e.Digest) {
			t.Fatal("legacy metadata attested unpublished bytes")
		}
	}
}

func TestOfficialAppCanPublishANewVersionWithoutHostPackageChanges(t *testing.T) {
	public, key, _ := ed25519.GenerateKey(nil)
	config := Catalog{URL: "https://official.example/apps/catalog.json", PublicKey: base64.StdEncoding.EncodeToString(public)}
	raw, err := os.ReadFile("testdata/legacy-releases/japanese-review-book-1.2.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	next := []byte(strings.Replace(string(raw), `"version": "1.2.0"`, `"version": "1.3.0"`, 1))
	body := signedTestIndex(t, key, 1, raw, next)
	prior := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = prior })
	http.DefaultTransport = catalogTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: r}, nil
	})
	directory, err := Open("", config)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := directory.List(t.Context())
	if err != nil || len(entries) != 2 {
		t.Fatal("new independent release was rejected", err)
	}
	for _, e := range entries {
		if !e.OfficialCatalog || e.CatalogAuthority != Authority(config.PublicKey) || e.Origin != "catalog" {
			t.Fatal("release lost its signing authority")
		}
	}
	conflict := []byte(strings.Replace(string(raw), `"Japanese Review Book"`, `"Changed old release"`, 1))
	body = signedTestIndex(t, key, 2, next, conflict)
	entries, err = config.List(t.Context())
	if err == nil || len(entries) != 0 {
		t.Fatal("removing old package bytes allowed a historical release to be replaced")
	}
}
