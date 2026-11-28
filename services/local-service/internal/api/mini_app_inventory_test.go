package api

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestSessionDoesNotReportEmptyMiniAppInventoryOnStorageFailure(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(Config{Store: store, LaunchToken: "launch-token"})
	token, _ := launchBrowserSession(t, server)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "http://127.0.0.1:47123/api/session", nil)
	req.Header.Set("X-Cove-Session-Token", token)
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)
	var response map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	proof, ok := response["csrf_token"].(string)
	if w.Code != 200 || !ok || proof == "" {
		t.Fatalf("session unavailable: %d", w.Code)
	}
	if _, exists := response["has_mini_apps"]; exists {
		t.Fatal("failed inventory was reported as authoritative presence")
	}
}
