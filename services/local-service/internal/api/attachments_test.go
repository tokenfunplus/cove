package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestAttachmentEndpointsRequireSessionAndPreviewRequiresCSRF(t *testing.T) {
	server := NewServer(Config{LaunchToken: "launch-token", Chat: &fakeChat{}})
	cookie, csrf := launchBrowserSession(t, server)
	data, err := json.Marshal(documents.Input{Name: "notes.md", Data: []byte("Synthetic source")})
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct {
		cookie bool
		csrf   bool
		status int
	}{{false, false, 401}, {true, false, 403}, {true, true, 200}} {
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/attachments/preview", bytes.NewReader(data))
		request.Host = "127.0.0.1:47123"
		request.Header.Set("Origin", "http://127.0.0.1:47123")
		request.Header.Set("Content-Type", "application/json")
		if scenario.cookie {
			request.AddCookie(cookie)
		}
		if scenario.csrf {
			request.Header.Set("X-Cove-CSRF-Token", csrf)
		}
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != scenario.status {
			t.Fatalf("preview status = %d, expected %d", response.Code, scenario.status)
		}
		if response.Code == 200 {
			var snapshot documents.Snapshot
			if err := json.Unmarshal(response.Body.Bytes(), &snapshot); err != nil || len(snapshot.Sections) != 1 {
				t.Fatal("missing preview text")
			}
			if strings.Contains(response.Body.String(), `"data"`) {
				t.Fatal("preview returned original binary data")
			}
		}
	}
	for _, route := range []string{"/api/generation-batches/batch/attachments/source", "/api/conversations/chat/context-preview"} {
		method := http.MethodGet
		if strings.Contains(route, "context-preview") {
			method = http.MethodPost
		}
		request := httptest.NewRequest(method, "http://127.0.0.1:47123"+route, strings.NewReader(`{"body":"Preview"}`))
		request.Header.Set("Origin", "http://127.0.0.1:47123")
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != 401 && response.Code != 403 {
			t.Fatalf("unprotected attachment route: %d", response.Code)
		}
	}
}

func TestOriginalDownloadIsLocalAttachmentAndDisappearsWithHistory(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "download.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	source, err := documents.Parse(ctx, documents.Input{Name: "notes.md", Data: []byte("Synthetic original")})
	if err != nil {
		t.Fatal(err)
	}
	batch, err := store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{ConversationID: conversation.ID, ClientRequestID: "source", Body: "Read", InputContent: documents.Prompt("Read", []documents.Prepared{source}), Attachments: []documents.Prepared{source}, Targets: []persistence.GenerationTargetInput{{ProviderID: "test", ModelID: "test", Snapshot: persistence.ProviderSnapshot{ProviderID: "test", ModelID: "test"}}}})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(Config{LaunchToken: "launch-token", Chat: historyFakeChat(store)})
	cookie, _ := launchBrowserSession(t, server)
	route := "http://127.0.0.1:47123/api/generation-batches/" + batch.ID + "/attachments/" + source.ID
	for _, deleted := range []bool{false, true} {
		if deleted {
			if err := store.DeleteConversation(ctx, conversation.ID); err != nil {
				t.Fatal(err)
			}
		}
		request := httptest.NewRequest(http.MethodGet, route, nil)
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if deleted {
			if response.Code != 404 {
				t.Fatal("deleted source is still downloadable")
			}
			continue
		}
		if response.Code != 200 || response.Body.String() != "Synthetic original" || !strings.HasPrefix(response.Header().Get("Content-Disposition"), "attachment;") || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("original download did not preserve bytes and attachment headers")
		}
	}
}
