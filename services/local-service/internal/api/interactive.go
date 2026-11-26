package api

import (
	"context"
	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
	"net/http"
)

type cardService interface {
	MaterializeCard(context.Context, string) (interactive.Run, error)
	SaveCard(context.Context, interactive.Submission) (interactive.Run, error)
}

func (s *Server) interactiveCard(w http.ResponseWriter, r *http.Request) {
	service, ok := s.chat.(cardService)
	if !ok {
		writeError(w, 404, "not_found", "Interactive replies are unavailable.")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	var run interactive.Run
	var err error
	if r.Method == http.MethodPatch {
		var input interactive.Submission
		r.Body = http.MaxBytesReader(w, r.Body, 32768)
		if decodeJSON(r, &input) != nil || input.GenerationID != r.PathValue("id") {
			writeError(w, 400, "validation", "The card update is invalid.")
			return
		}
		run, err = service.SaveCard(r.Context(), input)
	} else {
		run, err = service.MaterializeCard(r.Context(), r.PathValue("id"))
	}
	if err != nil {
		writeGenerationError(w, err)
		return
	}
	writeJSON(w, 200, run)
}
