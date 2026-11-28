package api

import (
	"errors"
	"io"
	"mime"
	"net/http"

	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
)

func (s *Server) appExport(w http.ResponseWriter, r *http.Request) {
	data, err := s.apps.Export(r.Context(), r.PathValue("id"))
	if err != nil {
		appReply(w, nil, err)
		return
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": data.App + ".covedata"}))
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, data)
}

func (s *Server) appRestore(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, miniapps.MaxBackupBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_backup", "Could not read the Mini App backup within its size limit.")
		return
	}
	instance, err := s.apps.Restore(r.Context(), raw)
	if errors.Is(err, miniapps.ErrBackupRelease) {
		writeError(w, http.StatusConflict, "missing_release", "Install the exact package version used by this backup. Official releases can come from the bundle or signed catalog. Personal releases require the original imported package.")
		return
	}
	appReply(w, instance, err)
}
