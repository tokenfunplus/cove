package api

import (
	"database/sql"
	"errors"
	"net/http"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func (s *Server) projects(w http.ResponseWriter, r *http.Request) {
	p, ok := s.chat.(chat.ProjectChat)
	if !ok {
		writeError(w, 503, "unavailable", "Projects are unavailable.")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	id := r.PathValue("project")
	var result any
	var err error
	status := http.StatusOK
	switch {
	case r.Method == "GET" && id == "":
		result, err = p.ListProjects(r.Context())
	case r.Method == "GET":
		result, err = p.GetProject(r.Context(), id)
	case r.Method == "POST" && r.PathValue("source") != "":
		var input struct {
			Revision int64 `json:"revision"`
		}
		if decodeJSON(r, &input) != nil {
			writeProjectError(w, persistence.ErrInvalidProject)
			return
		}
		result, err = p.RemoveProjectSource(r.Context(), id, r.PathValue("source"), input.Revision)
	case r.Method == "POST" && r.URL.Path == "/api/projects/"+id+"/sources":
		r.Body = http.MaxBytesReader(w, r.Body, 6<<20)
		var input struct {
			Revision       int64           `json:"revision"`
			File           documents.Input `json:"file"`
			WebSourceToken string          `json:"web_source_token"`
		}
		if decodeJSON(r, &input) != nil {
			writeProjectError(w, persistence.ErrInvalidProject)
			return
		}
		session, _ := localsecurity.SessionFromRequest(r)
		result, err = p.AddProjectSource(r.Context(), id, input.Revision, input.File, session.ID, input.WebSourceToken)
	case r.Method == "DELETE":
		var input struct {
			Revision            int64 `json:"revision"`
			DeleteConversations bool  `json:"delete_conversations"`
		}
		if decodeJSON(r, &input) != nil {
			writeProjectError(w, persistence.ErrInvalidProject)
			return
		}
		err = p.DeleteProject(r.Context(), id, input.Revision, input.DeleteConversations)
		result = map[string]bool{"deleted": true}
	default:
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var input persistence.ProjectInput
		if decodeJSON(r, &input) != nil {
			writeProjectError(w, persistence.ErrInvalidProject)
			return
		}
		result, err = p.SaveProject(r.Context(), id, input)
		if id == "" {
			status = 201
		}
	}
	if err != nil {
		writeProjectError(w, err)
		return
	}
	writeJSON(w, status, result)
}
func writeProjectError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, chat.ErrGenerationBatchInProgress), errors.Is(err, chat.ErrGenerationInProgress):
		writeError(w, 409, "project_busy", "The service has active work. Stop active generations or pause running debates before moving a conversation or dissolving a project.")
	case errors.Is(err, persistence.ErrProjectChanged):
		writeError(w, 409, "project_context_changed", "Project context changed. Refresh the project and review your preserved draft.")
	case errors.Is(err, persistence.ErrInvalidProject):
		writeError(w, 400, "invalid_project", "Check the project name, revision and source limits (three fixed sources and 60,000 source characters).")
	case errors.Is(err, sql.ErrNoRows):
		writeError(w, 404, "not_found", "The requested project, source or conversation does not exist.")
	default:
		writeGenerationError(w, err)
	}
}
func (s *Server) moveProjectConversation(w http.ResponseWriter, r *http.Request) {
	p, ok := s.chat.(chat.ProjectChat)
	if !ok {
		writeProjectError(w, persistence.ErrInvalidProject)
		return
	}
	var input struct {
		ProjectID          string `json:"project_id"`
		MembershipRevision int64  `json:"membership_revision"`
	}
	if decodeJSON(r, &input) != nil {
		writeProjectError(w, persistence.ErrInvalidProject)
		return
	}
	if e := p.MoveProjectConversation(r.Context(), r.PathValue("id"), input.ProjectID, input.MembershipRevision); e != nil {
		writeProjectError(w, e)
		return
	}
	view, e := s.chat.ReadConversation(r.Context(), r.PathValue("id"))
	if e != nil {
		writeProjectError(w, e)
		return
	}
	writeJSON(w, 200, conversationViewEnvelopeFor(view))
}

type contextUsage struct {
	Instructions int `json:"instructions"`
	Background   int `json:"background"`
	Sources      int `json:"sources"`
	History      int `json:"history"`
	Question     int `json:"question"`
	Total        int `json:"total"`
	Limit        int `json:"limit"`
}

func previewEnvelope(messages []provider.ProviderMessage, p *persistence.ProjectContext, x persistence.ProjectExpectation) any {
	u := contextUsage{Limit: documents.MaxContextCharacters}
	for i, m := range messages {
		n := utf8.RuneCountInString(m.Content)
		u.Total += n
		if m.Role == "system" {
			u.Instructions += n
		} else if i == len(messages)-1 {
			u.Question += n
		} else {
			u.History += n
		}
	}
	if p != nil {
		// Raw background characters are separate from JSON escaping and reference framing.
		u.Background = utf8.RuneCountInString(p.Background)
		u.Sources = utf8.RuneCountInString(p.ReferencePrefix) - u.Background
		u.Question -= u.Sources + u.Background
	}
	return struct {
		Messages []provider.ProviderMessage     `json:"messages"`
		Project  *persistence.ProjectContext    `json:"project_context"`
		Expected persistence.ProjectExpectation `json:"expected_project"`
		Usage    contextUsage                   `json:"usage"`
	}{messages, p, x, u}
}
