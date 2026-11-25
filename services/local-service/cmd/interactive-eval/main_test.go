package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
)

func TestDefaultOutputDirectoryIsPrivateAndUnique(t *testing.T) {
	t.Setenv("TMPDIR", t.TempDir())
	victim := filepath.Join(t.TempDir(), "retained.txt")
	if err := os.WriteFile(victim, []byte("untouched"), 0600); err != nil {
		t.Fatal(err)
	}
	fixed := filepath.Join(os.TempDir(), "cove-interactive-evaluation")
	if err := os.Mkdir(fixed, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(victim, filepath.Join(fixed, "results.json")); err != nil {
		t.Fatal(err)
	}
	a, err := evaluationOutputDirectory("")
	if err != nil {
		t.Fatal(err)
	}
	b, err := evaluationOutputDirectory("")
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(a)
	if err != nil || a == b || a == fixed || info.Mode().Perm() != 0700 {
		t.Fatal("default output not private and unique", err)
	}
	if err = os.WriteFile(filepath.Join(a, "results.json"), []byte("synthetic"), 0600); err != nil {
		t.Fatal(err)
	}
	content, _ := os.ReadFile(victim)
	if string(content) != "untouched" {
		t.Fatal("default output followed an existing link")
	}
	explicit := filepath.Join(t.TempDir(), "chosen")
	if got, err := evaluationOutputDirectory(explicit); err != nil || got != explicit {
		t.Fatal("explicit output behavior changed", err)
	}
}

func TestCredentialedEvaluationRequiresHTTPSAndNeverFollowsRedirects(t *testing.T) {
	for _, endpoint := range []string{"http://127.0.0.1/model", "http://provider.example/model", "https://user:secret@provider.example/model"} {
		if _, err := validateEvaluationEndpoint(endpoint, "fixture-only"); err == nil {
			t.Fatal("insecure credential endpoint accepted")
		}
	}
	if _, err := validateEvaluationEndpoint("http://127.0.0.1:11434/api/chat", ""); err != nil {
		t.Fatal("unauthenticated local evaluation rejected", err)
	}
	var received atomic.Bool
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { received.Store(true); w.WriteHeader(200) }))
	defer destination.Close()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-only" {
			t.Error("configured provider did not receive test credential")
		}
		if r.URL.Path == "/ok" {
			w.WriteHeader(200)
			return
		}
		http.Redirect(w, r, destination.URL, http.StatusFound)
	}))
	defer server.Close()
	endpoint, err := validateEvaluationEndpoint(server.URL, "fixture-only")
	if err != nil {
		t.Fatal(err)
	}
	client := evaluationClient()
	client.Transport = server.Client().Transport
	for _, path := range []string{"/redirect", "/ok"} {
		req, _ := http.NewRequest(http.MethodPost, endpoint+path, nil)
		req.Header.Set("Authorization", "Bearer fixture-only")
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		want := 200
		if path == "/redirect" {
			want = http.StatusFound
		}
		if response.StatusCode != want {
			t.Fatal("unexpected response", response.StatusCode)
		}
	}
	if received.Load() {
		t.Fatal("credentialed request followed cross-origin HTTP redirect")
	}
	for _, target := range []string{"https://child.provider.example/model", "http://provider.example/model", "https://provider.example/other"} {
		req, _ := http.NewRequest(http.MethodGet, target, nil)
		if client.CheckRedirect(req, nil) != http.ErrUseLastResponse {
			t.Fatal("redirect policy allowed credential forwarding")
		}
	}
}

func TestEvaluationInputRejectsOversizeWithoutTruncatingAnswers(t *testing.T) {
	card := "```cove-ui\n" + `{"cove_ui":1,"title":"Recall","continue":false,"children":[{"type":"Text","content":"A word"}]}` + "\n```"
	body := strings.Repeat("Prose ", 8000) + "\n" + card
	raw, err := readEvaluationInput("extract", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = interactive.Extract(string(raw)); err != nil {
		t.Fatal("full answer was truncated before extraction", err)
	}
	for _, mode := range []string{"extract", "normalize"} {
		limit := 32768
		if mode == "extract" {
			limit = 1 << 20
		}
		if _, err := readEvaluationInput(mode, io.MultiReader(strings.NewReader(card), strings.NewReader(strings.Repeat(" ", limit)))); err == nil {
			t.Fatal("oversized input was silently truncated")
		}
	}
}
