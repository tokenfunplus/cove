package chat

import (
	"context"
	"errors"
	"net"
	"net/url"
	"strings"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type appCatalogSource interface {
	ResolveCatalogAt(context.Context, string, string) (provider.Profile, credentials.Secret, []provider.ModelMetadata, error)
}

func (s *Service) resolveAppTarget(ctx context.Context, in AppTaskInput) (resolvedTarget, error) {
	var target resolvedTarget
	if source, ok := s.profiles.(appCatalogSource); ok {
		profile, secret, models, err := source.ResolveCatalogAt(ctx, in.ProviderID, in.Destination)
		if errors.Is(err, persistence.ErrProviderProfileChanged) {
			return target, ErrAppDestination
		}
		if err != nil {
			return target, err
		}
		for _, model := range models {
			if model.ID == in.ModelID {
				profile.Model = in.ModelID
				return resolvedTarget{profile: profile, secret: secret, metadata: model}, nil
			}
		}
		return target, provider.ErrModelUnavailable
	}
	// In-process provider sources may omit catalog discovery.
	profile, _, err := s.profiles.Resolve(ctx, in.ProviderID)
	if err != nil {
		return target, err
	}
	if profile.Endpoint != in.Destination {
		return target, ErrAppDestination
	}
	connections, err := s.resolveTargets(ctx, []persistence.ActiveModelTarget{{ProviderID: in.ProviderID, ModelID: in.ModelID}})
	if err != nil {
		return target, err
	}
	return connections[0], nil
}

// AppDestinationRemote distinguishes explicit loopback targets from external model destinations.
func AppDestinationRemote(destination string) bool {
	parsed, err := url.Parse(destination)
	if err != nil || parsed.Hostname() == "" {
		return true
	}
	host := parsed.Hostname()
	return !strings.EqualFold(host, "localhost") && !net.ParseIP(host).IsLoopback()
}
