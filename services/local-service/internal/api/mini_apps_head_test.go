package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestMiniAppHeadCannotDispatchSharedMutationHandlers(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := NewServer(Config{Store: store, LaunchToken: "launch-token"})
	token, _ := launchBrowserSession(t, server)
	ctx := context.Background()
	raw, err := os.ReadFile("../appcatalog/packages/reading-inbox.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	first, err := server.apps.Install(ctx, raw, "builtin")
	if err != nil {
		t.Fatal(err)
	}
	book, err := server.apps.Create(ctx, miniapps.CreateRequest{ReleaseID: first.ID, Name: "Inbox", Grants: first.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	var next miniapps.Package
	if err := json.Unmarshal(raw, &next); err != nil {
		t.Fatal(err)
	}
	next.Version = "9.0.0"
	nextRaw, err := json.Marshal(next)
	if err != nil {
		t.Fatal(err)
	}
	second, err := server.apps.Install(ctx, nextRaw, "builtin")
	if err != nil {
		t.Fatal(err)
	}
	before, err := server.apps.Releases(ctx)
	if err != nil {
		t.Fatal(err)
	}
	upgrade, err := json.Marshal(miniapps.UpgradeRequest{Revision: book.Revision, ReleaseID: second.ID, Grants: book.Grants})
	if err != nil {
		t.Fatal(err)
	}
	for path, body := range map[string]string{
		"/api/mini-apps/packages":             string(raw),
		"/api/mini-apps/instances":            string(`{"release_id":"` + second.ID + `","name":"Unexpected"}`),
		"/api/mini-apps/instances/" + book.ID: string(upgrade),
	} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodHead, "http://127.0.0.1:47123"+path, strings.NewReader(body))
			req.Header.Set("X-Cove-Session-Token", token)
			// HEAD is considered safe by CSRF middleware. The route must not
			// invoke a handler's non-GET mutation branch without a CSRF token.
			w := httptest.NewRecorder()
			server.Handler().ServeHTTP(w, req)
			if w.Code != http.StatusMethodNotAllowed || w.Header().Get("Allow") != "GET" {
				t.Fatalf("HEAD status=%d allow=%q", w.Code, w.Header().Get("Allow"))
			}
		})
	}
	after, err := server.apps.Releases(ctx)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("HEAD changed packages: %v", err)
	}
	current, err := server.apps.Instance(ctx, book.ID)
	if err != nil || !reflect.DeepEqual(book, current) {
		t.Fatalf("HEAD changed instance: %v", err)
	}
	instances, err := server.apps.Instances(ctx)
	if err != nil || len(instances) != 1 {
		t.Fatalf("HEAD created an instance: %v", err)
	}
}
