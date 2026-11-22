package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestProjectHTTPContextScopeAndSideConversation(t *testing.T) {
	ctx := context.Background()
	store, e := persistence.OpenSQLite(filepath.Join(t.TempDir(), "projects.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	service := chat.NewServiceWithSettings(store, nil, nil, store)
	server := NewServer(Config{LaunchToken: "launch-token", Chat: service})
	token, csrf := launchBrowserSession(t, server)
	call := func(method, path string, input any, authorized bool) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(input)
		r := httptest.NewRequest(method, "http://127.0.0.1:47123"+path, bytes.NewReader(data))
		r.Host = "127.0.0.1:47123"
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "http://127.0.0.1:47123")
		if authorized {
			r.Header.Set("X-Cove-Session-Token", token)
			r.Header.Set("X-Cove-CSRF-Token", csrf)
		}
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w
	}
	if w := call("GET", "/api/projects", nil, false); w.Code != 401 {
		t.Fatal("unauthorized project read accepted")
	}
	w := call("POST", "/api/projects", map[string]any{"name": "Fixture", "instructions": "Project rule", "background": "Reference only\n\"quoted\" \U0001f680"}, true)
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	var p persistence.Project
	if e = json.Unmarshal(w.Body.Bytes(), &p); e != nil {
		t.Fatal(e)
	}
	for _, path := range []string{"/api/projects", "/api/projects/" + p.ID} {
		if head := call("HEAD", path, map[string]any{"name": "Must not be saved"}, true); head.Code != 200 {
			t.Fatal("HEAD did not read", head.Code)
		}
	}
	projects, err := store.ListProjects(ctx)
	if err != nil || len(projects) != 1 || projects[0].Name != p.Name {
		t.Fatal("HEAD mutated projects", err)
	}
	w = call("POST", "/api/projects/"+p.ID+"/sources", map[string]any{"revision": p.Revision, "file": map[string]any{"name": "evidence.md", "data": []byte("Saved project source")}}, true)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &p) != nil {
		t.Fatal("fixed project source was not saved", w.Code, w.Body.String())
	}
	w = call("POST", "/api/conversations", map[string]any{"title": "Needle", "project_id": p.ID}, true)
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	var c persistence.Conversation
	json.Unmarshal(w.Body.Bytes(), &c)
	w = call("POST", "/api/conversations", map[string]any{"source_conversation_id": c.ID}, true)
	var side persistence.Conversation
	json.Unmarshal(w.Body.Bytes(), &side)
	if w.Code != 201 || side.ProjectID != p.ID {
		t.Fatal("side membership not inherited", w.Code, w.Body.String())
	}
	if w = call("POST", "/api/conversations", map[string]any{"source_conversation_id": c.ID, "project_id": p.ID}, true); w.Code != 400 {
		t.Fatal("conflicting membership accepted")
	}
	for i := 0; i < 55; i++ {
		if _, e := store.CreateConversation(ctx, "Needle"); e != nil {
			t.Fatal(e)
		}
	}
	w = call("GET", "/api/conversations/search?q=Needle&project_id="+p.ID, nil, true)
	var results []persistence.ConversationSearchResult
	json.Unmarshal(w.Body.Bytes(), &results)
	if w.Code != 200 || len(results) != 1 || results[0].ID != c.ID || results[0].ProjectID != p.ID {
		t.Fatal("project filtering occurred after result cap", w.Code, w.Body.String())
	}
	w = call("POST", "/api/conversations/"+c.ID+"/context-preview?format=project-v1", map[string]any{"body": "Question"}, true)
	var preview struct {
		Messages []map[string]any               `json:"messages"`
		Expected persistence.ProjectExpectation `json:"expected_project"`
		Usage    contextUsage                   `json:"usage"`
	}
	if e = json.Unmarshal(w.Body.Bytes(), &preview); e != nil || w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if preview.Usage.Background != utf8.RuneCountInString(p.Background) {
		t.Fatal("background usage includes JSON escaping")
	}
	if len(preview.Messages) != 2 || preview.Messages[1]["role"] != "user" || preview.Usage.Total != preview.Usage.Instructions+preview.Usage.Background+preview.Usage.Sources+preview.Usage.History+preview.Usage.Question {
		t.Fatal("preview roles or breakdown inconsistent")
	}
	for _, format := range []string{"", "?format=project-v1"} {
		w = call("POST", "/api/conversations/"+c.ID+"/context-preview"+format, map[string]any{"body": strings.Repeat("q", 240001)}, true)
		if format == "" && w.Code != 400 {
			t.Fatal("legacy preview accepted oversized context", w.Code)
		}
		if format != "" && w.Code != 200 {
			t.Fatal("project preview could not inspect oversized context", w.Code)
		}
	}
	batch, e := store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{ConversationID: c.ID, ClientRequestID: "batch", Body: "Question", ExpectedProject: &preview.Expected, Targets: []persistence.GenerationTargetInput{{ProviderID: "fixture", ModelID: "model", Snapshot: persistence.ProviderSnapshot{ProviderID: "fixture", ModelID: "model"}}}})
	if e != nil {
		t.Fatal(e)
	}
	w = call("GET", "/api/generation-batches/"+batch.ID+"/context?format=project-v1", nil, true)
	var envelope map[string]json.RawMessage
	json.Unmarshal(w.Body.Bytes(), &envelope)
	if w.Code != 200 || envelope["project_context"] == nil || envelope["history"] == nil {
		t.Fatal("project context envelope missing")
	}
	w = call("GET", "/api/generation-batches/"+batch.ID+"/context", nil, true)
	var legacy []any
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &legacy) != nil {
		t.Fatal("legacy context contract broken")
	}
	for _, dissolved := range []bool{false, true} {
		if dissolved {
			w = call("DELETE", "/api/projects/"+p.ID, map[string]any{"revision": p.Revision, "delete_conversations": false}, true)
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
		}
		w = call("GET", "/api/generation-batches/"+batch.ID+"/attachments/"+p.Sources[0].Snapshot.ID, nil, true)
		if w.Code != 200 || w.Body.String() != "Saved project source" {
			t.Fatal("historical project original download failed", dissolved, w.Code)
		}
	}
	w = call("POST", "/api/conversations/"+c.ID+"/messages", map[string]any{"body": "Question", "client_request_id": "injected", "project_id": p.ID}, true)
	if w.Code != 400 {
		t.Fatal("generation accepted a project membership command")
	}
}

