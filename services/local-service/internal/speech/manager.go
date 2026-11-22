package speech

import (
	"context"
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

type SettingsStore interface {
	GetSpeechSettings(context.Context) (persistence.SpeechSettings, error)
	SaveSpeechSettings(context.Context, persistence.SpeechSettings) error
}
type installJob struct {
	cancel context.CancelFunc
	done   chan struct{}
	status localmodels.Status
}
type Manager struct {
	files      persistence.ModelBundles
	audio      persistence.SpeechAudio
	store      SettingsStore
	runtime    string
	client     *http.Client
	mu         sync.Mutex
	operations sync.Mutex
	installs   map[string]*installJob
	jobs       map[string]*Job
	active     *Job
	ctx        context.Context
	cancel     context.CancelFunc
}

func New(root, runtimeDirectory string, store SettingsStore) *Manager {
	ctx, cancel := context.WithCancel(context.Background())
	transport := http.DefaultTransport.(*http.Transport).Clone()
	manager := &Manager{files: persistence.ModelBundles{Root: filepath.Join(root, "models")}, audio: persistence.SpeechAudio{Root: filepath.Join(root, "speech-audio")}, store: store, runtime: runtimeDirectory, installs: map[string]*installJob{}, jobs: map[string]*Job{}, ctx: ctx, cancel: cancel}
	manager.client = &http.Client{Transport: transport, Timeout: 15 * time.Minute, CheckRedirect: func(request *http.Request, via []*http.Request) error {
		if len(via) > 8 || request.URL.Scheme != "https" || !allowedDownloadHost(request.URL.Hostname()) {
			return errors.New("The speech download redirected to an unsupported destination.")
		}
		request.Header.Del("Authorization")
		return nil
	}}
	_ = manager.audio.Clear()
	go manager.reap()
	return manager
}
func allowedDownloadHost(host string) bool {
	return host == "github.com" || host == "release-assets.githubusercontent.com" || host == "objects.githubusercontent.com" || host == "huggingface.co" || strings.HasSuffix(host, ".hf.co") || strings.HasSuffix(host, ".huggingface.co")
}
func (manager *Manager) RuntimeReady(model Model) bool {
	if runtime.GOOS != "darwin" || runtime.GOARCH != "arm64" || !localmodels.PlatformSupported() {
		return false
	}
	name := "cove-speech-worker"
	if model.Engine == "kitten" {
		name = "kitten/cove-speech-worker"
	}
	if model.Engine == "pocket" {
		name = "pocket-tts"
	}
	info, err := os.Stat(filepath.Join(manager.runtime, name))
	return err == nil && info.Mode().IsRegular() && info.Mode()&0111 != 0
}
func (manager *Manager) Statuses() []localmodels.Status {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	result := make([]localmodels.Status, 0, len(Registry))
	for _, model := range Registry {
		version := RuntimeVersion
		if model.Engine == "kitten" {
			version = "sherpa-onnx-2.0.3/espeak-1.52.0"
		}
		if model.Engine == "pocket" {
			version = PocketRuntimeVersion
		}
		status := localmodels.Status{Model: model.Model, State: "not_installed", RuntimeReady: manager.RuntimeReady(model), RuntimeVersion: version}
		if manager.files.Installed(model.Bundle()) {
			status.State = "installed"
			status.Downloaded = model.Bytes
		}
		if job := manager.installs[model.ID]; job != nil && job.status.State != "installed" {
			status.State = job.status.State
			status.Downloaded = job.status.Downloaded
			status.Error = job.status.Error
		}
		result = append(result, status)
	}
	return result
}
func (manager *Manager) Install(id string) error {
	manager.operations.Lock()
	defer manager.operations.Unlock()
	model, err := Lookup(id)
	if err != nil {
		return err
	}
	if !manager.RuntimeReady(model) {
		return errors.New("The bundled local speech runtime is unavailable on this Mac.")
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.ctx.Err() != nil {
		return errors.New("Local speech has stopped.")
	}
	if previous := manager.installs[id]; previous != nil && previous.status.State == "downloading" {
		return nil
	}
	if manager.files.Installed(model.Bundle()) {
		return nil
	}
	ctx, cancel := context.WithTimeout(manager.ctx, 15*time.Minute)
	job := &installJob{cancel: cancel, done: make(chan struct{}), status: localmodels.Status{Model: model.Model, State: "downloading"}}
	manager.installs[id] = job
	go func() {
		defer close(job.done)
		defer cancel()
		err := manager.files.Install(ctx, model.Bundle(), func(asset persistence.BundleArtifact) (io.ReadCloser, error) {
			var source string
			for _, item := range model.Artifacts {
				if item.Filename == asset.Filename {
					source = item.URL
					break
				}
			}
			if source == "" {
				return nil, errors.New("The speech download manifest is incomplete.")
			}
			request, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
			if err != nil {
				return nil, err
			}
			response, err := manager.client.Do(request)
			if err != nil {
				return nil, errors.New("The speech model source could not be reached. Check your connection and retry.")
			}
			if response.StatusCode != http.StatusOK {
				response.Body.Close()
				return nil, errors.New("The speech model source could not serve this download. Retry later.")
			}
			return response.Body, nil
		}, func(n int64) { manager.mu.Lock(); job.status.Downloaded = n; manager.mu.Unlock() })
		manager.mu.Lock()
		defer manager.mu.Unlock()
		job.status.State = "installed"
		if err != nil {
			job.status.State = "failed"
			job.status.Error = err.Error()
			if ctx.Err() != nil {
				job.status.State = "not_installed"
				job.status.Error = ""
			}
		}
	}()
	return nil
}
func (manager *Manager) cancelInstall(ctx context.Context, id string) error {
	manager.mu.Lock()
	job := manager.installs[id]
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
func (manager *Manager) CancelDownload(ctx context.Context, id string) error {
	manager.operations.Lock()
	defer manager.operations.Unlock()
	if !IsModel(id) {
		return errors.New("Unknown speech model.")
	}
	return manager.cancelInstall(ctx, id)
}
func (manager *Manager) Remove(ctx context.Context, id string) error {
	manager.operations.Lock()
	defer manager.operations.Unlock()
	model, err := Lookup(id)
	if err != nil {
		return err
	}
	if err = manager.cancelInstall(ctx, id); err != nil {
		return err
	}
	if err = manager.cancelMatching(ctx, func(job *Job) bool { return job.ModelID == id }); err != nil {
		return err
	}
	if err = manager.files.Remove(model.Bundle()); err != nil {
		return err
	}
	manager.mu.Lock()
	delete(manager.installs, id)
	manager.mu.Unlock()
	return nil
}
func DefaultSettings() persistence.SpeechSettings {
	result := persistence.SpeechSettings{Mode: "auto", Profiles: map[string]persistence.SpeechProfile{}, Volume: 0.9, Threads: 2}
	for _, model := range Registry {
		result.Profiles[model.ID] = persistence.SpeechProfile{VoiceID: model.DefaultVoice, Speed: 1, NoiseScale: 0.667, Temperature: 0.3}
	}
	return result
}
func (manager *Manager) Settings(ctx context.Context) (persistence.SpeechSettings, error) {
	value, err := manager.store.GetSpeechSettings(ctx)
	if err != nil {
		return value, err
	}
	if value.Mode == "" {
		value = DefaultSettings()
	}
	return value, ValidateSettings(&value)
}
func ValidateSettings(value *persistence.SpeechSettings) error {
	if value.Mode != "auto" && value.Mode != "manual" {
		return errors.New("Choose automatic language selection or one speech model.")
	}
	if value.ModelID != "" && !IsModel(value.ModelID) {
		return errors.New("Unknown default speech model.")
	}
	if value.Mode == "manual" && value.ModelID == "" {
		return errors.New("Choose a speech model first.")
	}
	for language, id := range map[string]string{"en": value.EnglishModelID, "zh": value.ChineseModelID} {
		if id != "" {
			model, err := Lookup(id)
			if err != nil || !model.Supports(language) {
				return errors.New("The chosen model does not support this reading language.")
			}
		}
	}
	if value.Threads < 1 || value.Threads > 4 || math.IsNaN(value.Volume) || value.Volume < 0 || value.Volume > 1 {
		return errors.New("Speech volume or CPU usage is out of range.")
	}
	if value.Profiles == nil {
		value.Profiles = map[string]persistence.SpeechProfile{}
	}
	defaults := DefaultSettings()
	for id, profile := range value.Profiles {
		model, err := Lookup(id)
		if err != nil {
			return errors.New("Unknown speech profile.")
		}
		if _, ok := model.Voice(profile.VoiceID); !ok {
			return errors.New("Choose a voice supported by this model.")
		}
		if math.IsNaN(profile.Speed) || profile.Speed < 0.5 || profile.Speed > 2 || math.IsNaN(profile.NoiseScale) || profile.NoiseScale < 0.1 || profile.NoiseScale > 1 || math.IsNaN(profile.Temperature) || profile.Temperature < 0.1 || profile.Temperature > 1 {
			return errors.New("A speech model option is out of range.")
		}
	}
	for id, profile := range defaults.Profiles {
		if _, ok := value.Profiles[id]; !ok {
			value.Profiles[id] = profile
		}
	}
	return nil
}
func (manager *Manager) SaveSettings(ctx context.Context, value persistence.SpeechSettings) error {
	if err := ValidateSettings(&value); err != nil {
		return err
	}
	return manager.store.SaveSpeechSettings(ctx, value)
}
func (manager *Manager) Close() {
	manager.cancel()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	manager.operations.Lock()
	defer manager.operations.Unlock()
	for _, model := range Registry {
		_ = manager.cancelInstall(ctx, model.ID)
	}
	_ = manager.cancelMatching(ctx, func(*Job) bool { return true })
	manager.client.CloseIdleConnections()
}
