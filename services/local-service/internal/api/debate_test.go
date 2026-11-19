package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestDebateRoutesRequireSessionAndCSRFAndExposeSavedMetadata(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "api.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := NewServer(Config{LaunchToken: "launch-token", Store: store})
	token, csrf := launchBrowserSession(t, server)
	for _, command := range []string{"claim", "progress", "settle"} {
		path := "/api/debates/fixture/turns/turn-one/browser/" + command
		request := httptest.NewRequest("POST", "http://127.0.0.1:47123"+path, strings.NewReader(`{}`))
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, request)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatal("browser turn accepted without a session", recorder.Code)
		}
		request = httptest.NewRequest("POST", "http://127.0.0.1:47123"+path, strings.NewReader(`{}`))
		request.Header.Set("X-Cove-Session-Token", token)
		recorder = httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, request)
		if recorder.Code != http.StatusForbidden {
			t.Fatal("browser turn accepted without origin/CSRF", recorder.Code)
		}
	}
	for _, route := range []struct{ method, path, body string }{{"POST", "/api/debates", `{}`}, {"POST", "/api/debates/fixture/control", `{"action":"stop"}`}, {"PATCH", "/api/debates/fixture/rules", `{}`}, {"PATCH", "/api/debates/fixture/controls", `{}`}, {"POST", "/api/debates/fixture/interventions", `{}`}, {"GET", "/api/debates/fixture", ""}, {"GET", "/api/debates/fixture/events", ""}} {
		request := httptest.NewRequest(route.method, "http://127.0.0.1:47123"+route.path, strings.NewReader(route.body))
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, request)
		if recorder.Code < 400 {
			t.Fatalf("unauthorized %s succeeded", route.path)
		}
		if route.method != "GET" {
			request = httptest.NewRequest(route.method, "http://127.0.0.1:47123"+route.path, strings.NewReader(route.body))
			request.Header.Set("X-Cove-Session-Token", token)
			recorder = httptest.NewRecorder()
			server.Handler().ServeHTTP(recorder, request)
			if recorder.Code != http.StatusForbidden {
				t.Fatalf("mutation without CSRF = %d", recorder.Code)
			}
		}
	}
	request := httptest.NewRequest("POST", "http://127.0.0.1:47123/api/debates", strings.NewReader(`{"client_request_id":"bad","topic":"Missing model seats"}`))
	request.Header.Set("X-Cove-Session-Token", token)
	request.Header.Set("X-Cove-CSRF-Token", csrf)
	request.Header.Set("Origin", "http://127.0.0.1:47123")
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest || responseErrorCode(t, recorder) != "validation" {
		t.Fatalf("invalid setup = %d %s", recorder.Code, recorder.Body.String())
	}
	session, err := store.CreateDebate(context.Background(), persistence.DebateSession{ClientRequestID: "saved", Topic: "Saved topic", Status: "paused", Round: 1})
	if err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest("GET", "http://127.0.0.1:47123/api/conversations/"+session.ID, nil)
	request.Header.Set("X-Cove-Session-Token", token)
	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	var view map[string]any
	if err = json.Unmarshal(recorder.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if view["debate_id"] != session.ID {
		t.Fatal("conversation did not identify its debate", recorder.Body.String())
	}
	request = httptest.NewRequest("GET", "http://127.0.0.1:47123/api/debates/"+session.ID+"?before=-1", nil)
	request.Header.Set("X-Cove-Session-Token", token)
	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatal("invalid pagination cursor was accepted")
	}
}

func TestDebateControlsRouteValidatesVersionAndBudgetRates(t *testing.T) {
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "controls.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	session, err := store.CreateDebate(context.Background(), persistence.DebateSession{ClientRequestID: "controls", Topic: "Synthetic settings", Status: "paused", Round: 1, Seats: []persistence.DebateSeat{{ProviderID: "fixture", ModelID: "one", Role: "Advocate"}, {ProviderID: "fixture", ModelID: "two", Role: "Challenger"}}})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(Config{LaunchToken: "launch-token", Store: store})
	token, csrf := launchBrowserSession(t, server)
	patch := func(body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest("PATCH", "http://127.0.0.1:47123/api/debates/"+session.ID+"/controls", strings.NewReader(body))
		request.Header.Set("X-Cove-Session-Token", token)
		request.Header.Set("X-Cove-CSRF-Token", csrf)
		request.Header.Set("Origin", "http://127.0.0.1:47123")
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		return response
	}
	response := patch(`{"version":0,"summary_every":3,"summary_seat":0,"auto_pause":true,"token_budget":100,"turn_delay_ms":5000}`)
	if response.Code != http.StatusOK {
		t.Fatalf("valid controls failed: %d %s", response.Code, response.Body.String())
	}
	var saved persistence.DebateSession
	if err := json.Unmarshal(response.Body.Bytes(), &saved); err != nil || saved.Controls.Version != 1 || *saved.Controls.TokenBudget != 100 {
		t.Fatal("controls were not saved", err)
	}
	if response = patch(`{"version":0,"summary_every":0,"summary_seat":0,"auto_pause":false}`); response.Code != http.StatusConflict {
		t.Fatal("stale version changed the budget", response.Code)
	}
	if response = patch(`{"version":1,"summary_every":0,"summary_seat":0,"auto_pause":true,"cost_budget_usd":1}`); response.Code != http.StatusBadRequest || responseErrorCode(t, response) != "debate_controls" {
		t.Fatal("cost budget accepted unknown rates", response.Code)
	}
}
