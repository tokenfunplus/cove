package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/appcatalog"
	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/retrieval"
	"github.com/tokenfunplus/cove/services/local-service/internal/speech"
)

type testAppProcessing struct {
	*chat.Service
	scope   []string
	owners  map[string]string
	revoked string
}

func (s *testAppProcessing) SearchLocalDocuments(ctx context.Context, ids []string, query string, min ...float64) (retrieval.Results, error) {
	s.scope = ids
	return retrieval.Results{Hits: []retrieval.Hit{{Selection: retrieval.Selection{DocumentID: ids[0]}, Text: query}}}, nil
}
func (s *testAppProcessing) ReadMiniAppText(ctx context.Context, id, session, text string) (speech.JobStatus, error) {
	s.owners["fixture"] = chat.AppSpeechOwner(id, session)
	return speech.JobStatus{ID: "fixture", State: "completed"}, nil
}
func (s *testAppProcessing) SpeechAudio(owner, id string, index int) ([]byte, error) {
	if s.owners[id] != owner {
		return nil, speech.ErrNotFound
	}
	return []byte("wave fixture"), nil
}
func (s *testAppProcessing) RevokeAppSpeech(ctx context.Context, id string) error {
	s.revoked = id
	return nil
}

func TestMiniAppProcessingUsesCurrentGrantsAndSelectedScope(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	processing := &testAppProcessing{Service: chat.NewService(store, nil, nil), owners: map[string]string{}}
	server := NewServer(Config{Store: store, Chat: processing, LaunchToken: "launch-token"})
	token, csrf := launchBrowserSession(t, server)
	handler := server.Handler()
	request := func(method, path, body string, status int) string {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:47123"+path, strings.NewReader(body))
		req.Header.Set("Origin", "http://127.0.0.1:47123")
		req.Header.Set("X-Cove-Session-Token", token)
		req.Header.Set("X-Cove-CSRF-Token", csrf)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, res.Code, res.Body.String())
		}
		return res.Body.String()
	}
	all, err := (appcatalog.Catalog{}).List(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	var release miniapps.Release
	for _, e := range all {
		if e.App == "japanese-review-book" {
			release, err = server.apps.Install(t.Context(), e.Raw, e.Origin)
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	book := func() miniapps.Instance {
		i, err := server.apps.Create(t.Context(), miniapps.CreateRequest{Name: "Book", ReleaseID: release.ID, Grants: []string{"documents.search", "speech.speak"}})
		if err != nil {
			t.Fatal(err)
		}
		return i
	}
	a, b := book(), book()
	prefix := "/api/mini-apps/instances/"
	path := prefix + a.ID
	request("POST", path+"/documents/search", `{"document_ids":[],"query":"example"}`, 400)
	request("POST", path+"/documents/search", `{"document_ids":["selected"],"query":"example"}`, 200)
	if len(processing.scope) != 1 || processing.scope[0] != "selected" {
		t.Fatal(processing.scope)
	}
	request("POST", path+"/speech", `{"text":"Read this."}`, 200)
	if request("GET", path+"/speech/fixture/audio", "", 200) != "wave fixture" {
		t.Fatal("missing audio")
	}
	request("GET", prefix+b.ID+"/speech/fixture/audio", "", 404)
	settings, _ := json.Marshal(miniapps.ConfigRequest{Revision: a.Revision, Enabled: true, Grants: []string{}})
	request("POST", path+"/settings", string(settings), 200)
	if processing.revoked != a.ID {
		t.Fatal("speech was not stopped")
	}
	request("GET", path+"/speech/fixture/audio", "", 403)
	request("POST", path+"/documents/search", `{"document_ids":["x"],"query":"example"}`, 403)
}
