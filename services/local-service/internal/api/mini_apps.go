package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"slices"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/appcatalog"
	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

var appSlug = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)
var viewID = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,63}$`)
var versionID = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)

func appDestination(r *http.Request) string {
	q := r.URL.Query()
	if id, err := uuid.Parse(q.Get("instance")); err == nil && viewID.MatchString(q.Get("view")) {
		path := "/apps/" + id.String() + "/" + q.Get("view")
		if selection, err := uuid.Parse(q.Get("selection")); err == nil {
			path += "?selection=" + selection.String()
		}
		return path
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
			// ServeMux also matches HEAD to GET. Shared handlers dispatch on the
			// method, so do not let an implicit HEAD reach a mutation branch.
			if r.Method != method {
				w.Header().Set("Allow", method)
				writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "This Mini App endpoint does not support this method.")
				return
			}
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
	register("DELETE", "/packages/{release}", s.appDeleteRelease)
	register("GET", "/activity", s.appGlobalActivity)
	register("POST", "/packages/validate", s.appPackages)
	register("POST", "/packages/preview", s.appPackages)
	register("POST", "/packages/install", s.appPackages)
	register("GET", "/instances", s.appInstances)
	register("POST", "/instances", s.appInstances)
	register("GET", "/instances/{id}", s.appInstance)
	register("DELETE", "/instances/{id}", s.appInstance)
	register("POST", "/instances/{id}/settings", s.appInstance)
	register("POST", "/instances/{id}/upgrade", s.appInstance)
	register("POST", "/instances/{id}/actions/{action}", s.appInvoke)
	register("POST", "/instances/{id}/candidates/check", s.appCandidateCheck)
	register("GET", "/catalog-settings", s.appCatalogSettings)
	register("PUT", "/catalog-settings", s.appCatalogSettings)
	register("GET", "/catalog", s.appCatalog)
	register("GET", "/catalog/{publisher}/{app}/{version}", s.appCatalog)
	register("POST", "/catalog/{publisher}/{app}/{version}/install", s.appCatalog)
	register("POST", "/instances/{id}/attach", s.appAttach)
	register("POST", "/instances/{id}/selection", s.appSelection)
	register("GET", "/instances/{id}/native-selection", s.appNativeSelection)
	register("POST", "/instances/{id}/native-selection", s.appNativeSelection)
	register("GET", "/instances/{id}/capabilities", s.appCapabilities)
	register("GET", "/instances/{id}/activity", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if _, err := s.apps.Instance(r.Context(), id); err != nil {
			appReply(w, nil, err)
			return
		}
		items, err := s.appStore.AppActivity(r.Context(), id)
		if err == nil {
			for index := range items {
				if s.projectAppTask(id, persistence.AppTask{ID: items[index].Operation}).PendingSave {
					items[index].Status = "save_failed"
				}
			}
		}
		appReply(w, map[string]any{"activity": items}, err)
	})
	register("GET", "/instances/{id}/tasks", s.appTasks)
	register("POST", "/instances/{id}/tasks", s.appTasks)
	register("GET", "/instances/{id}/tasks/{task}", s.appTasks)
	register("DELETE", "/instances/{id}/tasks/{task}", s.appTasks)
	register("POST", "/instances/{id}/tasks/{task}/retry-save", s.appRetryTaskSave)
	register("POST", "/instances/{id}/tasks/{task}/discard-result", s.appDiscardTaskResult)
	register("POST", "/instances/{id}/files", s.appFiles)
	register("GET", "/instances/{id}/files/{file}", s.appFiles)
	control := localsecurity.RequireControlToken(s.controlToken, s.writeSecurityError)
	mux.Handle("POST /internal/control/mini-app-selection/targets", control(http.HandlerFunc(s.nativeSelection)))
	mux.Handle("POST /internal/control/mini-app-selection/stage", control(http.HandlerFunc(s.nativeSelection)))
	mux.Handle("POST /internal/control/mini-app-files/{file}/claim", control(http.HandlerFunc(s.nativeAppFile)))
	mux.Handle("POST /internal/control/mini-app-files/{file}/renew", control(http.HandlerFunc(s.nativeAppFile)))
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
	case errors.Is(err, miniapps.ErrReleaseContents):
		writeError(w, 409, "release_conflict", "A package with this version already has different contents. Publish a new version.")
	case errors.Is(err, miniapps.ErrPreviewExpired):
		writeError(w, 409, "preview_expired", "This change preview has expired. Preview the changes again.")
	case errors.Is(err, miniapps.ErrDenied):
		writeError(w, 403, "permission_denied", "This operation is unavailable for the instance and its current permissions.")
	case errors.Is(err, chat.ErrAppTaskSavePending):
		writeError(w, 409, "task_save_pending", "A Mini App result is waiting to be saved. Open Activity to retry saving or discard its unsaved output before starting another app model task.")
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
	if r.URL.Path == "/api/mini-apps/packages/validate" {
		w.Header().Set("Cache-Control", "no-store")
		item, err := miniapps.Validate(raw)
		appReply(w, item, err)
		return
	}
	installing := r.URL.Path == "/api/mini-apps/packages/install"
	if installing && (r.Header.Get("X-Cove-Release-ID") == "" || r.Header.Get("X-Cove-Package-Digest") == "") {
		appReply(w, nil, miniapps.ErrConflict)
		return
	}
	origin, err := s.fileOrigin(r, raw)
	if err != nil {
		if installing && errors.Is(err, miniapps.ErrInvalid) {
			if _, validationErr := miniapps.Validate(raw); validationErr == nil {
				err = miniapps.ErrConflict
			}
		}
		appReply(w, nil, err)
		return
	}
	item, err := miniapps.Preview(raw, origin)
	if err != nil || !installing {
		appReply(w, item, err)
		return
	}
	if item.ID != r.Header.Get("X-Cove-Release-ID") || item.Digest != r.Header.Get("X-Cove-Package-Digest") {
		appReply(w, nil, miniapps.ErrConflict)
		return
	}
	item, err = s.apps.Install(r.Context(), raw, origin)
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
	s.apps.InstanceChanges.Lock()
	defer s.apps.InstanceChanges.Unlock()
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
func (s *Server) appCatalogSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == "PUT" {
		var input struct {
			appcatalog.Catalog
			ConfirmTrust bool                `json:"confirm_trust"`
			Previous     *appcatalog.Catalog `json:"previous,omitempty"`
			UseDefaults  bool                `json:"use_defaults,omitempty"`
		}
		if !appInput(w, r, &input) {
			return
		}
		var err error
		if input.UseDefaults {
			var previous *appcatalog.Catalog
			if input.ConfirmTrust {
				previous = input.Previous
			}
			err = s.catalog.UseDefaults(previous)
		} else if input.ConfirmTrust && input.Previous != nil {
			err = s.catalog.ReplaceTrust(input.Catalog, *input.Previous)
		} else {
			err = s.catalog.Configure(input.Catalog)
		}
		if errors.Is(err, appcatalog.ErrTrustConfirmation) {
			writeError(w, 409, "catalog_confirmation_required", "Review and confirm the new catalog signing authority.")
			return
		}
		if errors.Is(err, appcatalog.ErrCatalogChanged) {
			writeError(w, 409, "catalog_changed", "Catalog settings changed. Reload them before confirming a new authority.")
			return
		}
		if err != nil {
			writeError(w, 400, "invalid_catalog", "Check the HTTPS URL and signing key. Cove could not save these catalog settings.")
			return
		}
	}
	writeJSON(w, 200, s.catalog.Settings())
}

func (s *Server) appCatalog(w http.ResponseWriter, r *http.Request) {
	var entries []appcatalog.Entry
	var err error
	if r.PathValue("publisher") != "" {
		bundled, _ := (appcatalog.Catalog{}).List(r.Context())
		for _, entry := range bundled {
			if entry.Publisher == r.PathValue("publisher") && entry.App == r.PathValue("app") && entry.Version == r.PathValue("version") {
				entries = []appcatalog.Entry{entry}
				break
			}
		}
	}
	if len(entries) == 0 {
		entries, err = s.catalog.List(r.Context())
	}
	if err != nil && len(entries) == 0 {
		writeError(w, 502, "catalog_unavailable", "The configured Mini App catalog could not be verified.")
		return
	}
	if r.PathValue("publisher") == "" {
		entries = slices.DeleteFunc(entries, func(e appcatalog.Entry) bool { return !miniapps.CompatibleHostVersion(e.MinHostVersion) })
		response := map[string]any{"packages": entries}
		if err != nil {
			response["warning"] = "The configured catalog is unavailable or could not be verified. Showing bundled releases."
		}
		writeJSON(w, 200, response)
		return
	}
	for _, e := range entries {
		if e.Publisher != r.PathValue("publisher") || e.App != r.PathValue("app") || e.Version != r.PathValue("version") {
			continue
		}
		if !miniapps.CompatibleHostVersion(e.MinHostVersion) {
			writeError(w, 409, "incompatible_host", "This package requires a newer Mini App host.")
			return
		}
		if r.Method == "POST" {
			var in struct {
				Digest           string `json:"digest"`
				CatalogAuthority string `json:"catalog_authority"`
			}
			if !appInput(w, r, &in) {
				return
			}
			if in.Digest != e.Digest || in.CatalogAuthority != e.CatalogAuthority {
				appReply(w, nil, miniapps.ErrConflict)
				return
			}
			release, err := s.apps.Install(r.Context(), e.Raw, e.ReleaseOrigin())
			appReply(w, release, err)
			return
		}
		if _, err := miniapps.Validate(e.Raw); err != nil {
			appReply(w, nil, err)
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

func (s *Server) appDeleteRelease(w http.ResponseWriter, r *http.Request) {
	s.apps.InstanceChanges.Lock()
	defer s.apps.InstanceChanges.Unlock()
	err := s.apps.RemoveRelease(r.Context(), r.PathValue("release"))
	if errors.Is(err, persistence.ErrAppReleaseInUse) {
		writeError(w, 409, "release_in_use", "An instance still uses this release. Keep it installed to preserve its data.")
		return
	}
	appReply(w, struct{}{}, err)
}
func (s *Server) appGlobalActivity(w http.ResponseWriter, r *http.Request) {
	if s.appStore == nil {
		writeError(w, 503, "unavailable", "Local activity is unavailable.")
		return
	}
	items, err := s.appStore.GlobalAppActivity(r.Context(), r.URL.Query().Get("instance"))
	if err == nil {
		for index := range items {
			if s.projectAppTask(items[index].InstanceID, persistence.AppTask{ID: items[index].Operation}).PendingSave {
				items[index].Status = "save_failed"
			}
		}
	}
	appReply(w, map[string]any{"activity": items}, err)
}
