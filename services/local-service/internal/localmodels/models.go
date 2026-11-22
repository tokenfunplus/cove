// Package localmodels manages pinned model downloads and private inference workers.
package localmodels

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

const EmbeddingID = "bge-small-zh"
const ChatID = "qwen-small-chat"
const Qwen3AbliteratedID = "qwen3-abliterated-chat"
const RuntimeVersion = "b12606"

type Model struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Revision string `json:"revision"`
	SHA256   string `json:"sha256"`
	Bytes    int64  `json:"bytes"`
	URL      string `json:"source_url"`
	Filename string `json:"filename"`
}

var Registry = []Model{
	{ID: EmbeddingID, Name: "BGE Small Chinese v1.5", Role: "embedding", Revision: "5bf683e6a1bd454bbb60ba051088c50731d63fcb", SHA256: "5a88d266870fbd27c6f329df60de80e2d4cf3bbd5e6f080bd5c1b2e5abb12039", Bytes: 26472640, Filename: "bge-small-zh-v1.5-q8_0.gguf", URL: "https://huggingface.co/CompendiumLabs/bge-small-zh-v1.5-gguf/resolve/5bf683e6a1bd454bbb60ba051088c50731d63fcb/bge-small-zh-v1.5-q8_0.gguf"},
	{ID: ChatID, Name: "Qwen2.5 0.5B Instruct", Role: "chat", Revision: "9217f5db79a29953eb74d5343926648285ec7e67", SHA256: "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db", Bytes: 491400032, Filename: "qwen2.5-0.5b-instruct-q4_k_m.gguf", URL: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/9217f5db79a29953eb74d5343926648285ec7e67/qwen2.5-0.5b-instruct-q4_k_m.gguf"},
	{ID: Qwen3AbliteratedID, Name: "Qwen3 0.6B Abliterated Q5_K_M", Role: "chat", Revision: "92351f431cfdd36f71149aaf072a6490a68e144e", SHA256: "5f850d7369a02a318da85cf9b5deac9ab3f2f1cfe01f4ba48b68f6f7a72db87b", Bytes: 444415104, Filename: "qwen3-0.6b-abliterated.q5_k_m.gguf", URL: "https://huggingface.co/mlabonne/Qwen3-0.6B-abliterated-GGUF/resolve/92351f431cfdd36f71149aaf072a6490a68e144e/qwen3-0.6b-abliterated.q5_k_m.gguf"},
}

func IsChatModel(id string) bool {
	model, err := Lookup(id)
	return err == nil && model.Role == "chat"
}

type Status struct {
	Model
	State          string `json:"state"`
	Downloaded     int64  `json:"downloaded_bytes"`
	Error          string `json:"error,omitempty"`
	RuntimeReady   bool   `json:"runtime_ready"`
	RuntimeVersion string `json:"runtime_version"`
}
type download struct {
	cancel context.CancelFunc
	done   chan struct{}
	status Status
}
type Manager struct {
	files      persistence.ModelFiles
	executable string
	client     *http.Client
	workerHTTP *http.Client
	adapter    *provider.HTTPAdapter
	mu         sync.Mutex
	mutations  sync.Mutex
	jobs       map[string]*download
	gate       chan struct{}
	workers    map[string]*worker
	lifetime   context.Context
	cancel     context.CancelFunc
	metrics    map[string]Measurement
}

func Lookup(id string) (Model, error) {
	for _, m := range Registry {
		if m.ID == id {
			return m, nil
		}
	}
	return Model{}, errors.New("This model is not available for local installation.")
}

func New(root, executable string) *Manager {
	ctx, cancel := context.WithCancel(context.Background())
	transport := http.DefaultTransport.(*http.Transport).Clone()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Minute, CheckRedirect: func(request *http.Request, via []*http.Request) error {
		host := request.URL.Hostname()
		if len(via) > 8 || request.URL.Scheme != "https" || !(host == "huggingface.co" || strings.HasSuffix(host, ".hf.co") || strings.HasSuffix(host, ".huggingface.co")) {
			return errors.New("The model host redirected to an unsupported destination.")
		}
		return nil
	}}
	manager := &Manager{files: persistence.ModelFiles{Root: filepath.Join(root, "models")}, executable: executable, client: client, jobs: map[string]*download{}, gate: make(chan struct{}, 1), workers: map[string]*worker{}, lifetime: ctx, cancel: cancel, metrics: map[string]Measurement{}}
	manager.workerHTTP = workerClient()
	manager.adapter = provider.NewHTTPAdapter(manager.workerHTTP)
	go manager.reapIdle()
	return manager
}

func DefaultRuntime(executable string) string {
	if override := os.Getenv("COVE_INFERENCE_RUNTIME"); override != "" {
		return override
	}
	return filepath.Join(filepath.Dir(executable), "inference", "llama-server")
}

// PlatformSupported reports whether the host meets the bundled runtime minimum.
func PlatformSupported() bool { return platformSupported() }

