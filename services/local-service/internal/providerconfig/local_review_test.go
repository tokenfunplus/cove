package providerconfig

import (
	"context"
	"errors"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"testing"
)

type reviewLocalCatalog struct{}

func (reviewLocalCatalog) Profile() provider.Profile {
	return provider.Profile{ID: localProviderID, Kind: provider.KindLocal, Configured: true}
}
func (reviewLocalCatalog) Metadata() []provider.ModelMetadata {
	return []provider.ModelMetadata{{ID: "still-installed"}}
}
func TestResolvedLocalAdmissionChecksTheExactInstalledTarget(t *testing.T) {
	service := NewService(nil, nil, nil)
	service.SetLocalProvider(reviewLocalCatalog{})
	if err := service.CheckResolvedProfile(context.Background(), provider.Profile{ID: localProviderID, Model: "removed-model"}); !errors.Is(err, provider.ErrModelUnavailable) {
		t.Fatal("another installed model admitted a removed target", err)
	}
	if err := service.CheckResolvedProfile(context.Background(), provider.Profile{ID: localProviderID, Model: "still-installed"}); err != nil {
		t.Fatal("installed target rejected", err)
	}
}
func TestNormalizedProviderIdentityCannotReplaceTheManagedLocalProvider(t *testing.T) {
	service := NewService(nil, nil, nil)
	for _, id := range []string{"cove-local", " cove-local ", "\tcove-local\n"} {
		_, err := service.Configure(context.Background(), ProfileInput{ID: id, Kind: provider.KindOpenAICompatible, Name: "Reserved", Endpoint: "https://example.test/v1", Model: "model-a", AuthMethod: provider.AuthBearer})
		if !errors.Is(err, provider.ErrInvalidProfile) {
			t.Fatal("reserved normalized identity reached credential or persistence access", err)
		}
	}
}
