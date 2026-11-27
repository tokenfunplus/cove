package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/api"
	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"github.com/tokenfunplus/cove/services/local-service/internal/providerconfig"
	"github.com/tokenfunplus/cove/services/local-service/internal/webassets"
)

type browserFixture struct {
	Steps         []scenarioStep `json:"steps"`
	ModelResponse string         `json:"model_response"`
}

func browserCommand(file string, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("preview", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	path := flags.String("fixture", "", "scenario fixture")
	endpoint := flags.String("model-endpoint", "", "real loopback model endpoint")
	allow := flags.String("allow", "", "enable the package's attachment file chooser")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New(usage)
	}
	if *allow != "" && *allow != "blobs.import" {
		return errors.New("--allow accepts blobs.import")
	}
	raw, err := readBounded(file)
	if err != nil {
		return err
	}
	var fixture browserFixture
	if *path != "" {
		if err := readFixture(*path, &fixture); err != nil {
			return err
		}
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	return servePreview(ctx, raw, fixture, *allow, *endpoint, out, func(ctx context.Context, address string) error {
		opener := "open"
		if runtime.GOOS != "darwin" {
			opener = "xdg-open"
		}
		if exec.CommandContext(ctx, opener, address).Run() != nil {
			return errors.New("could not open the preview in the default browser")
		}
		return nil
	})
}

func servePreview(ctx context.Context, raw []byte, fixture browserFixture, allow, endpoint string, out io.Writer, openBrowser func(context.Context, string) error) error {
	pkg, err := miniapps.Validate(raw)
	if err != nil {
		return err
	}
	if _, err := fs.Stat(webassets.Files(), "assets"); err != nil {
		return errors.New("browser assets unavailable: run make build-web and rebuild coveapp")
	}
	grants := []string{}
	for _, capability := range pkg.Capabilities {
		if slices.Contains([]string{"records.query", "records.commit", "chat.attach", "ai.generate"}, capability) || capability == allow {
			grants = append(grants, capability)
		}
	}
	if allow != "" && !slices.Contains(grants, allow) {
		return errors.New("the package does not declare the requested capability")
	}
	if endpoint != "" && !slices.Contains(grants, "ai.generate") {
		return errors.New("the package does not declare ai.generate")
	}
	model, err := newPreviewModel(endpoint, fixture.ModelResponse)
	if err != nil {
		return err
	}
	defer model.Close()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		return err
	}
	defer store.Close()
	return withWorkspace(store, raw, grants, func(w workspace, pkg miniapps.Package) error {
		if err := w.runSteps(pkg, fixture.Steps, 0, out); err != nil {
			return err
		}
		client := &http.Client{Transport: model, Timeout: 2 * time.Minute}
		setup := providerconfig.NewService(store, credentials.NewMemoryStore(), client)
		if slices.Contains(grants, "ai.generate") {
			if _, err := setup.Configure(ctx, provider.ProfileInput{Kind: provider.KindOpenAICompatible, Name: model.name, Endpoint: model.endpoint.String(), AuthMethod: provider.AuthNone}); err != nil {
				return fmt.Errorf("preview model setup: %w", err)
			}
		}
		chatService := chat.NewServiceWithSettings(store, setup, provider.NewHTTPAdapter(client), store)
		defer chatService.StopAppTask("", "")
		security := localsecurity.New(nil, nil)
		handler := api.NewServer(api.Config{Store: store, Settings: store, Security: security, ProviderSetup: setup, Chat: chatService}).Handler()
		listener, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			return err
		}
		defer listener.Close()
		server := &http.Server{ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, Handler: previewRoutes(handler, allow)}
		stopped := make(chan error, 1)
		go func() { stopped <- server.Serve(listener) }()
		defer func() {
			done, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if server.Shutdown(done) != nil {
				_ = server.Close()
			}
		}()
		proof, err := security.MintLaunchToken()
		if err != nil {
			return err
		}
		query := url.Values{"intent": {"apps"}, "instance": {w.id}, "view": {pkg.Pages[0].ID}, "token": {proof}}
		address := "http://" + listener.Addr().String()
		if err := openBrowser(ctx, address+"/launch?"+query.Encode()); err != nil {
			return err
		}
		fmt.Fprintf(out, "Previewing %s %s in a disposable workspace. Press Ctrl-C to close it.\n", pkg.Name, pkg.Version)
		select {
		case <-ctx.Done():
			return nil
		case err := <-stopped:
			return err
		}
	})
}

// The preview supports app commands, local chat drafts, and discovery of its
// configured model. Host management, native IPC and non-opted-in files stay out.
func previewRoutes(next http.Handler, allow string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		allowed := false
		switch {
		case path == "/api/mini-apps/catalog-settings":
			allowed = r.Method == http.MethodGet
		case strings.HasPrefix(path, "/api/mini-apps/"):
			parts := strings.Split(strings.TrimPrefix(path, "/api/mini-apps/"), "/")
			allowed = len(parts) < 3 || (parts[2] != "files" && (parts[2] != "blobs" || allow == "blobs.import"))
		case path == "/api/conversations":
			allowed = r.Method == http.MethodGet || r.Method == http.MethodPost
		case r.Method == http.MethodGet:
			allowed = path == "/api/session" || path == "/api/settings" || path == "/api/models" || path == "/api/projects" ||
				strings.HasPrefix(path, "/api/conversations/") || strings.HasPrefix(path, "/api/models/") ||
				(!strings.HasPrefix(path, "/api/") && !strings.HasPrefix(path, "/internal/"))
		}
		if !allowed {
			message := "This operation is unavailable in the author preview."
			if strings.HasPrefix(path, "/api/conversations/") || strings.HasPrefix(path, "/api/settings") ||
				strings.HasPrefix(path, "/api/models") || path == "/api/mini-apps/catalog-settings" {
				message = "Author preview supports Chat drafts and app-owned model tasks. Open the app in Cove to send a conversation turn or change settings."
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(api.ErrorEnvelope{Error: api.APIError{
				Code: "author_preview_only", Message: message, RequestID: "local",
			}})
			return
		}
		next.ServeHTTP(w, r)
	})
}
