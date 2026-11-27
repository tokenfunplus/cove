package api

import (
	"context"
	"net/http"

	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func (s *Server) appTasks(w http.ResponseWriter, r *http.Request) {
	model, ok := s.chat.(miniapps.ModelExecutor)
	if !ok || s.appStore == nil {
		writeError(w, 503, "model_unavailable", "Mini App model execution is unavailable.")
		return
	}
	ctx, instance := r.Context(), r.PathValue("id")
	if r.Method != "POST" {
		s.apps.InstanceChanges.Lock()
		defer s.apps.InstanceChanges.Unlock()
	}
	if err := s.apps.CheckCapability(ctx, instance, "ai.generate"); err != nil {
		appReply(w, nil, err)
		return
	}
	if r.Method == "GET" && r.PathValue("task") == "" {
		tasks, err := s.appStore.ListAppTasks(ctx, instance)
		if err == nil {
			for index := range tasks {
				tasks[index] = s.projectAppTask(instance, tasks[index])
			}
		}
		appReply(w, map[string]any{"tasks": tasks}, err)
		return
	}
	if r.Method != "POST" {
		id := r.PathValue("task")
		t, err := s.appStore.AppTask(ctx, instance, id)
		if err == nil && r.Method == "DELETE" {
			model.StopAppTask(instance, id)
			t, err = s.appStore.AppTask(ctx, instance, id)
		}
		if err == nil {
			t = s.projectAppTask(instance, t)
		}
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

func (s *Server) projectAppTask(instance string, task persistence.AppTask) persistence.AppTask {
	if model, ok := s.chat.(interface {
		ProjectAppTask(string, persistence.AppTask) persistence.AppTask
	}); ok {
		return model.ProjectAppTask(instance, task)
	}
	return task
}

// Saving an already authorized frozen result is an owner administration action,
// like exporting a disabled instance. It grants no model access and returns no
// output, so an owner can recover the save after revoking generation permission.
func (s *Server) appRetryTaskSave(w http.ResponseWriter, r *http.Request) {
	model, ok := s.chat.(interface {
		RetryAppTaskSave(context.Context, string, string) error
	})
	if !ok || s.appStore == nil {
		writeError(w, 503, "model_unavailable", "Mini App task saving is unavailable.")
		return
	}
	s.apps.InstanceChanges.Lock()
	defer s.apps.InstanceChanges.Unlock()
	instance, id, ctx := r.PathValue("id"), r.PathValue("task"), r.Context()
	if _, err := s.apps.Instance(ctx, instance); err != nil {
		appReply(w, nil, err)
		return
	}
	if _, found, err := s.appStore.FindAppTask(ctx, instance, id); err != nil {
		appReply(w, nil, err)
		return
	} else if !found {
		appReply(w, nil, miniapps.ErrNotFound)
		return
	}
	if err := model.RetryAppTaskSave(ctx, instance, id); err != nil {
		appReply(w, nil, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) appDiscardTaskResult(w http.ResponseWriter, r *http.Request) {
	model, ok := s.chat.(interface {
		DiscardAppTaskResult(context.Context, string, string) error
	})
	if !ok || s.appStore == nil {
		writeError(w, 503, "model_unavailable", "Mini App task recovery is unavailable.")
		return
	}
	s.apps.InstanceChanges.Lock()
	defer s.apps.InstanceChanges.Unlock()
	instance, id, ctx := r.PathValue("id"), r.PathValue("task"), r.Context()
	if _, err := s.apps.Instance(ctx, instance); err != nil {
		appReply(w, nil, err)
		return
	}
	if _, found, err := s.appStore.FindAppTask(ctx, instance, id); err != nil {
		appReply(w, nil, err)
		return
	} else if !found {
		appReply(w, nil, miniapps.ErrNotFound)
		return
	}
	if err := model.DiscardAppTaskResult(ctx, instance, id); err != nil {
		appReply(w, nil, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
