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
		}
	}
}
