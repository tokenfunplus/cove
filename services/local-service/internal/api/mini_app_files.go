package api

import (
	"net/http"
	"path/filepath"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
)

type pickedText struct {
	State string `json:"state"`
	Name  string `json:"name,omitempty"`
	Text  string `json:"text,omitempty"`
}
type fileRequest struct {
	instance, session, label string
	expires                  time.Time
	claimed                  bool
	result                   pickedText
}
type appFileBroker struct {
	sync.Mutex
	requests   map[string]*fileRequest
	selections map[string]stagedSelection
}

func (b *appFileBroker) prune() {
	now := time.Now()
	for id, selection := range b.selections {
		if !now.Before(selection.expires) {
			delete(b.selections, id)
		}
	}
	for id, q := range b.requests {
		if !now.Before(q.expires) {
			delete(b.requests, id)
		}
	}
}
func (b *appFileBroker) invalidate(instance string) {
	b.Lock()
	defer b.Unlock()
	for id, selection := range b.selections {
		if selection.target.Instance == instance {
			delete(b.selections, id)
		}
	}
	for id, q := range b.requests {
		if q.instance == instance {
			delete(b.requests, id)
		}
	}
}

func (s *Server) appFiles(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.apps.InstanceChanges.Lock()
	defer s.apps.InstanceChanges.Unlock()
	if err := s.apps.CheckCapability(r.Context(), id, "mac.files.pick"); err != nil {
		appReply(w, nil, err)
		return
	}
	inst, err := s.apps.Instance(r.Context(), id)
	if err != nil {
		appReply(w, nil, err)
		return
	}
	session, _ := localsecurity.SessionFromRequest(r)
	b := &s.files
	b.Lock()
	defer b.Unlock()
	b.prune()
	if r.Method == "POST" {
		if len(b.requests) >= 32 {
			writeError(w, 429, "busy", "Too many pending file selections.")
			return
		}
		if b.requests == nil {
			b.requests = make(map[string]*fileRequest)
		}
		key := uuid.NewString()
		b.requests[key] = &fileRequest{instance: id, session: session.ID, label: inst.Name, expires: time.Now().Add(2 * time.Minute), result: pickedText{State: "pending"}}
		writeJSON(w, 200, map[string]string{"id": key, "url": "cove://pick/" + key})
		return
	}
	q := b.requests[r.PathValue("file")]
	if q == nil || q.instance != id || q.session != session.ID {
		appReply(w, nil, miniapps.ErrNotFound)
		return
	}
	writeJSON(w, 200, q.result)
}

func (s *Server) nativeAppFile(w http.ResponseWriter, r *http.Request) {
	var answer pickedText
	claim := r.Pattern == "POST /internal/control/mini-app-files/{file}/claim"
	renew := r.Pattern == "POST /internal/control/mini-app-files/{file}/renew"
	if !claim && !renew && !appInput(w, r, &answer) {
		return
	}
	b := &s.files
	b.Lock()
	defer b.Unlock()
	b.prune()
	q := b.requests[r.PathValue("file")]
	if q == nil {
		appReply(w, nil, miniapps.ErrNotFound)
		return
	}
	if q.result.State != "pending" || claim == q.claimed {
		appReply(w, nil, miniapps.ErrConflict)
		return
	}
	if claim || renew {
		q.claimed = true
		q.expires = time.Now().Add(30 * time.Minute)
		writeJSON(w, 200, map[string]string{"instance": q.label})
		return
	}
	switch answer.State {
	case "cancelled", "failed":
		q.result = pickedText{State: answer.State}
	case "completed":
		if len(answer.Text) > 60000 || !utf8.ValidString(answer.Text) || len(answer.Name) > 255 || answer.Name == "" || filepath.Base(answer.Name) != answer.Name {
			appReply(w, nil, miniapps.ErrInvalid)
			return
		}
		q.result = answer
	default:
		appReply(w, nil, miniapps.ErrInvalid)
		return
	}
	q.expires = time.Now().Add(2 * time.Minute)
	writeJSON(w, 200, struct{}{})
}
