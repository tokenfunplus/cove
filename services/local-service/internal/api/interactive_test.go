package api

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestInteractiveRoutesRequireSessionAndCSRFAndSaveWithRevision(t *testing.T) {
	ctx := context.Background()
	store, e := persistence.OpenSQLite(filepath.Join(t.TempDir(), "card.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	c, e := store.CreateConversation(ctx, "Card")
	if e != nil {
		t.Fatal(e)
	}
	batch, e := store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{Interactive: true, ConversationID: c.ID, ClientRequestID: "card", Body: "Story", Targets: []persistence.GenerationTargetInput{{ProviderID: "fixture", ModelID: "fixture", Snapshot: persistence.ProviderSnapshot{ProviderID: "fixture", ModelID: "fixture"}}}})
	if e != nil {
		t.Fatal(e)
	}
	raw, e := os.ReadFile("../../../../packages/api-contract/fixtures/interactive-cards.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixtures struct{ Valid []struct{ Source string } }
	json.Unmarshal(raw, &fixtures)
	id := batch.Targets[0].Generation.ID
	if e = store.CompleteGeneration(ctx, persistence.CompleteGenerationInput{GenerationID: id, Body: "```cove-card-v1\n" + fixtures.Valid[0].Source + "\n```"}); e != nil {
		t.Fatal(e)
	}
	server := NewServer(Config{LaunchToken: "launch-token", Chat: chat.NewServiceWithSettings(store, nil, nil, store)})
	token, csrf := launchBrowserSession(t, server)
	call := func(method string, input any, auth, proof bool) *httptest.ResponseRecorder {
		b, _ := json.Marshal(input)
		r := httptest.NewRequest(method, "http://127.0.0.1:47123/api/generations/"+id+"/interactive-card", bytes.NewReader(b))
		r.Header.Set("Origin", "http://127.0.0.1:47123")
		r.Header.Set("Content-Type", "application/json")
		if auth {
			r.Header.Set("X-Cove-Session-Token", token)
		}
		if proof {
			r.Header.Set("X-Cove-CSRF-Token", csrf)
		}
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w
	}
	if w := call("POST", nil, false, false); w.Code < 400 {
		t.Fatal("anonymous materialization allowed")
	}
	if w := call("POST", nil, true, false); w.Code < 400 {
		t.Fatal("materialization without CSRF allowed")
	}
	if w := call("POST", nil, true, true); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	input := interactive.Submission{GenerationID: id, Values: map[string]any{"next_action": "radio"}, Checks: map[string]string{}}
	if w := call("PATCH", input, true, true); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := call("PATCH", input, true, true); w.Code != 409 {
		t.Fatal("stale revision not rejected", w.Code)
	}
	input.Revision = 1
	input.Values["next_action"] = "invented"
	if w := call("PATCH", input, true, true); w.Code != 400 {
		t.Fatal("invalid choice accepted", w.Code)
	}
}
