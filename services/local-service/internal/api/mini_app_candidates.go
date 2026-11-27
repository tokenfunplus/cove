package api

import (
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"net/http"
)

func (s *Server) appCandidateCheck(w http.ResponseWriter, r *http.Request) {
	var req miniapps.CandidateCheckRequest
	if !appInput(w, r, &req) {
		return
	}
	result, err := s.apps.CheckCandidates(r.Context(), r.PathValue("id"), req)
	appReply(w, result, err)
}
