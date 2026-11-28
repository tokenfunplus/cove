package api

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

type appCancellationRecorder struct {
	*chat.Service
	stopped []string
}

func (m *appCancellationRecorder) StopAppTask(instance, id string) {
	m.stopped = append(m.stopped, id)
}

func TestGenerationTaskEndpointsExcludeProposals(t *testing.T) {
	ctx := t.Context()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	model := &appCancellationRecorder{Service: chat.NewService(store, nil, nil)}
	s := NewServer(Config{Store: store, Chat: model, LaunchToken: "launch-token"})
	token, proof := launchBrowserSession(t, s)
	raw, err := os.ReadFile("../appcatalog/testdata/legacy-releases/japanese-review-book.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	release, err := s.apps.Install(ctx, raw, "builtin")
	if err != nil {
		t.Fatal(err)
	}
	book, err := s.apps.Create(ctx, miniapps.CreateRequest{ReleaseID: release.ID, Name: "Book", Grants: []string{"ai.generate", "records.commit"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.BeginAppTask(ctx, book.ID, "generate", "generation", fmt.Sprintf(`{"Release":%q,"Target":{"action":"generate"}}`, release.ID)); err != nil {
		t.Fatal(err)
	}
	proposal := fmt.Sprintf(`{"ProposalRevision":%d,"Release":%q,"Target":{"surface":"chat"}}`, book.Revision, release.ID)
	for i := range 31 {
		if err := store.BeginAppTask(ctx, book.ID, fmt.Sprintf("proposal-%d", i), "proposal", proposal); err != nil {
			t.Fatal(err)
		}
	}
	handler := s.Handler()
	call := func(method, suffix string, status int) []byte {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:47123/api/mini-apps/instances/"+book.ID+suffix, nil)
		req.Header.Set("Origin", "http://127.0.0.1:47123")
		req.Header.Set("X-Cove-Session-Token", token)
		req.Header.Set("X-Cove-CSRF-Token", proof)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != status {
			t.Fatalf("%s %s: %d, want %d: %s", method, suffix, w.Code, status, w.Body.String())
		}
		return w.Body.Bytes()
	}
	call("GET", "/proposals/proposal-0", 200)
	_, err = s.apps.Configure(ctx, book.ID, miniapps.ConfigRequest{Enabled: true, Revision: book.Revision, Grants: []string{"ai.generate"}})
	if err != nil {
		t.Fatal(err)
	}
	call("GET", "/proposals/proposal-0", 404)
	call("GET", "/tasks/proposal-0", 404)
	call("DELETE", "/tasks/proposal-0", 404)
	var history struct{ Tasks []persistence.AppTask }
	if err := json.Unmarshal(call("GET", "/tasks", 200), &history); err != nil {
		t.Fatal(err)
	}
	if len(history.Tasks) != 1 || history.Tasks[0].ID != "generate" || history.Tasks[0].ReleaseID != release.ID || history.Tasks[0].Action != "generate" {
		t.Fatalf("unexpected generation history: %+v", history.Tasks)
	}
	var detail persistence.AppTask
	if err := json.Unmarshal(call("GET", "/tasks/generate", 200), &detail); err != nil || detail.ReleaseID != release.ID || detail.Action != history.Tasks[0].Action {
		t.Fatalf("generation detail lost its release or action: %+v, %v", detail, err)
	}
	call("DELETE", "/tasks/generate", 200)
	if len(model.stopped) != 1 || model.stopped[0] != "generate" {
		t.Fatalf("unexpected cancellation: %v", model.stopped)
	}
}
