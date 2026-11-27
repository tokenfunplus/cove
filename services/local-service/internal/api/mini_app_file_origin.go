package api

import (
	"fmt"
	"github.com/tokenfunplus/cove/services/local-service/internal/appcatalog"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"net/http"
)

// A file can acquire catalog provenance only by matching independently trusted bytes.
func (s *Server) fileOrigin(r *http.Request, raw []byte) (string, error) {
	candidate, err := miniapps.Preview(raw, "builtin")
	if err != nil {
		return "", err
	}
	ctx := r.Context()
	reserved := candidate.Package.Publisher == "cove" || s.catalog.KnownPublisher(candidate.Package.Publisher)
	bundled, err := (appcatalog.Catalog{}).List(ctx)
	if err != nil {
		return "", err
	}
	for _, e := range bundled {
		if e.Publisher != candidate.Package.Publisher {
			continue
		}
		reserved = true
		if e.Digest == candidate.Digest {
			return e.Origin, nil
		}
	}
	releases, err := s.apps.Releases(ctx)
	if err != nil {
		return "", err
	}
	personalLine := false
	for _, e := range releases {
		if e.Package.Publisher != candidate.Package.Publisher {
			continue
		}
		if e.Origin == "local" {
			if e.Package.App == candidate.Package.App {
				personalLine = true
			}
			continue
		}
		reserved = true
		if e.Digest == candidate.Digest {
			return e.Origin, nil
		}
	}
	if s.catalog.KnownRelease(candidate.Digest) {
		return "catalog", nil
	}
	if s.catalog.Config().URL != "" {
		entries, _ := s.catalog.List(ctx)
		for _, e := range entries {
			if e.Publisher == candidate.Package.Publisher {
				reserved = true
			}
			if candidate.Digest == e.Digest {
				return e.Origin, nil
			}
		}
	}
	if reserved && !personalLine {
		return "", fmt.Errorf("%w: this publisher is reserved for verified releases", miniapps.ErrInvalid)
	}
	return "local", nil
}
