package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/api"
	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"github.com/tokenfunplus/cove/services/local-service/internal/providerconfig"
	localruntime "github.com/tokenfunplus/cove/services/local-service/internal/runtime"
	"github.com/tokenfunplus/cove/services/local-service/internal/websearch"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--extract-pdf" {
		if err := documents.RunWorker(os.Stdin, os.Stdout); err != nil {
			os.Exit(1)
		}
		return
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "cove-local-service:", err)
		os.Exit(1)
	}
}

func run() error {
	defaultListener := localruntime.DefaultListenerConfig()
	var preferredPort int
	var recoveryStart int
	var recoveryEnd int
	var controlToken string
	var insecureFileSecretStore bool
	var dataDirectory string
	flag.IntVar(&preferredPort, "port", defaultListener.PreferredPort, "preferred loopback port")
	flag.IntVar(&recoveryStart, "port-range-start", defaultListener.RecoveryStart, "first port used after a conflict")
	flag.IntVar(&recoveryEnd, "port-range-end", defaultListener.RecoveryEnd, "last port used after a conflict")
	flag.StringVar(&controlToken, "control-token", "", "Launcher-only control token")
	flag.BoolVar(&insecureFileSecretStore, "insecure-file-secret-store", false, "store Provider Keys in an owner-only test file instead of macOS Keychain")
	flag.StringVar(&dataDirectory, "data-dir", os.Getenv("COVE_DATA_DIR"), "application data directory (defaults to ~/Library/Application Support/cove)")
	flag.Parse()
	if controlToken == "" {
		return errors.New("--control-token is required")
	}

	security := localsecurity.New(nil, nil)
	launchToken, err := security.MintLaunchToken()
	if err != nil {
		return err
	}
	listener, err := localruntime.Listen(localruntime.ListenerConfig{
		PreferredPort: preferredPort,
		RecoveryStart: recoveryStart,
		RecoveryEnd:   recoveryEnd,
	})
	if err != nil {
		return err
	}
	defer listener.Close()

	var shutdownOnce sync.Once
	httpServer := &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	applicationDataDirectory, err := applicationDataDirectoryPath(dataDirectory)
	if err != nil {
		return err
	}
	storePath := filepath.Join(applicationDataDirectory, "cove.sqlite")
	store, err := persistence.OpenSQLite(storePath)
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.RecoverInterruptedGenerations(context.Background()); err != nil {
		return err
	}
	var secretStore credentials.SecretStore = credentials.NewKeychainStore("io.github.tokenfunplus.cove.provider")
	if insecureFileSecretStore {
		fmt.Fprintln(os.Stderr, "WARNING: insecure test mode stores Provider Keys as plaintext in the application data directory.")
		secretStore = credentials.NewFileStore(filepath.Join(applicationDataDirectory, "insecure-test-provider-secrets.json"))
	}
	providerSetup := providerconfig.NewService(store, secretStore, nil)
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	chatService := chat.NewServiceWithSettings(store, providerSetup, provider.NewHTTPAdapter(nil), store)
	searchService := websearch.NewService(store, secretStore, nil)
	chatService.SetWebSearchService(searchService)
	shutdownDone := make(chan struct{})
	shutdown := func() {
		shutdownOnce.Do(func() {
			go func() {
				defer close(shutdownDone)
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_ = httpServer.Shutdown(ctx)
			}()
		})
	}
	requestContext, cancelRequests := context.WithCancel(context.Background())
	httpServer.BaseContext = func(net.Listener) context.Context { return requestContext }
	var handlers sync.WaitGroup
	var admission sync.Mutex
	closing := false
	defer func() {
		admission.Lock()
		closing = true
		admission.Unlock()
		cancelRequests()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = chatService.PauseDebatesForShutdown(ctx)
		shutdown()
		<-shutdownDone
		_ = httpServer.Close()
		handlers.Wait()
	}()
	chatService.SetDocumentParser(documents.ProcessParser(executable))
	localAPI := api.NewServer(api.Config{SearchService: searchService,
		Security:      security,
		ControlToken:  controlToken,
		Store:         store,
		Settings:      store,
		Chat:          chatService,
		ProviderSetup: providerSetup,
		NearAIProxy:   provider.NewNearAIProxy(providerSetup, nil),
		Shutdown:      shutdown,
	})
	handler := localAPI.Handler()
	httpServer.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		admission.Lock()
		if closing {
			admission.Unlock()
			http.Error(w, "The Local Service is shutting down.", http.StatusServiceUnavailable)
			return
		}
		handlers.Add(1)
		admission.Unlock()
		defer handlers.Done()
		handler.ServeHTTP(w, r)
	})

	if err := localruntime.WriteReadiness(os.Stdout, listener.Addr(), launchToken); err != nil {
		return err
	}

	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(interrupt)
	go func() {
		select {
		case <-interrupt:
			shutdown()
		case <-requestContext.Done():
		}
	}()

	if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve: %w", err)
	}
	return nil
}

func applicationDataDirectoryPath(configured string) (string, error) {
	if configured != "" {
		return filepath.Abs(configured)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, "Library", "Application Support", "cove"), nil
}
