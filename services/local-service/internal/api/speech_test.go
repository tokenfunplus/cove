package api

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/speech"
)

type speechAPIChat struct {
	chat.Chat
	owner string
	calls int
}

func (s *speechAPIChat) SpeechSettings(context.Context) (chat.SpeechConfiguration, error) {
	return chat.SpeechConfiguration{Settings: speech.DefaultSettings(), Models: []chat.SpeechModel{}}, nil
}
func (s *speechAPIChat) SaveSpeechSettings(ctx context.Context, v persistence.SpeechSettings) (chat.SpeechConfiguration, error) {
	s.calls++
	return s.SpeechSettings(ctx)
}
func (s *speechAPIChat) ReadAloud(ctx context.Context, owner string, input chat.SpeechInput) (speech.JobStatus, error) {
	return speech.JobStatus{}, &speech.ModelRequiredError{Language: "en"}
}
func (s *speechAPIChat) PreviewSpeech(ctx context.Context, owner string, input chat.SpeechPreview) (speech.JobStatus, error) {
	s.calls++
	s.owner = owner
	return speech.JobStatus{ID: "job", State: "completed"}, nil
}
func (s *speechAPIChat) SpeechStatus(owner, id string) (speech.JobStatus, error) {
	return speech.JobStatus{ID: id, State: "completed"}, nil
}
func (s *speechAPIChat) SpeechAudio(owner, id string, index int) ([]byte, error) {
	if owner != s.owner {
		return nil, speech.ErrNotFound
	}
	return []byte("RIFFfixture"), nil
}
func (s *speechAPIChat) StopSpeech(ctx context.Context, owner, id string) error {
	if owner != s.owner {
		return speech.ErrNotFound
	}
	return nil
}

func TestSpeechAPIEnforcesSessionCSRFAndAudioOwnership(t *testing.T) {
	service := &speechAPIChat{}
	server := NewServer(Config{LaunchToken: "launch-token", Chat: service})
	token, csrf := launchBrowserSession(t, server)
	call := func(method, path, body, session, nonce string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://127.0.0.1:47123"+path, strings.NewReader(body))
		r.Host = "127.0.0.1:47123"
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "http://127.0.0.1:47123")
		r.Header.Set("X-Cove-Session-Token", session)
		r.Header.Set("X-Cove-CSRF-Token", nonce)
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w
	}
	if got := call("GET", "/api/speech/settings", "", "", ""); got.Code != 401 {
		t.Fatal("anonymous speech configuration allowed", got.Code)
	}
	if got := call("POST", "/api/speech/preview", `{"text":"Read locally"}`, token, ""); got.Code != 403 || service.calls != 0 {
		t.Fatal("CSRF-free synthesis allowed", got.Code)
	}
	if got := call("POST", "/api/speech/preview", `{"text":"Read locally"}`, token, csrf); got.Code != 200 {
		t.Fatal(got.Code, got.Body.String())
	}
	if got := call("GET", "/api/speech/job/chunks/0", "", token, ""); got.Code != 200 || got.Header().Get("Cache-Control") != "no-store" || got.Header().Get("Content-Type") != "audio/wav" {
		t.Fatal("invalid audio response", got.Code)
	}
	if got := call("GET", "/api/speech/job/audio", "", token, ""); got.Header().Get("Content-Disposition") == "" {
		t.Fatal("audio export missing filename")
	}
	server.security.RegisterLaunchToken("launch-token")
	other, _ := launchBrowserSession(t, server)
	if got := call("GET", "/api/speech/job/audio", "", other, ""); got.Code != 404 {
		t.Fatal("audio crossed browser sessions", got.Code)
	}
	if got := call("POST", "/api/speech", `{"conversation_id":"chat","message_id":"answer"}`, token, csrf); got.Code != 409 || !strings.Contains(got.Body.String(), "speech_model_required") {
		t.Fatal("missing-model guidance not returned", got.Code)
	}
	if got := call("POST", "/api/speech/preview", `{"text":"Read","unexpected":true}`, token, csrf); got.Code != 400 {
		t.Fatal("invalid preview accepted", got.Code)
	}
	if got := call("GET", "/api/speech/job/chunks/999", "", token, ""); got.Code != 404 {
		t.Fatal("invalid chunk accepted", got.Code)
	}
}
