package providerconfig

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func TestMiniMaxApplicationErrorsPreserveSavedConnectionAndKey(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	t.Setenv("COVE_DATA_DIR", root)
	store, err := persistence.OpenSQLite(filepath.Join(root, "cove.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	secrets := credentials.NewMemoryStore()
	client := &http.Client{Transport: credentialRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != "https://api.minimax.cn/v1/chat/completions" {
			t.Fatal("unexpected MiniMax validation destination")
		}
		body := `{"base_resp":{"status_code":0}}`
		if key := request.Header.Get("Authorization"); key != "Bearer working-fixture-key" {
			body = fmt.Sprintf(`{"base_resp":{"status_code":%s}}`, strings.TrimPrefix(key, "Bearer rejected-fixture-"))
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	service := NewService(store, secrets, client)
	input := ProfileInput{Kind: provider.KindOpenAICompatible, Name: "MiniMax fixture", Endpoint: "https://api.minimax.cn/v1", AuthMethod: provider.AuthBearer, Model: "MiniMax-M3.1-Flash", Secret: "working-fixture-key"}
	profile, err := service.Configure(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	before, err := store.GetProviderProfile(ctx, profile.ID)
	if err != nil {
		t.Fatal(err)
	}
	input.ID = profile.ID
	for _, code := range []int{1004, 2049, 1008} {
		input.Secret = fmt.Sprintf("rejected-fixture-%d", code)
		input.Name = "Rejected replacement"
		if _, err := service.Configure(ctx, input); !errors.Is(err, ErrValidationFailed) {
			t.Fatalf("application error %d was saved: %v", code, err)
		}
		after, err := store.GetProviderProfile(ctx, profile.ID)
		if err != nil {
			t.Fatal(err)
		}
		if after != before {
			t.Fatal("failed validation changed the saved profile or credential reference")
		}
		_, secret, err := service.Resolve(ctx, profile.ID)
		if err != nil || secret.Value != "working-fixture-key" {
			t.Fatal("failed validation replaced the working key", err)
		}
		if _, err := service.Validate(ctx, ProfileInput{ID: profile.ID}); err != nil {
			t.Fatal("previous connection no longer validates", err)
		}
	}
}
