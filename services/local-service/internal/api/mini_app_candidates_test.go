package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestCandidateChecksUseAuthenticatedInstanceRecords(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := miniapps.New(store)
	raw, err := os.ReadFile("../appcatalog/testdata/legacy-releases/japanese-review-book-1.1.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	release, err := service.Install(t.Context(), raw, "builtin")
	if err != nil {
		t.Fatal(err)
	}
	instance, err := service.Create(t.Context(), miniapps.CreateRequest{ReleaseID: release.ID, Name: "Candidate fixture", Grants: release.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(Config{Store: store, LaunchToken: "launch-token"})
	token, csrf := launchBrowserSession(t, server)
	req := miniapps.CandidateCheckRequest{ExpectedRevision: instance.Revision, Action: "review.suggestQuestions", Surface: "page", Items: []map[string]any{{"question": "New card", "answer": "New answer"}, {"question": "Missing answer"}, {"question": "New card", "answer": "New answer"}}}
	encoded, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/mini-apps/instances/" + instance.ID + "/candidates/check"
	for _, authorized := range []bool{false, true} {
		request := httptest.NewRequest("POST", "http://127.0.0.1:47123"+path, strings.NewReader(string(encoded)))
		if authorized {
			request.Header.Set("Origin", "http://127.0.0.1:47123")
			request.Header.Set("X-Cove-Session-Token", token)
			request.Header.Set("X-Cove-CSRF-Token", csrf)
		}
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if !authorized {
			if response.Code != 401 {
				t.Fatal(response.Code)
			}
			continue
		}
		if response.Code != 200 {
			t.Fatal(response.Code, response.Body.String())
		}
		var result struct {
			Duplicates []int                     `json:"duplicates"`
			Invalid    []miniapps.CandidateIssue `json:"invalid"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Duplicates) != 1 || result.Duplicates[0] != 2 || len(result.Invalid) != 1 || result.Invalid[0].Index != 1 {
			t.Fatal(result)
		}
	}
}
