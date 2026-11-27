package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/appcatalog"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestMiniAppInstallationNativeImportAndChatSnapshot(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := NewServer(Config{Store: store, LaunchToken: "launch-token", ControlToken: "launcher-control"})
	token, csrf := launchBrowserSession(t, server)
	handler := server.Handler()
	call := func(method, path string, body any, authorized bool, want int, out any) {
		t.Helper()
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method, "http://127.0.0.1:47123"+path, strings.NewReader(string(raw)))
		if authorized {
			r.Header.Set("Origin", "http://127.0.0.1:47123")
			r.Header.Set("X-Cove-Session-Token", token)
			r.Header.Set("X-Cove-CSRF-Token", csrf)
			if strings.HasPrefix(path, "/internal") {
				r.Header.Set("X-Cove-Control-Token", "launcher-control")
			}
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s = %d, want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		if out != nil {
			if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
				t.Fatal(err)
			}
		}
	}
	const base = "/api/mini-apps"
	var catalog struct{ Packages []appcatalog.Entry }
	call("GET", base+"/catalog", nil, false, 401, nil)
	call("GET", base+"/catalog", nil, true, 200, &catalog)
	var item appcatalog.Entry
	for _, e := range catalog.Packages {
		if e.App == "japanese-review-book" {
			item = e
		}
	}
	path := base + "/catalog/" + item.Publisher + "/" + item.App + "/" + item.Version + "/install"
	call("POST", path, map[string]string{"digest": "changed"}, true, 409, nil)
	var release miniapps.Release
	call("POST", path, map[string]string{"digest": item.Digest}, true, 200, &release)
	var instance miniapps.Instance
	call("POST", base+"/instances", miniapps.CreateRequest{ReleaseID: release.ID, Name: "Book", Grants: release.Package.Capabilities}, true, 200, &instance)
	prefix := base + "/instances/" + instance.ID
	var file struct{ ID, URL string }
	call("POST", prefix+"/files", nil, true, 200, &file)
	private := "/internal/control/mini-app-files/" + file.ID
	call("POST", private+"/claim", nil, false, 401, nil)
	call("POST", private+"/claim", nil, true, 200, nil)
	call("POST", private+"/claim", nil, true, 409, nil)
	call("POST", private+"/finish", pickedText{State: "completed", Name: "notes.txt", Text: "example passage"}, true, 200, nil)
	var content pickedText
	call("GET", prefix+"/files/"+file.ID, nil, true, 200, &content)
	if content.Text != "example passage" {
		t.Fatal("missing scoped file result")
	}
	var rows miniapps.Result
	call("POST", prefix+"/actions/review.listDue", miniapps.Invocation{OperationID: uuid.NewString(), Surface: "chat", Inputs: map[string]any{}}, true, 200, &rows)
	if len(rows.Records) == 0 {
		t.Fatal("missing seeded due records")
	}
	row := rows.Records[0]
	request := miniapps.AttachmentRequest{Action: "review.listDue", Surface: "chat", Inputs: map[string]any{}, Records: []miniapps.RecordRef{{ID: row.ID, Revision: row.Revision}}}
	var snapshot miniapps.Attachment
	call("POST", prefix+"/attach", request, true, 200, &snapshot)
	if len(snapshot.Records) != 1 || snapshot.Records[0].ID != row.ID || snapshot.ReleaseID != release.ID {
		t.Fatal("unexpected selected snapshot")
	}
	call("POST", prefix+"/settings", miniapps.ConfigRequest{Revision: instance.Revision, Enabled: true, Grants: []string{"records.query"}}, true, 200, nil)
	call("POST", prefix+"/attach", request, true, 403, nil)
	call("GET", prefix+"/files/"+file.ID, nil, true, 403, nil)
	if n, err := store.ListConversations(context.Background()); err != nil || len(n) > 0 {
		t.Fatal("app operation affected chat history", err)
	}
}

func TestMiniAppLaunchTargetIsLocal(t *testing.T) {
	id := uuid.NewString()
	for raw, want := range map[string]string{
		"instance=" + id + "&view=home":           "/apps/" + id + "/home",
		"publisher=cove&app=review&version=1.0.0": "/apps/install/cove/review?version=1.0.0",
		"instance=" + id + "&view=..%2Fescape":    "/apps",
		"publisher=https%3A%2F%2Foutside&app=bad": "/apps",
	} {
		r := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/launch?"+raw, nil)
		if got := appDestination(r); got != want {
			t.Fatalf("got %q want %q", got, want)
		}
	}
}
