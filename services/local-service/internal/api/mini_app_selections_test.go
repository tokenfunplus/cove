package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestStagedSelectionsRequireCurrentRevisionAndEligibleDestination(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := NewServer(Config{Store: store, LaunchToken: "launch-token", ControlToken: "launcher-control"})
	token, proof := launchBrowserSession(t, server)
	raw, err := os.ReadFile("../appcatalog/packages/japanese-review-book-1.1.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	release, err := server.apps.Install(t.Context(), raw, "builtin")
	if err != nil {
		t.Fatal(err)
	}
	book, err := server.apps.Create(t.Context(), miniapps.CreateRequest{ReleaseID: release.ID, Name: "Book", Grants: release.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Handler()
	call := func(method, path, body string, want int) string {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:47123"+path, strings.NewReader(body))
		if strings.HasPrefix(path, "/internal/control/") {
			req.Header.Set("X-Cove-Control-Token", "launcher-control")
		} else {
			req.Header.Set("Origin", "http://127.0.0.1:47123")
			req.Header.Set("X-Cove-Session-Token", token)
			req.Header.Set("X-Cove-CSRF-Token", proof)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: %d, want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w.Body.String()
	}
	var targets []selectionTarget
	if err := json.Unmarshal([]byte(call("POST", "/internal/control/mini-app-selection/targets", "{}", 200)), &targets); err != nil || len(targets) == 0 {
		t.Fatal(targets, err)
	}
	target := targets[0]
	stage := func() string {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"target": target, "text": "Frozen selected passage"})
		var result map[string]string
		if err := json.Unmarshal([]byte(call("POST", "/internal/control/mini-app-selection/stage", string(body), 200)), &result); err != nil {
			t.Fatal(err)
		}
		return result["id"]
	}
	prefix := "/api/mini-apps/instances/" + book.ID + "/native-selection"
	beforeGet, beforeConsume := stage(), stage()
	call("GET", prefix+"?selection="+beforeConsume, "", 200)
	book, err = server.apps.Configure(t.Context(), book.ID, miniapps.ConfigRequest{Revision: book.Revision, Enabled: true, Grants: book.Grants})
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range []string{call("GET", prefix+"?selection="+beforeGet, "", 409), call("POST", prefix, `{"id":"`+beforeConsume+`"}`, 409)} {
		if strings.Contains(result, "Frozen selected passage") {
			t.Fatal("stale response exposed selected text")
		}
	}
	target.Revision = book.Revision
	valid := stage()
	call("GET", prefix+"?selection="+valid, "", 200)
	if !strings.Contains(call("POST", prefix, `{"id":"`+valid+`"}`, 200), "Frozen selected passage") {
		t.Fatal("unchanged destination lost its text")
	}
	for _, change := range []func(*selectionTarget){func(target *selectionTarget) { target.Field = "missing" }, func(target *selectionTarget) { target.Action = "missing" }, func(target *selectionTarget) { target.View = "missing" }} {
		invalid := target
		change(&invalid)
		server.files.selections["invalid"] = stagedSelection{target: invalid, id: "invalid", text: "Do not expose", expires: time.Now().Add(time.Minute)}
		call("GET", prefix+"?selection=invalid", "", 409)
	}
}
