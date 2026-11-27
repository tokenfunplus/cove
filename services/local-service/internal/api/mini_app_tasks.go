package api

import (
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
	"net/http"

	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
)

func (s *Server) appTasks(w http.ResponseWriter, r *http.Request) {
	model, ok := s.chat.(miniapps.ModelExecutor)
	if !ok || s.appStore == nil {
		writeError(w, 503, "model_unavailable", "Mini App model execution is unavailable.")
		return
	}
	ctx, instance := r.Context(), r.PathValue("id")
	s.appChanges.Lock()
	defer s.appChanges.Unlock()
	authorize := func() error { return s.apps.CheckCapability(ctx, instance, "ai.generate") }
	if err := authorize(); err != nil {
		appReply(w, nil, err)
		return
	}
	if r.Method == "GET" && r.PathValue("task") == "" {
		tasks, err := s.appStore.ListAppTasks(ctx, instance)
		appReply(w, map[string]any{"tasks": tasks}, err)
		return
	}
	if r.Method != "POST" {
		id := r.PathValue("task")
		if r.Method == "DELETE" {
			model.StopAppTask(instance, id)
		}
		t, err := s.appStore.AppTask(ctx, instance, id)
		appReply(w, t, err)
		return
	}
	var in miniapps.ModelRequest
	if !appInput(w, r, &in) {
		return
	}
	session, _ := localsecurity.SessionFromRequest(r)
	in.BrowserOwner = session.ID
	task, err := s.apps.StartModel(ctx, model, instance, in)
	appReply(w, task, err)
}
