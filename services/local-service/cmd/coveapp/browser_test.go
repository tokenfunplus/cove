package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/api"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"github.com/tokenfunplus/cove/services/local-service/internal/webassets"
)

func TestAuthorBrowserPreviewRunsFixtureAndUpgradesPersonalPackage(t *testing.T) {
	if _, err := fs.Stat(webassets.Files(), "assets"); err != nil {
		t.Skip("build web assets for browser integration")
	}
	source, err := os.ReadFile(filepath.Join(packageDir, "japanese-review-book.coveapp"))
	if err != nil {
		t.Fatal(err)
	}
	source = bytes.Replace(source, []byte(`"cove"`), []byte(`"personal-study"`), 1)
	next, err := os.ReadFile(filepath.Join(packageDir, "japanese-review-book-1.1.coveapp"))
	if err != nil {
		t.Fatal(err)
	}
	next = bytes.Replace(next, []byte(`"cove"`), []byte(`"personal-study"`), 1)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	err = servePreview(ctx, source, browserFixture{ModelResponse: "Fixture answer."}, "", "", io.Discard, func(ctx context.Context, start string) error {
		u, err := url.Parse(start)
		if err != nil {
			return err
		}
		origin := u.Scheme + "://" + u.Host
		base := "/api/mini-apps/instances/" + u.Query().Get("instance")
		response, err := client.Get(start)
		if err != nil {
			return err
		}
		response.Body.Close()
		loc, err := url.Parse(response.Header.Get("Location"))
		if err != nil {
			return err
		}
		if response.StatusCode != 303 || !strings.HasPrefix(loc.Path, "/apps/"+u.Query().Get("instance")+"/") {
			return fmt.Errorf("wrong preview destination")
		}
		fragment, err := url.ParseQuery(loc.Fragment)
		if err != nil {
			return err
		}
		csrf := ""
		var reviewedRelease miniapps.Release
		call := func(method, path, body string, dst any) error {
			req, err := http.NewRequestWithContext(ctx, method, origin+path, strings.NewReader(body))
			if err != nil {
				return err
			}
			req.Header.Set("X-Cove-Session-Token", fragment.Get("cove-session"))
			req.Header.Set("Origin", origin)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Cove-CSRF-Token", csrf)
			if path == "/api/mini-apps/packages/install" {
				req.Header.Set("X-Cove-Release-ID", reviewedRelease.ID)
				req.Header.Set("X-Cove-Package-Digest", reviewedRelease.Digest)
			}
			r, err := client.Do(req)
			if err != nil {
				return err
			}
			defer r.Body.Close()
			if r.StatusCode != 200 {
				return fmt.Errorf("%s returned %d", path, r.StatusCode)
			}
			return json.NewDecoder(r.Body).Decode(dst)
		}
		var session struct {
			CSRF string `json:"csrf_token"`
		}
		if err := call("GET", "/api/session", "", &session); err != nil {
			return err
		}
		csrf = session.CSRF
		var profiles []provider.Profile
		if err := call("GET", "/api/models", "", &profiles); err != nil {
			return err
		}
		if len(profiles) != 1 || profiles[0].Name != "Simulated author model" {
			return fmt.Errorf("no fixture model profile")
		}
		id := uuid.NewString()
		input := map[string]any{"operationId": id, "surface": "page", "action": "review.suggestQuestions", "input": map[string]any{"passage": "A sample passage."}, "providerId": profiles[0].ID, "modelId": "fixture-model", "destination": profiles[0].Endpoint}
		post, err := json.Marshal(input)
		if err != nil {
			return err
		}
		var answer persistence.AppTask
		if err := call("POST", base+"/tasks", string(post), &answer); err != nil {
			return err
		}
		for answer.State == "running" {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Millisecond * 15):
			}
			if err := call("GET", base+"/tasks/"+id, "", &answer); err != nil {
				return err
			}
		}
		if answer.Result != "Fixture answer." {
			return fmt.Errorf("simulated model task failed (%s)", answer.State)
		}
		var previous struct{ Instance miniapps.Instance }
		if err := call("GET", base, "", &previous); err != nil {
			return err
		}
		var release miniapps.Release
		if err := call("POST", "/api/mini-apps/packages/preview", string(next), &reviewedRelease); err != nil {
			return err
		}
		if err := call("POST", "/api/mini-apps/packages/install", string(next), &release); err != nil {
			return err
		}
		if release.Origin != "local" {
			return fmt.Errorf("personal update was installed as %s", release.Origin)
		}
		change, err := json.Marshal(miniapps.UpgradeRequest{ReleaseID: release.ID, Revision: previous.Instance.Revision, Grants: previous.Instance.Grants})
		if err != nil {
			return err
		}
		var upgraded miniapps.Instance
		if err := call("POST", base+"/upgrade", string(change), &upgraded); err != nil {
			return err
		}
		if upgraded.ID != previous.Instance.ID || upgraded.ReleaseID != release.ID || upgraded.Revision != previous.Instance.Revision+1 {
			return fmt.Errorf("personal update did not upgrade the preview instance")
		}
		cancel()
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestPreviewEndpointIsExplicitlyLoopback(t *testing.T) {
	for _, raw := range []string{"https://example.com", "http://user@127.0.0.1", "http://127.0.0.1/private", "http://127.0.0.1/?x=abc"} {
		if _, err := newPreviewModel(raw, ""); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

func TestPreviewOnlyRoutesAppOwnedGenerations(t *testing.T) {
	host := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	preview := previewRoutes(host, "")
	for _, tc := range []struct {
		method, path string
		want         int
	}{
		{http.MethodPost, "/api/conversations/example/messages", http.StatusForbidden},
		{http.MethodPatch, "/api/settings", http.StatusForbidden},
		{http.MethodPost, "/api/mini-apps/instances/example/tasks", http.StatusNoContent},
		{http.MethodPut, "/api/mini-apps/catalog-settings", http.StatusForbidden},
	} {
		rec := httptest.NewRecorder()
		preview.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
		if rec.Code != tc.want {
			t.Fatalf("%s %s returned %d, want %d", tc.method, tc.path, rec.Code, tc.want)
		}
		if tc.want == http.StatusForbidden {
			var envelope api.ErrorEnvelope
			if err := json.NewDecoder(rec.Body).Decode(&envelope); err != nil || envelope.Error.Code != "author_preview_only" ||
				!strings.Contains(envelope.Error.Message, "Open the app in Cove") {
				t.Fatalf("%s did not explain how to send a full turn from Cove: %+v, %v", tc.path, envelope, err)
			}
		}
	}
}
