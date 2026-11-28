package api

import (
	"errors"
	"net/http"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
)

func (s *Server) appVerifiedRoutes(register func(string, string, http.HandlerFunc)) {
	base := "/instances/{id}/tasks/{task}/browser/"
	for _, step := range []string{"claim", "progress", "settle"} {
		register("POST", base+step, func(w http.ResponseWriter, r *http.Request) { s.appBrowserStep(w, r, step) })
	}
}
func (s *Server) appBrowserStep(w http.ResponseWriter, r *http.Request, step string) {
	id, task, ctx := r.PathValue("id"), r.PathValue("task"), r.Context()
	model, ok := s.chat.(*chat.Service)
	if !ok {
		writeError(w, 503, "unavailable", "Browser inference is unavailable.")
		return
	}
	session, _ := localsecurity.SessionFromRequest(r)
	var in chat.DebateBrowserResult
	var phase string
	if step == "settle" {
		r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
		if decodeJSON(r, &in) != nil {
			writeError(w, 400, "validation", "Invalid verification settlement.")
			return
		}
	} else {
		var input struct {
			ClaimID string `json:"claim_id"`
			Phase   string `json:"phase,omitempty"`
		}
		if !appInput(w, r, &input) {
			return
		}
		in.ClaimID, phase = input.ClaimID, input.Phase
	}
	s.apps.InstanceChanges.Lock()
	defer s.apps.InstanceChanges.Unlock()
	if err := s.apps.CheckCapability(ctx, id, "ai.generate"); err != nil {
		if step == "settle" {
			if accepted, ackErr := model.AcknowledgeAppBrowserSettlement(ctx, id, task, session.ID, in); ackErr == nil && accepted {
				w.Header().Set("Cache-Control", "no-store")
				appReply(w, nil, nil)
				return
			}
		}
		appReply(w, nil, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	var out any
	var err error
	switch step {
	case "claim":
		out, err = model.ClaimAppBrowser(id, task, session.ID, in.ClaimID)
	case "progress":
		err = model.ProgressAppBrowser(id, task, session.ID, in.ClaimID, phase)
	case "settle":
		err = model.SettleAppBrowser(ctx, id, task, session.ID, in)
	}
	if errors.Is(err, chat.ErrAppVerification) {
		writeError(w, 400, "validation", "This task could not accept the browser verification.")
		return
	}
	appReply(w, out, err)
}
