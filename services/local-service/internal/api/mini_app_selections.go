package api

import (
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
	if err := s.apps.CheckCapability(r.Context(), id, "mac.selection.receive"); err != nil {
		appReply(w, nil, err)
		return
	}
	s.files.Lock()
	defer s.files.Unlock()
	s.files.prune()
	session, _ := localsecurity.SessionFromRequest(r)
	if r.Method == "GET" {
		receipt := r.URL.Query().Get("selection")
		pending, ok := s.files.selections[receipt]
		if !ok || pending.target.Instance != id {
			writeJSON(w, 200, map[string]any{"pending": false})
			return
		}
		if pending.session != "" && pending.session != session.ID {
			appReply(w, nil, miniapps.ErrDenied)
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
	delete(s.files.selections, in.ID)
	writeJSON(w, 200, map[string]string{"text": pending.text})
}
