package api

import (
	"io"
	"mime"
	"net/http"

	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func (s *Server) appBlobs(w http.ResponseWriter, r *http.Request) {
	ctx, id, key := r.Context(), r.PathValue("id"), r.PathValue("blob")
	switch {
	case r.Method == "POST":
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, miniapps.MaxBlobBytes))
		if err != nil {
			appReply(w, nil, miniapps.ErrInvalid)
			return
		}
		item := persistence.MiniAppBlob{ID: r.URL.Query().Get("id"), Name: r.URL.Query().Get("name"), Size: len(data), Data: data}
		err = s.apps.ImportBlob(ctx, id, item)
		item.Data = nil
		appReply(w, item, err)
	case r.Method == "DELETE":
		appReply(w, struct{}{}, s.apps.DeleteBlob(ctx, id, key))
	case key == "":
		list, err := s.apps.Blobs(ctx, id)
		appReply(w, map[string]any{"attachments": list}, err)
	default:
		b, err := s.apps.Blob(ctx, id, key)
		if err != nil {
			appReply(w, nil, err)
			return
		}
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": b.Name}))
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(b.Data)
	}
}
