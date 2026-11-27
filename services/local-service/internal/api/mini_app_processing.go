package api

import (
	"context"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/retrieval"
	"github.com/tokenfunplus/cove/services/local-service/internal/speech"
)

func (s *Server) appProcessingRoutes(register func(string, string, http.HandlerFunc)) {
	const base = "/instances/{id}"
	register("POST", base+"/documents/search", s.appDocumentSearch)
	register("POST", base+"/speech", s.appSpeech)
	register("GET", base+"/speech/{job}", s.appSpeech)
	register("GET", base+"/speech/{job}/audio", s.appSpeech)
	register("DELETE", base+"/speech/{job}", s.appSpeech)
}

func (s *Server) appDocumentSearch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id, ctx := r.PathValue("id"), r.Context()
	i, err := s.apps.Instance(ctx, id)
	if err != nil {
		appReply(w, nil, err)
		return
	}
	if !i.Enabled || !slices.Contains(i.Grants, "documents.search") {
		appReply(w, nil, miniapps.ErrDenied)
		return
	}
	var input struct {
		DocumentIDs []string `json:"document_ids"`
		Query       string   `json:"query"`
	}
	if !appInput(w, r, &input) {
		return
	}
	if len(input.DocumentIDs) < 1 || len(input.DocumentIDs) > 4 || strings.TrimSpace(input.Query) == "" || utf8.RuneCountInString(input.Query) > 400 {
		writeError(w, 400, "validation", "Select one to four documents and enter up to 400 characters.")
		return
	}
	service, ok := s.chat.(interface {
		SearchLocalDocuments(context.Context, []string, string, ...float64) (retrieval.Results, error)
	})
	if !ok {
		writeError(w, 503, "unavailable", "Local document search is unavailable.")
		return
	}
	results, err := service.SearchLocalDocuments(ctx, input.DocumentIDs, input.Query)
	if err != nil {
		writeError(w, 400, "local_document", err.Error())
		return
	}
	// A long retrieval may outlive a grant, reinstallation or upgrade.
	current, err := s.apps.Instance(ctx, id)
	if err != nil {
		appReply(w, nil, err)
		return
	}
	if current.Revision != i.Revision {
		appReply(w, nil, miniapps.ErrConflict)
		return
	}
	writeJSON(w, 200, results)
}

type appSpeechService interface {
	ReadMiniAppText(context.Context, string, string, string, string) (speech.JobStatus, error)
	SpeechStatus(string, string) (speech.JobStatus, error)
	SpeechAudio(string, string, int) ([]byte, error)
	StopSpeech(context.Context, string, string) error
}

func (s *Server) appSpeech(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id, ctx := r.PathValue("id"), r.Context()
	session, ok := localsecurity.SessionFromRequest(r)
	if !ok {
		appReply(w, nil, miniapps.ErrDenied)
		return
	}
	var input struct {
		Text     string `json:"text"`
		Language string `json:"language,omitempty"`
	}
	if r.Method == "POST" {
		if !appInput(w, r, &input) {
			return
		}
		// Serialize grant admission and job creation with instance revocation.
		s.apps.InstanceChanges.Lock()
		defer s.apps.InstanceChanges.Unlock()
	}
	if err := s.apps.CheckCapability(ctx, id, "speech.speak"); err != nil {
		appReply(w, nil, err)
		return
	}
	service, ok := s.chat.(appSpeechService)
	if !ok {
		writeError(w, 503, "unavailable", "Local speech is unavailable.")
		return
	}
	owner := chat.AppSpeechOwner(id, session.ID)
	job := r.PathValue("job")
	var result speech.JobStatus
	var err error
	switch {
	case r.Method == "POST":
		result, err = service.ReadMiniAppText(ctx, id, session.ID, input.Text, input.Language)
	case r.Method == "DELETE":
		err = service.StopSpeech(ctx, owner, job)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	case strings.HasSuffix(r.URL.Path, "/audio"):
		var audio []byte
		audio, err = service.SpeechAudio(owner, job, -1)
		if err == nil {
			w.Header().Set("Content-Type", "audio/wav")
			w.Header().Set("Content-Length", strconv.Itoa(len(audio)))
			w.Header().Set("X-Content-Type-Options", "nosniff")
			_, _ = w.Write(audio)
			return
		}
	default:
		result, err = service.SpeechStatus(owner, job)
	}
	if err != nil {
		writeSpeechError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (s *Server) stopAppSpeech(ctx context.Context, id string) {
	if svc, ok := s.chat.(interface {
		RevokeAppSpeech(context.Context, string) error
	}); ok {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = svc.RevokeAppSpeech(cleanup, id)
	}
}
