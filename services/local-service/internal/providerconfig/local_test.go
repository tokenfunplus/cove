package providerconfig

import (
	"context"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type localFixtureProvider struct{}

func (localFixtureProvider) Profile() provider.Profile {
	p, _ := provider.NormalizeProfile(provider.Profile{ID: localProviderID, Kind: provider.KindLocal, Name: "On this Mac", Endpoint: "http://127.0.0.1", AuthMethod: provider.AuthBearer})
	p.Configured = true
	return p
}
func (localFixtureProvider) Metadata() []provider.ModelMetadata {
	return []provider.ModelMetadata{{ID: "local-fixture"}}
}

func TestManagedLocalProviderHasNoSecretAndCannotBeReconfigured(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store, credentials.NewMemoryStore(), nil)
	service.SetLocalProvider(localFixtureProvider{})
	profile, secret, metadata, err := service.ResolveCatalog(ctx, localProviderID)
	if err != nil {
		t.Fatal(err)
	}
	if profile.Kind != provider.KindLocal || secret.Value != "" || len(metadata) != 1 {
		t.Fatal("local resolution required a secret or lost its catalog")
	}
	if _, err = service.Discover(ctx, ProfileInput{ID: localProviderID}); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Configure(ctx, ProfileInput{ID: localProviderID, Kind: provider.KindOpenAICompatible, Endpoint: "https://other.example", AuthMethod: provider.AuthBearer}); err == nil {
		t.Fatal("managed local identity was reconfigured")
	}
}
