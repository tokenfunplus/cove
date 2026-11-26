package providerconfig

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type unusedLocalSecrets struct{ t *testing.T }

func (s unusedLocalSecrets) Exists(context.Context, string) (bool, error) {
	s.t.Fatal("keyless connection accessed the Secret Store")
	return false, nil
}
func (s unusedLocalSecrets) Get(context.Context, string) (credentials.Secret, error) {
	s.t.Fatal("keyless connection read a secret")
	return credentials.Secret{}, nil
}
func (s unusedLocalSecrets) ReplaceAfterValidation(context.Context, string, credentials.SecretVersion, credentials.Secret) error {
	s.t.Fatal("keyless connection wrote a secret")
	return nil
}
func (s unusedLocalSecrets) Delete(context.Context, string) error {
	s.t.Fatal("keyless connection deleted a secret")
	return nil
}

func TestKeylessLocalServiceSurvivesSaveReopenDiscoveryAndStreaming(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	t.Setenv("COVE_DATA_DIR", root)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Header.Get("Authorization") != "" || r.Header.Get("X-API-Key") != "" {
			t.Error("keyless request sent authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/models" {
			io.WriteString(w, `{"data":[{"id":"local-fixture"}]}`)
			return
		}
		if r.URL.Path != "/v1/chat/completions" {
			t.Error("incorrect local API route")
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if payload["stream"] == true {
			w.Header().Set("Content-Type", "text/event-stream")
			io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"local answer\"}}]}\n\ndata: [DONE]\n\n")
		} else {
			io.WriteString(w, `{}`)
		}
	}))
	defer server.Close()
	database := filepath.Join(root, "cove.sqlite")
	store, err := persistence.OpenSQLite(database)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store, unusedLocalSecrets{t}, server.Client())
	input := ProfileInput{Kind: provider.KindOpenAICompatible, Name: "Local fixture", Endpoint: server.URL + "/v1", Model: "local-fixture", AuthMethod: provider.AuthNone}
	if _, err := service.Validate(ctx, input); err != nil {
		t.Fatal(err)
	}
	profile, err := service.Configure(ctx, input)
	if err != nil || !profile.Configured || profile.RuntimeLocation != "User local service" {
		t.Fatal("keyless service did not save as configured", err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = persistence.OpenSQLite(database)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service = NewService(store, unusedLocalSecrets{t}, server.Client())
	profiles, err := service.List(ctx)
	if err != nil || len(profiles) != 1 || !profiles[0].Configured {
		t.Fatal("keyless configuration did not survive reopening", err)
	}
	resolved, secret, metadata, err := service.ResolveCatalog(ctx, profile.ID)
	if err != nil || secret.Value != "" || len(metadata) != 1 || metadata[0].ID != input.Model {
		t.Fatal("keyless service did not resolve its live model catalog", err)
	}
	stream, err := provider.NewHTTPAdapter(server.Client()).Stream(ctx, provider.CompletionInput{Profile: resolved, Messages: []provider.ProviderMessage{{Role: "user", Content: "Synthetic question"}}})
	if err != nil {
		t.Fatal(err)
	}
	var reply strings.Builder
	for {
		event, err := stream.Recv(ctx)
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		reply.WriteString(event.Delta)
	}
	stream.Close()
	if reply.String() != "local answer" || requests.Load() < 6 {
		t.Fatal("keyless local chat did not stream")
	}
	if err := service.Delete(ctx, profile.ID); err != nil {
		t.Fatal("keyless removal accessed credentials or failed", err)
	}
}