func (manager *Manager) RuntimeReady() bool {
	if !platformSupported() {
		return false
	}
	info, err := os.Stat(manager.executable)
	return err == nil && info.Mode().IsRegular() && info.Mode()&0111 != 0
}
func (manager *Manager) Statuses() []Status {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	result := make([]Status, 0, len(Registry))
	for _, m := range Registry {
		s := Status{Model: m, State: "not_installed", RuntimeReady: manager.RuntimeReady(), RuntimeVersion: RuntimeVersion}
		if manager.files.Installed(m.ID, m.SHA256, m.Bytes) {
			s.State = "installed"
			s.Downloaded = m.Bytes
		}
		if job := manager.jobs[m.ID]; job != nil && job.status.State != "installed" {
			s.State = job.status.State
			s.Downloaded = job.status.Downloaded
			s.Error = job.status.Error
		}
		result = append(result, s)
	}
	return result
}
func (manager *Manager) Installed(id string) bool {
	m, err := Lookup(id)
	return err == nil && manager.files.Installed(id, m.SHA256, m.Bytes)
}
func (manager *Manager) Install(id string) error {
	manager.mutations.Lock()
	defer manager.mutations.Unlock()
	m, err := Lookup(id)
	if err != nil {
		return err
	}
	if !manager.RuntimeReady() {
		return errors.New("The bundled inference runtime is unavailable. Rebuild Cove with its inference runtime.")
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if job := manager.jobs[id]; job != nil && job.status.State == "downloading" {
		return nil
	}
	if manager.Installed(id) {
		return nil
	}
	ctx, cancel := context.WithTimeout(manager.lifetime, 10*time.Minute)
	job := &download{cancel: cancel, done: make(chan struct{}), status: Status{Model: m, State: "downloading"}}
	manager.jobs[id] = job
	go func() {
		defer close(job.done)
		defer cancel()
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, m.URL, nil)
		if err == nil {
			var response *http.Response
			response, err = manager.client.Do(request)
			if err == nil {
				defer response.Body.Close()
				if response.StatusCode != 200 {
					err = fmt.Errorf("The model host could not serve this download (HTTP %d).", response.StatusCode)
				} else {
					err = manager.files.Install(ctx, id, m.SHA256, m.Bytes, response.Body, func(n int64) { manager.mu.Lock(); job.status.Downloaded = n; manager.mu.Unlock() })
				}
			}
		}
		manager.mu.Lock()
		defer manager.mu.Unlock()
		job.status.State = "installed"
		if err != nil {
			job.status.State = "failed"
			cause := err
			var remote *url.Error
			if errors.As(err, &remote) {
				cause = remote.Err
			}
			job.status.Error = "Model download failed: " + cause.Error()
			if ctx.Err() != nil {
				job.status.State = "not_installed"
				job.status.Error = ""
			}
		}
	}()
	return nil
}
func (manager *Manager) CancelDownload(ctx context.Context, id string) error {
	manager.mutations.Lock()
	defer manager.mutations.Unlock()
	return manager.cancelDownload(ctx, id)
}
func (manager *Manager) cancelDownload(ctx context.Context, id string) error {
	manager.mu.Lock()
	job := manager.jobs[id]
	if job != nil {
		job.cancel()
	}
	manager.mu.Unlock()
	if job != nil {
		select {
		case <-job.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}
func (manager *Manager) Remove(ctx context.Context, id string) error {
	manager.mutations.Lock()
	defer manager.mutations.Unlock()
	m, err := Lookup(id)
	if err != nil {
		return err
	}
	if err = manager.cancelDownload(ctx, id); err != nil {
		return err
	}
	if err = manager.acquire(ctx); err != nil {
		return err
	}
	defer manager.release()
	manager.stopWorker(id)
	if err = manager.files.Remove(id, m.SHA256); err != nil {
		return err
	}
	manager.mu.Lock()
	delete(manager.jobs, id)
	manager.mu.Unlock()
	return nil
}
func (manager *Manager) acquire(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case manager.gate <- struct{}{}:
		if err := ctx.Err(); err != nil {
			manager.release()
			return err
		}
		if manager.lifetime.Err() != nil {
			manager.release()
			return errors.New("Local inference has stopped.")
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-manager.lifetime.Done():
		return errors.New("Local inference has stopped.")
	}
}
func (manager *Manager) release() { <-manager.gate }
func (manager *Manager) Close() {
	defer manager.workerHTTP.CloseIdleConnections()
	defer manager.client.CloseIdleConnections()
	manager.cancel()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, m := range Registry {
		_ = manager.CancelDownload(ctx, m.ID)
	}
	select {
	case manager.gate <- struct{}{}:
		defer manager.release()
		for id := range manager.workers {
			manager.stopWorker(id)
		}
	case <-ctx.Done():
	}
}

func (manager *Manager) reapIdle() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-manager.lifetime.Done():
			return
		case <-ticker.C:
			select {
			case manager.gate <- struct{}{}:
				for id, w := range manager.workers {
					if time.Since(w.lastUsed) > 2*time.Minute {
						manager.stopWorker(id)
					}
				}
				manager.release()
			default:
			}
		}
	}
}

type Measurement struct {
	LoadMS            int64 `json:"load_ms"`
	PeakResidentBytes int64 `json:"peak_resident_bytes"`
}

func (manager *Manager) Measurement(id string) Measurement {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	return manager.metrics[id]
}
func (manager *Manager) Unload(ctx context.Context, id string) error {
	if err := manager.acquire(ctx); err != nil {
		return err
	}
	defer manager.release()
	manager.stopWorker(id)
	return nil
}

// Internal workers bypass environment proxy settings and never follow redirects.
func workerClient() *http.Client {
	return &http.Client{Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
func safeLoopback(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "http" && u.Hostname() == "127.0.0.1"
}