func TestConversationResponseInternsRepeatedProjectPayloads(t *testing.T) {
	ctx := context.Background()
	store, e := persistence.OpenSQLite(filepath.Join(t.TempDir(), "intern.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	p, e := store.SaveProject(ctx, "", persistence.ProjectInput{Name: "Shared", Background: "Unique reference marker " + strings.Repeat("x", 10000)})
	if e != nil {
		t.Fatal(e)
	}
	c, e := store.CreateProjectConversation(ctx, "", p.ID, "")
	if e != nil {
		t.Fatal(e)
	}
	_, expected, e := store.PreviewProjectContext(ctx, c.ID)
	if e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 50; i++ {
		b, err := store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{ConversationID: c.ID, ClientRequestID: fmt.Sprintf("intern-%d", i), Body: "Question", ExpectedProject: &expected, Targets: []persistence.GenerationTargetInput{{ProviderID: "fixture", ModelID: "model", Snapshot: persistence.ProviderSnapshot{ProviderID: "fixture", ModelID: "model"}}}})
		if err != nil {
			t.Fatal(err)
		}
		if err = store.MarkGenerationStreaming(ctx, b.Targets[0].Generation.ID); err != nil {
			t.Fatal(err)
		}
		if err = store.CompleteGeneration(ctx, persistence.CompleteGenerationInput{GenerationID: b.Targets[0].Generation.ID, Body: "Answer"}); err != nil {
			t.Fatal(err)
		}
	}
	view, e := store.LoadConversation(ctx, c.ID)
	if e != nil {
		t.Fatal(e)
	}
	for _, b := range view.GenerationBatches {
		if b.ProjectContext != view.GenerationBatches[0].ProjectContext {
			t.Fatal("identical saved contexts decoded independently")
		}
	}
	wire := conversationViewEnvelopeFor(view)
	if len(wire.ProjectContexts) != 1 {
		t.Fatal("repeated payloads not interned")
	}
	for _, b := range wire.GenerationBatches {
		if b.ProjectContext != nil || wire.ProjectContexts[b.ProjectContextID] == nil {
			t.Fatal("batch did not reference shared saved context")
		}
	}
	raw, e := json.Marshal(wire)
	if e != nil {
		t.Fatal(e)
	}
	if strings.Count(string(raw), "Unique reference marker") != 2 {
		t.Fatal("conversation response repeats background beyond its saved text and rendered fragment")
	}
}

func TestProjectConflictDoesNotFabricateMetadataWhenConversationReadFails(t *testing.T) {
	fake := &fakeChat{startErr: persistence.ErrProjectChanged, readConversation: func(context.Context, string) (persistence.ConversationView, error) {
		return persistence.ConversationView{}, sql.ErrNoRows
	}}
	server := NewServer(Config{LaunchToken: "launch-token", Chat: fake})
	token, csrf := launchBrowserSession(t, server)
	r := httptest.NewRequest("POST", "http://127.0.0.1:47123/api/conversations/missing/messages", strings.NewReader(`{"client_request_id":"conflict","body":"Question"}`))
	r.Host = "127.0.0.1:47123"
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "http://127.0.0.1:47123")
	r.Header.Set("X-Cove-Session-Token", token)
	r.Header.Set("X-Cove-CSRF-Token", csrf)
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, r)
	if w.Code != 404 || strings.Contains(w.Body.String(), "project_revision") {
		t.Fatalf("failed refresh returned fabricated membership: %d %s", w.Code, w.Body.String())
	}
}

type scopedProjectChat struct {
	*chat.Service
	unscopedReads int
}

func (s *scopedProjectChat) ListConversations(context.Context, bool) ([]persistence.Conversation, error) {
	s.unscopedReads++
	return nil, fmt.Errorf("unscoped read must not run")
}
func TestScopedConversationListSkipsUnscopedRead(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "scope.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := &scopedProjectChat{Service: chat.NewService(store, nil, nil)}
	server := NewServer(Config{Chat: service})
	for _, query := range []string{"project_id=", "project_id=project"} {
		w := httptest.NewRecorder()
		server.listConversations(w, httptest.NewRequest("GET", "/api/conversations?"+query, nil))
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if service.unscopedReads != 0 {
		t.Fatal("scoped read loaded unscoped history")
	}
	w := httptest.NewRecorder()
	server.listConversations(w, httptest.NewRequest("GET", "/api/conversations", nil))
	if w.Code != 500 || service.unscopedReads != 1 {
		t.Fatal("unscoped path no longer reads ordinary history")
	}
}
