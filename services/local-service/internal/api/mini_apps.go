package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/appcatalog"
	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
)

var appSlug = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)
var viewID = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,63}$`)
var versionID = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)

func appDestination(r *http.Request) string {
	q := r.URL.Query()
	if id, err := uuid.Parse(q.Get("instance")); err == nil && viewID.MatchString(q.Get("view")) {
		return "/apps/" + id.String() + "/" + q.Get("view")
	}
	if appSlug.MatchString(q.Get("publisher")) && appSlug.MatchString(q.Get("app")) {
		path := "/apps/install/" + q.Get("publisher") + "/" + q.Get("app")
		if v := q.Get("version"); len(v) <= 32 && versionID.MatchString(v) {
			path += "?version=" + v
		}
		return path
	}
	return "/apps"
}

func (s *Server) miniAppRoutes(mux *http.ServeMux, session func(http.Handler) http.Handler) {
	const prefix = "/api/mini-apps"
	register := func(method, path string, fn http.HandlerFunc) {
		mux.Handle(method+" "+prefix+path, session(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if s.apps == nil {
				writeError(w, 503, "unavailable", "Mini Apps are unavailable.")
				return
			}
			fn(w, r)
		})))
	}
	s.appVerifiedRoutes(register)
	s.appProcessingRoutes(register)
	register("GET", "/instances/{id}/proposals", s.appProposals)
	register("POST", "/instances/{id}/proposals", s.appProposals)
	register("GET", "/instances/{id}/proposals/{task}", s.appProposals)
	register("DELETE", "/instances/{id}/proposals/{task}", s.appProposals)
	register("GET", "/instances/{id}/blobs", s.appBlobs)
	register("POST", "/instances/{id}/blobs", s.appBlobs)
	register("GET", "/instances/{id}/blobs/{blob}", s.appBlobs)
	register("DELETE", "/instances/{id}/blobs/{blob}", s.appBlobs)
	register("GET", "/instances/{id}/export", s.appExport)
	register("POST", "/instances/restore", s.appRestore)
	mux.HandleFunc("GET /apps", s.shell)
	mux.HandleFunc("GET /apps/{path...}", s.shell)
	register("GET", "/packages", s.appPackages)
	register("POST", "/packages/preview", s.appPackages)
	register("POST", "/packages/install", s.appPackages)
	register("GET", "/instances", s.appInstances)
	register("POST", "/instances", s.appInstances)
	register("GET", "/instances/{id}", s.appInstance)
	register("DELETE", "/instances/{id}", s.appInstance)
	register("POST", "/instances/{id}/settings", s.appInstance)
	register("POST", "/instances/{id}/upgrade", s.appInstance)
	register("POST", "/instances/{id}/actions/{action}", s.appInvoke)
	register("GET", "/catalog", s.appCatalog)
	register("GET", "/catalog/{publisher}/{app}/{version}", s.appCatalog)
	register("POST", "/catalog/{publisher}/{app}/{version}/install", s.appCatalog)
	register("POST", "/instances/{id}/attach", s.appAttach)
	register("POST", "/instances/{id}/selection", s.appSelection)
	register("GET", "/instances/{id}/tasks", s.appTasks)
	register("POST", "/instances/{id}/tasks", s.appTasks)
	register("GET", "/instances/{id}/tasks/{task}", s.appTasks)
	register("DELETE", "/instances/{id}/tasks/{task}", s.appTasks)
	register("POST", "/instances/{id}/files", s.appFiles)
	register("GET", "/instances/{id}/files/{file}", s.appFiles)
	control := localsecurity.RequireControlToken(s.controlToken, s.writeSecurityError)
	mux.Handle("POST /internal/control/mini-app-files/{file}/claim", control(http.HandlerFunc(s.nativeAppFile)))
	mux.Handle("POST /internal/control/mini-app-files/{file}/finish", control(http.HandlerFunc(s.nativeAppFile)))
}

func readAppBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, appcatalog.MaxPackage))
	if err != nil {
		return nil, miniapps.ErrInvalid
	}
	return data, nil
}

func appInput(w http.ResponseWriter, r *http.Request, target any) bool {
	data, e := readAppBody(w, r)
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if e != nil || d.Decode(target) != nil || d.Decode(&struct{}{}) != io.EOF {
		writeError(w, 400, "validation", "Invalid Mini App request.")
		return false
	}
	return true
}
func appReply(w http.ResponseWriter, value any, err error) {
	if err == nil {
		writeJSON(w, 200, value)
		return
	}
	switch {
	case errors.Is(err, miniapps.ErrInvalid):
		writeError(w, 400, "validation", err.Error())
	case errors.Is(err, miniapps.ErrDenied):
		writeError(w, 403, "permission_denied", "This operation is unavailable for the instance and its current permissions.")
	case errors.Is(err, miniapps.ErrConflict), errors.Is(err, chat.ErrAppTaskConflict):
		writeError(w, 409, "conflict", "The instance, record, or operation has changed. Refresh and review it again.")
	case errors.Is(err, miniapps.ErrNotFound), errors.Is(err, sql.ErrNoRows):
		writeError(w, 404, "not_found", "The requested Mini App item was not found.")
	case errors.Is(err, chat.ErrGenerationBatchInProgress):
		writeError(w, 409, "busy", "Another model task is active.")
	case errors.Is(err, chat.ErrAppBrowserModel), errors.Is(err, chat.ErrAppDestination), errors.Is(err, chat.ErrLocalOnly):
		writeError(w, 409, "model_unavailable", err.Error())
	default:
		writeError(w, 500, "mini_app_error", "Cove could not complete the Mini App operation.")
	}
}

func (s *Server) appPackages(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		list, err := s.apps.Releases(r.Context())
		appReply(w, map[string]any{"packages": list}, err)
		return
	}
	raw, err := readAppBody(w, r)
	if err != nil {
		appReply(w, nil, err)
		return
	}
	if r.URL.Path == "/api/mini-apps/packages/preview" {
		item, err := miniapps.Preview(raw, "local")
		appReply(w, item, err)
		return
	}
	item, err := s.apps.Install(r.Context(), raw, "local")
	appReply(w, item, err)
}
func (s *Server) appInstances(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		list, err := s.apps.Instances(r.Context())
		appReply(w, map[string]any{"instances": list}, err)
		return
	}
	var in miniapps.CreateRequest
	if !appInput(w, r, &in) {
		return
	}
	item, err := s.apps.Create(r.Context(), in)
	appReply(w, item, err)
}
func (s *Server) appInstance(w http.ResponseWriter, r *http.Request) {
	ctx, id := r.Context(), r.PathValue("id")
	if r.Method == "GET" {
		inst, err := s.apps.Instance(ctx, id)
		if err != nil {
			appReply(w, nil, err)
			return
		}
		release, err := s.apps.Release(ctx, inst.ReleaseID)
		appReply(w, map[string]any{"instance": inst, "package": release.Package}, err)
		return
	}
	s.appChanges.Lock()
	defer s.appChanges.Unlock()
	var result any
	var err error
	switch {
	case r.Method == "DELETE":
		err = s.apps.Delete(ctx, id)
	case r.Pattern == "POST /api/mini-apps/instances/{id}/settings":
		var in miniapps.ConfigRequest
		if !appInput(w, r, &in) {
			return
		}
		result, err = s.apps.Configure(ctx, id, in)
	default:
		var in miniapps.UpgradeRequest
		if !appInput(w, r, &in) {
			return
		}
		result, err = s.apps.Upgrade(ctx, id, in)
	}
	if err == nil {
		s.files.invalidate(id)
		s.stopAppSpeech(ctx, id)
		if model, ok := s.chat.(miniapps.ModelExecutor); ok {
			model.StopAppTask(id, "")
		}
	}
	appReply(w, result, err)
}
func (s *Server) appInvoke(w http.ResponseWriter, r *http.Request) {
	var in miniapps.Invocation
	if !appInput(w, r, &in) {
		return
	}
	if in.Action != "" && in.Action != r.PathValue("action") {
		appReply(w, nil, miniapps.ErrInvalid)
		return
	}
	in.Action = r.PathValue("action")
	result, err := s.apps.Invoke(r.Context(), r.PathValue("id"), in)
	appReply(w, result, err)
}
func (s *Server) appCatalog(w http.ResponseWriter, r *http.Request) {
	entries, err := s.catalog.List(r.Context())
	if err != nil {
		writeError(w, 502, "catalog_unavailable", "The configured Mini App catalog could not be verified.")
		return
	}
	if r.PathValue("publisher") == "" {
		writeJSON(w, 200, map[string]any{"packages": entries})
		return
	}
	for _, e := range entries {
		if e.Publisher != r.PathValue("publisher") || e.App != r.PathValue("app") || e.Version != r.PathValue("version") {
			continue
		}
		if r.Method == "POST" {
			var in struct {
				Digest string `json:"digest"`
			}
			if !appInput(w, r, &in) {
				return
			}
			if in.Digest != e.Digest {
				appReply(w, nil, miniapps.ErrConflict)
				return
			}
			release, err := s.apps.Install(r.Context(), e.Raw, e.Origin)
			appReply(w, release, err)
			return
		}
		w.Header().Set("X-Cove-Package-Digest", e.Digest)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(e.Raw)
		return
	}
	appReply(w, nil, miniapps.ErrNotFound)
}

func (s *Server) appAttach(w http.ResponseWriter, r *http.Request) {
	var req miniapps.AttachmentRequest
	if !appInput(w, r, &req) {
		return
	}
	snapshot, err := s.apps.Attach(r.Context(), r.PathValue("id"), req)
	appReply(w, snapshot, err)
}

// The trusted composer holds the user's draft. Check the instance grant again
// when the user chooses to pass its text to an app field.
func (s *Server) appSelection(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Text string `json:"text"`
	}
	if !appInput(w, r, &in) {
		return
	}
	if in.Text == "" || len(in.Text) > 60000 {
		writeError(w, 400, "validation", "Select up to 60,000 bytes of text.")
		return
	}
	if err := s.apps.CheckCapability(r.Context(), r.PathValue("id"), "mac.selection.receive"); err != nil {
		appReply(w, nil, err)
		return
	}
	writeJSON(w, 200, in)
}
