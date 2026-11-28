package api

import (
	"context"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
)

type selectionTarget struct {
	Instance string `json:"instance"`
	Name     string `json:"name"`
	View     string `json:"view"`
	Action   string `json:"action"`
	Title    string `json:"title"`
	Field    string `json:"field"`
	Revision int64  `json:"revision"`
}
type stagedSelection struct {
	target            selectionTarget
	id, text, session string
	expires           time.Time
}

func (s *Server) validateSelectionTarget(ctx context.Context, target selectionTarget) error {
	instance, err := s.apps.Instance(ctx, target.Instance)
	if err != nil {
		return err
	}
	if instance.Revision != target.Revision || !instance.Enabled || !slices.Contains(instance.Grants, "mac.selection.receive") {
		return miniapps.ErrConflict
	}
	release, err := s.apps.Release(ctx, instance.ReleaseID)
	if err != nil {
		return err
	}
	action := release.Package.Actions[target.Action]
	capability := "records.commit"
	if action.Op == "generate" {
		capability = "ai.generate"
	} else if action.Op != "create" {
		return miniapps.ErrConflict
	}
	if !slices.Contains(instance.Grants, capability) || action.Inputs[target.Field] != "text" || miniapps.HiddenInput(release.Package, action, target.Field) {
		return miniapps.ErrConflict
	}
	for _, page := range release.Package.Pages {
		if page.ID == target.View && slices.Contains(page.Actions, target.Action) && slices.Contains(action.Surfaces, "page") {
			return nil
		}
	}
	return miniapps.ErrConflict
}

func (s *Server) nativeSelection(w http.ResponseWriter, r *http.Request) {
	if s.apps == nil {
		appReply(w, nil, miniapps.ErrDenied)
		return
	}
	s.apps.InstanceChanges.Lock()
	defer s.apps.InstanceChanges.Unlock()
	var pick struct {
		Target selectionTarget `json:"target"`
		Text   string          `json:"text"`
	}
	stage := r.URL.Path == "/internal/control/mini-app-selection/stage"
	if stage && !appInput(w, r, &pick) {
		return
	}
	if stage && (strings.TrimSpace(pick.Text) == "" || len(pick.Text) > 60000) {
		appReply(w, nil, miniapps.ErrInvalid)
		return
	}
	instances, err := s.apps.Instances(r.Context())
	if err != nil {
		appReply(w, nil, err)
		return
	}
	targets := []selectionTarget{}
	for _, i := range instances {
		if !i.Enabled || !slices.Contains(i.Grants, "mac.selection.receive") || (stage && i.ID != pick.Target.Instance) {
			continue
		}
		release, err := s.apps.Release(r.Context(), i.ReleaseID)
		if err != nil {
			appReply(w, nil, err)
			return
		}
		for _, page := range release.Package.Pages {
			for _, id := range page.Actions {
				a := release.Package.Actions[id]
				if a.Op != "generate" && a.Op != "create" {
					continue
				}
				needed := "records.commit"
				if a.Op == "generate" {
					needed = "ai.generate"
				}
				if !slices.Contains(i.Grants, needed) {
					continue
				}
				for field, t := range a.Inputs {
					if t == "text" && !miniapps.HiddenInput(release.Package, a, field) {
						targets = append(targets, selectionTarget{i.ID, i.Name, page.ID, id, a.Title, field, i.Revision})
					}
				}
			}
		}
	}
	if !stage {
		sort.Slice(targets, func(i, j int) bool {
			a, b := targets[i], targets[j]
			return a.Name+a.Instance+a.View+a.Title+a.Field < b.Name+b.Instance+b.View+b.Title+b.Field
		})
		writeJSON(w, 200, targets)
		return
	}
	if !slices.Contains(targets, pick.Target) {
		appReply(w, nil, miniapps.ErrDenied)
		return
	}
	s.files.Lock()
	defer s.files.Unlock()
	s.files.prune()
	if s.files.selections == nil {
		s.files.selections = map[string]stagedSelection{}
	}
	if len(s.files.selections) >= 32 {
		writeError(w, 429, "busy", "Too many pending selections.")
		return
	}
	selection := stagedSelection{target: pick.Target, id: uuid.NewString(), text: pick.Text, expires: time.Now().Add(10 * time.Minute)}
	s.files.selections[selection.id] = selection
	writeJSON(w, 200, map[string]string{"id": selection.id})
}

func (s *Server) appNativeSelection(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.apps.InstanceChanges.Lock()
	defer s.apps.InstanceChanges.Unlock()
	s.files.Lock()
	defer s.files.Unlock()
	s.files.prune()
	session, _ := localsecurity.SessionFromRequest(r)
	if r.Method == "GET" {
		receipt := r.URL.Query().Get("selection")
		pending, ok := s.files.selections[receipt]
		if !ok || pending.target.Instance != id {
			if err := s.apps.CheckCapability(r.Context(), id, "mac.selection.receive"); err != nil {
				appReply(w, nil, err)
				return
			}
			writeJSON(w, 200, map[string]any{"pending": false})
			return
		}
		if pending.session != "" && pending.session != session.ID {
			appReply(w, nil, miniapps.ErrDenied)
			return
		}
		if err := s.validateSelectionTarget(r.Context(), pending.target); err != nil {
			appReply(w, nil, err)
			return
		}
		pending.session = session.ID
		s.files.selections[receipt] = pending
		writeJSON(w, 200, map[string]any{"pending": true, "id": pending.id, "target": pending.target})
		return
	}

	var in struct {
		ID string `json:"id"`
	}
	if !appInput(w, r, &in) {
		return
	}
	pending, ok := s.files.selections[in.ID]
	if !ok || pending.target.Instance != id || pending.session != session.ID {
		appReply(w, nil, miniapps.ErrConflict)
		return
	}
	if err := s.validateSelectionTarget(r.Context(), pending.target); err != nil {
		appReply(w, nil, err)
		return
	}
	delete(s.files.selections, in.ID)
	writeJSON(w, 200, map[string]string{"text": pending.text})
}
