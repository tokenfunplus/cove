package appcatalog

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func TestCatalogSummariesIncludeDescriptionsWithoutExposingPackageContents(t *testing.T) {
	public, key, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	const description = "Collect passages and choose what to read next."
	remotePackage := []byte(`{"publisher":"independent","app":"reading","name":"Reading","description":"` + description + `","version":"1.0.0","schema_version":1,"collections":{"items":{"seed":[{"text":"Synthetic seed record"}]}}}`)
	index := signedTestIndex(t, key, 1, remotePackage)
	calls := 0
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	http.DefaultTransport = catalogTransport(func(request *http.Request) (*http.Response, error) {
		calls++
		if request.URL.String() != "https://catalog.example/catalog.json" {
			t.Fatalf("unexpected metadata request: %s", request.URL)
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(index)), Header: make(http.Header), Request: request}, nil
	})

	catalog := Catalog{URL: "https://catalog.example/catalog.json", PublicKey: base64.StdEncoding.EncodeToString(public)}
	entries, err := catalog.List(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	foundRemote := false
	for _, item := range entries {
		var manifest struct{ Description string }
		if err := json.Unmarshal(item.Raw, &manifest); err != nil {
			t.Fatal(err)
		}
		if manifest.Description == "" || item.Description != manifest.Description {
			t.Fatalf("missing description for %s/%s: %q", item.Publisher, item.App, item.Description)
		}
		if item.Publisher == "independent" && item.Description == description {
			foundRemote = true
		}
		summary, err := json.Marshal(item)
		if err != nil {
			t.Fatal(err)
		}
		var exposed map[string]json.RawMessage
		if err := json.Unmarshal(summary, &exposed); err != nil {
			t.Fatal(err)
		}
		if exposed["description"] == nil || exposed["collections"] != nil || exposed["actions"] != nil || exposed["raw"] != nil {
			t.Fatal("catalog summaries lost descriptions or exposed package internals")
		}
	}
	if !foundRemote || calls != 1 || len(entries) != 1 {
		t.Fatalf("metadata coverage: remote=%t requests=%d", foundRemote, calls)
	}
}

func TestSignedCatalogRejectsChangedPackage(t *testing.T) {
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("testdata/legacy-releases/japanese-review-book.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]any{"format": 2, "sequence": 1, "issued_at": time.Now(), "expires_at": time.Now().Add(time.Hour), "packages": [][]byte{raw}})
	envelope := map[string][]byte{"payload": payload, "signature": ed25519.Sign(private, payload)}
	bytes, _ := json.Marshal(envelope)
	if packages, err := verify(bytes, public); err != nil || len(packages.Packages) != 1 {
		t.Fatal(err)
	}
	envelope["payload"] = append(payload, ' ')
	bytes, _ = json.Marshal(envelope)
	if _, err := verify(bytes, public); err == nil {
		t.Fatal("modified index accepted")
	}
}

func TestCatalogRejectsAlternateEncodingOfTheSameAuthority(t *testing.T) {
	public, _, _ := ed25519.GenerateKey(nil)
	key := base64.StdEncoding.EncodeToString(public)
	canonical := Catalog{URL: "https://catalog.example/index.json", PublicKey: key}
	if err := canonical.Validate(); err != nil {
		t.Fatal(err)
	}
	alternate := canonical
	alternate.PublicKey = key[:16] + "\n" + key[16:]
	if err := alternate.Validate(); err == nil {
		t.Fatal("alternate text encoding could create a second rollback checkpoint for one key")
	}
}
