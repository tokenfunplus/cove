package api

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/tokenfunplus/cove/services/local-service/internal/appcatalog"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
)

// A file can acquire catalog provenance only by matching independently trusted bytes.
func (s *Server) fileOrigin(r *http.Request, raw []byte) (string, error) {
	candidate, err := miniapps.Preview(raw, "builtin")
	if err != nil {
		return "", err
	}
	ctx := r.Context()
	reserved := appcatalog.ReservedPublisher(candidate.Package.Publisher) || s.catalog.KnownPublisher(candidate.Package.Publisher)
	if appcatalog.IsLegacyRelease(candidate.Package.Publisher, candidate.Package.App, candidate.Package.Version, candidate.Digest) {
		return "builtin", nil
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
			if e.Origin == "catalog" && e.CatalogAuthority == "" {
				continue
			}
			return e.DistributionOrigin(), nil
		}
	}
	if origin, ok := s.catalog.KnownReleaseOrigin(candidate.Digest); ok {
		return origin, nil
	}
	if s.catalog.Config().URL != "" {
		entries, err := s.catalog.ListForRelease(ctx, candidate.Digest)
		if errors.Is(err, appcatalog.ErrCatalogChanged) {
			return "", miniapps.ErrConflict
		}
		for _, e := range entries {
			if e.Publisher == candidate.Package.Publisher {
				reserved = true
			}
			if candidate.Digest == e.Digest {
				return e.ReleaseOrigin(), nil
			}
		}
	}
	if reserved && (!personalLine || candidate.Package.Publisher == "cove") {
		return "", fmt.Errorf("%w: this publisher is reserved for verified releases", miniapps.ErrInvalid)
	}
	return "local", nil
}
