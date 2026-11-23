package localmodels

import (
	"context"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func unixFixture(t *testing.T, handler http.Handler) (string, *http.Client) {
	t.Helper()
	directory, err := os.MkdirTemp("/tmp", "cove-worker-test-")
	if err != nil {
		t.Fatal(err)
	}
	socket := filepath.Join(directory, "worker.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		os.RemoveAll(directory)
		t.Fatal(err)
	}
	server := &http.Server{Handler: handler}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); os.RemoveAll(directory) })
	return directory, workerClient(socket)
}

func TestWorkerTransportNeverSendsCredentialsToTCPNeighborsOrRedirects(t *testing.T) {
	var contacted atomic.Int32
	neighbor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { contacted.Add(1); w.WriteHeader(200) }))
	defer neighbor.Close()
	directory, client := unixFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Error("lost private worker authorization")
		}
		if r.URL.Path == "/redirect" {
			w.Header().Set("Location", neighbor.URL)
			w.WriteHeader(302)
			return
		}
		w.Write([]byte("private worker response"))
	}))
	defer client.CloseIdleConnections()
	for _, path := range []string{"/health", "/redirect"} {
		request, _ := http.NewRequest("GET", neighbor.URL+path, nil)
		request.Header.Set("Authorization", "Bearer fixture-key")
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
	}
	if err := os.Remove(filepath.Join(directory, "worker.sock")); err != nil {
		t.Fatal(err)
	}
	client.CloseIdleConnections()
	request, _ := http.NewRequest("GET", neighbor.URL+"/health", nil)
	request.Header.Set("Authorization", "Bearer fixture-key")
	if _, err := client.Do(request); err == nil {
		t.Fatal("missing private socket fell back to TCP")
	}
	if contacted.Load() != 0 {
		t.Fatal("worker key or traffic reached an unrelated TCP listener")
	}
}

func TestEmbeddingDeadlineCoversHeadersAndBodyAndReleasesLease(t *testing.T) {
	for _, body := range []bool{false, true} {
		t.Run(map[bool]string{false: "headers", true: "body"}[body], func(t *testing.T) {
			directory, client := unixFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if body {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(200)
					io.WriteString(w, `{"data":[`)
					w.(http.Flusher).Flush()
				}
				<-r.Context().Done()
			}))
			manager := New(t.TempDir(), "unused")
			defer manager.Close()
			manager.embeddingTimeout = 30 * time.Millisecond
			command := exec.Command("/bin/sleep", "30")
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			worker := &worker{command: command, done: make(chan struct{}), client: client, directory: directory, endpoint: "http://127.0.0.1", key: "fixture"}
			go func() { command.Wait(); close(worker.done) }()
			manager.workers[EmbeddingID] = worker
			start := time.Now()
			if _, err := manager.Embed(context.Background(), []string{"bounded input"}); err == nil {
				t.Fatal("stalled embedding succeeded")
			}
			if time.Since(start) > time.Second {
				t.Fatal("embedding did not respect its finite deadline")
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if err := manager.acquire(ctx); err != nil {
				t.Fatal("timeout retained inference lease", err)
			}
			manager.release()
			select {
			case <-worker.done:
			default:
				t.Fatal("timed-out worker remains alive")
			}
		})
	}
}

func TestRoutedChatPreservesThePrivateWorkerTransport(t *testing.T) {
	directory, client := unixFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Error("lost private authorization")
		}
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected worker path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"local reply\"}}]}\n\ndata: [DONE]\n\n")
	}))
	manager := New(t.TempDir(), "unused")
	defer manager.Close()
	command := exec.Command("/bin/sleep", "30")
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	w := &worker{command: command, done: make(chan struct{}), client: client, directory: directory, endpoint: "http://127.0.0.1:1", key: "fixture-key"}
	go func() { command.Wait(); close(w.done) }()
	manager.workers[ChatID] = w
	stream, err := (RoutedProvider{Local: manager}).Stream(context.Background(), provider.CompletionInput{Profile: provider.Profile{ID: ProviderID, Kind: provider.KindLocal, Name: "Fixture", Model: ChatID, AuthMethod: provider.AuthBearer}, Messages: []provider.ProviderMessage{{Role: "user", Content: "Private input"}}})
	if err != nil {
		t.Fatal("private chat transport failed", err)
	}
	defer stream.Close()
	var body string
	for {
		event, err := stream.Recv(context.Background())
		if err != nil {
			if err == io.EOF {
				break
			}
			t.Fatal(err)
		}
		body += event.Delta
		if event.Type == provider.EventCompleted {
			break
		}
	}
	if body != "local reply" {
		t.Fatalf("private chat response lost: %q", body)
	}
}

func TestSwitchingModelsRetainsOnlyTheCurrentInferenceWorker(t *testing.T) {
	manager := New(t.TempDir(), "unused")
	defer manager.Close()
	for _, id := range []string{EmbeddingID, ChatID} {
		command := exec.Command("/bin/sleep", "30")
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		w := &worker{command: command, done: make(chan struct{}), client: &http.Client{}, directory: t.TempDir()}
		go func() { command.Wait(); close(w.done) }()
		manager.workers[id] = w
	}
	previous := manager.workers[EmbeddingID]
	current, err := manager.startWorker(context.Background(), ChatID)
	if err != nil || current != manager.workers[ChatID] || len(manager.workers) != 1 {
		t.Fatal("model switch retained another inference worker", err)
	}
	select {
	case <-previous.done:
	default:
		t.Fatal("previous model process remained resident")
	}
	if _, err = os.Stat(previous.directory); !os.IsNotExist(err) {
		t.Fatal("previous worker files retained")
	}
}
