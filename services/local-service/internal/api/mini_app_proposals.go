package api

import (
	"net/http"

	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
)

func (s *Server) appProposals(w http.ResponseWriter, r *http.Request) {
	executor, ok := s.chat.(miniapps.ModelExecutor)
	if !ok || s.appStore == nil {
		writeError(w, 503, "model_unavailable", "Model proposals are unavailable. Choose an app action manually.")
		return
	}
	id, ctx := r.PathValue("id"), r.Context()
	if r.Method == "POST" {
		var req miniapps.ProposalRequest
		if !appInput(w, r, &req) {
			return
		}
		result, err := s.apps.StartProposal(ctx, executor, id, req)
		appReply(w, result, err)
		return
	}
	s.apps.InstanceChanges.Lock()
	defer s.apps.InstanceChanges.Unlock()
	taskID := r.PathValue("task")
	if taskID == "" {
		surface := r.URL.Query().Get("surface")
		if surface != "chat" && surface != "panel" {
			appReply(w, nil, miniapps.ErrInvalid)
			return
		}
		recent, err := s.appStore.LatestAppProposal(ctx, id, surface)
		appReply(w, recent, err)
		return
	}
	result, err := s.appStore.AppProposalTask(ctx, id, taskID)
	if err == nil && r.Method == "DELETE" {
		executor.StopAppTask(id, taskID)
		result, err = s.appStore.AppProposalTask(ctx, id, taskID)
	}
	appReply(w, result, err)
}
