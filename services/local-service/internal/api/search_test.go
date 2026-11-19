package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestLocalSearchRequiresSessionAndReturnsOnlyMatchingExcerpt(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "search.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, _ := store.CreateConversation(context.Background(), "Planning")
	message, err := store.AddMessage(context.Background(), conversation.ID, persistence.MessageInput{Role: "user", Body: "SQLite migration checklist"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(Config{LaunchToken: "launch-token", Chat: historyFakeChat(store)})
	token, _ := launchBrowserSession(t, server)
	for _, scenario := range []struct {
		query      string
		authorized bool
		status     int
	}{
		{"q=SQLite", false, 401}, {"q=SQLite", true, 200},
		{"q=" + url.QueryEscape(strings.Repeat("x", 257)), true, 400},
		{"q=SQLite&archived=invalid", true, 400},
	} {
		request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/conversations/search?"+scenario.query, nil)
		if scenario.authorized {
			request.Header.Set("X-Cove-Session-Token", token)
		}
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != scenario.status {
			t.Fatalf("status %d, want %d", response.Code, scenario.status)
		}
		if scenario.status == 200 {
			var results []persistence.ConversationSearchResult
			if err := json.Unmarshal(response.Body.Bytes(), &results); err != nil {
				t.Fatal(err)
			}
			if len(results) != 1 || results[0].MessageID != message.ID {
				t.Fatal("message match was not returned")
			}
			if !strings.Contains(results[0].Excerpt, "SQLite migration checklist") {
				t.Fatalf("matching excerpt was not returned: %q", results[0].Excerpt)
			}
		}
	}
}

func TestHistorySearchFilterValidationAndStatusMetadata(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "filters.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	debate, err := store.CreateDebate(ctx, persistence.DebateSession{ClientRequestID: "filter-fixture", Topic: "Needle debate", Status: "paused", Round: 3})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.CreateConversation(ctx, "Needle chat"); err != nil {
		t.Fatal(err)
	}
	server := NewServer(Config{LaunchToken: "launch-token", Store: store})
	token, _ := launchBrowserSession(t, server)
	for _, scenario := range []struct {
		parameters    string
		status, count int
	}{
		{"q=Needle&kind=debate", 200, 1},
		{"q=Needle&kind=chat", 200, 1},
		{"q=Needle&kind=all", 200, 2},
		{"q=Needle&updated_after=" + url.QueryEscape(time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)), 200, 0},
		{"q=Needle&kind=invalid", 400, 0},
		{"q=Needle&updated_after=yesterday", 400, 0},
		{"q=Needle&updated_after=9999-01-01T00:00:00Z", 400, 0},
	} {
		request := httptest.NewRequest("GET", "http://127.0.0.1:47123/api/conversations/search?"+scenario.parameters, nil)
		request.Header.Set("X-Cove-Session-Token", token)
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, request)
		if recorder.Code != scenario.status {
			t.Fatal("unexpected filter response", scenario.parameters, recorder.Code)
		}
		if recorder.Code == 200 {
			var result []persistence.ConversationSearchResult
			if err = json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || len(result) != scenario.count {
				t.Fatal("unexpected filtered results", err)
			}
			if strings.Contains(scenario.parameters, "kind=debate") && (result[0].DebateID != debate.ID || result[0].DebateStatus != "paused" || result[0].DebateRound != 3) {
				t.Fatal("search lost debate metadata")
			}
		}
	}
}
