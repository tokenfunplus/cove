package speech

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

var ErrNotFound = errors.New("This speech session is no longer available.")

type ModelRequiredError struct {
	Language string
	ModelID  string
}

func (err *ModelRequiredError) Error() string {
	return "Install a local speech model for this language in On this Mac > Discover."
}

type JobStatus struct {
	ID           string  `json:"id"`
	State        string  `json:"state"`
	ModelID      string  `json:"model_id"`
	ModelName    string  `json:"model_name"`
	VoiceName    string  `json:"voice_name"`
	Language     string  `json:"language"`
	ReadyChunks  int     `json:"ready_chunks"`
	TotalChunks  int     `json:"total_chunks"`
	Characters   int     `json:"characters"`
	PlaybackRate float64 `json:"playback_rate"`
	Volume       float64 `json:"volume"`
	Error        string  `json:"error,omitempty"`
}
type Job struct {
	JobStatus
	owner, conversationID string
	cancel                context.CancelFunc
	done                  chan struct{}
	accessed              time.Time
	bytes                 int64
	cleanupPending        bool
}
type Request struct {
	SystemJapanese        bool
	Volume                *float64
	Threads               *int
	Text                  string
	ConversationID        string
	ModelID               string
	Profile               *persistence.SpeechProfile
	RenderedText          bool
	PreserveOtherReadings bool
}

func (manager *Manager) choose(settings persistence.SpeechSettings, language, override string) (Model, error) {
	id := override
	if id == "" && settings.Mode == "manual" {
		id = settings.ModelID
	}
	if id == "" {
		if language == "zh" {
			id = settings.ChineseModelID
		} else {
			id = settings.EnglishModelID
		}
	}
	if id != "" {
		model, err := Lookup(id)
		if err != nil {
			return Model{}, err
		}
		if !model.Supports(language) {
			return Model{}, errors.New("This model does not read Chinese. Choose a Chinese speech model in Settings.")
		}
		if !manager.files.Installed(model.Bundle()) {
			return Model{}, &ModelRequiredError{Language: language, ModelID: id}
		}
		return model, nil
	}
	order := []string{"kokoro-en", "kitten-nano-en", "pocket-tts-en", "melo-zh-en", "kokoro-zh"}
	if language == "zh" {
		order = []string{"kokoro-zh", "melo-zh-en"}
	}
	for _, id := range order {
		model, _ := Lookup(id)
		if manager.files.Installed(model.Bundle()) {
			return model, nil
		}
	}
	return Model{}, &ModelRequiredError{Language: language, ModelID: order[0]}
}
func (manager *Manager) Start(ctx context.Context, owner string, input Request) (JobStatus, error) {
	if owner == "" {
		return JobStatus{}, errors.New("A local browser session is required.")
	}
	manager.operations.Lock()
	defer manager.operations.Unlock()
	if err := ctx.Err(); err != nil {
		return JobStatus{}, err
	}
	settings, err := manager.Settings(ctx)
	if err != nil {
		return JobStatus{}, err
	}
	if input.Volume != nil {
		settings.Volume = *input.Volume
	}
	if input.Threads != nil {
		settings.Threads = *input.Threads
	}
	if err := ValidateSettings(&settings); err != nil {
		return JobStatus{}, err
	}
	text, err := PlainText(input.Text, settings.IncludeCode)
	if input.RenderedText {
		text, err = selectionText(input.Text)
	}
	if err != nil {
		return JobStatus{}, err
	}
	language := "en"
	for _, letter := range text {
		if unicode.Is(unicode.Han, letter) {
			language = "zh"
			break
		}
	}
	var model Model
	var voice Voice
	var profile persistence.SpeechProfile
	if input.SystemJapanese {
		language = "ja"
		voice, err = installedJapaneseVoice(ctx)
		if err != nil {
			return JobStatus{}, err
		}
		model.ID = "macos-ja"
		model.Name = "macOS Japanese speech"
	} else {
		model, err = manager.choose(settings, language, input.ModelID)
		if err != nil {
			return JobStatus{}, err
		}
		if !manager.RuntimeReady(model) {
			return JobStatus{}, errors.New("The bundled local speech runtime is unavailable on this Mac.")
		}
		profile = settings.Profiles[model.ID]
		if input.Profile != nil {
			profile = *input.Profile
			settings.Profiles[model.ID] = profile
			if err = ValidateSettings(&settings); err != nil {
				return JobStatus{}, err
			}
		}
		voice, _ = model.Voice(profile.VoiceID)
	}
	if input.PreserveOtherReadings {
		// An app cannot interrupt a reading in Chat or discard its WAV download.
		manager.mu.Lock()
		busy := false
		for _, other := range manager.jobs {
			if other.owner != owner {
				if other.State == "preparing" || other.State == "generating" {
					busy = true
				}
			}
		}
		manager.mu.Unlock()
		if busy {
			return JobStatus{}, errors.New("Another reading is in progress. Finish it before starting this reading.")
		}
	}
	if err = manager.cancelMatching(ctx, func(job *Job) bool { return !input.PreserveOtherReadings || job.owner == owner }); err != nil {
		return JobStatus{}, err
	}
	var random [16]byte
	if _, err = rand.Read(random[:]); err != nil {
		return JobStatus{}, err
	}
	id := hex.EncodeToString(random[:])
	parts := splitText(text)
	if len(parts) > 128 {
		return JobStatus{}, errors.New("This answer is too long for one reading. Select a shorter passage.")
	}
	if err = manager.audio.Create(id); err != nil {
		return JobStatus{}, err
	}
	jobCtx, cancel := context.WithTimeout(manager.ctx, 5*time.Minute)
	status := JobStatus{ID: id, State: "preparing", ModelID: model.ID, ModelName: model.Name, VoiceName: voice.Name, Language: language, TotalChunks: len(parts), Characters: utf8.RuneCountInString(text), PlaybackRate: 1, Volume: settings.Volume}
	if model.Engine == "pocket" {
		status.PlaybackRate = profile.Speed
	}
	job := &Job{JobStatus: status, owner: owner, conversationID: input.ConversationID, cancel: cancel, done: make(chan struct{}), accessed: time.Now()}
	manager.mu.Lock()
	manager.jobs[id] = job
	manager.active = job
	manager.mu.Unlock()
	go func() {
		defer close(job.done)
		defer cancel()
		receive := func(wave []byte) error {
			manager.mu.Lock()
			index := job.ReadyChunks
			over := job.bytes+int64(len(wave)) > 32<<20
			manager.mu.Unlock()
			if over {
				return errors.New("This reading exceeds the audio limit. Select a shorter passage.")
			}
			if err := jobCtx.Err(); err != nil {
				return err
			}
			if err := manager.audio.Write(id, index, wave); err != nil {
				return err
			}
			manager.mu.Lock()
			job.ReadyChunks++
			job.bytes += int64(len(wave))
			job.State = "generating"
			manager.mu.Unlock()
			return nil
		}
		var err error
		if input.SystemJapanese {
			err = manager.synthesizeJapanese(jobCtx, id, voice, parts, receive)
		} else if err = manager.files.Verify(jobCtx, model.Bundle()); err == nil {
			err = manager.runWorker(jobCtx, model, profile, voice, language, settings.Threads, parts, receive)
		}
		manager.mu.Lock()
		defer manager.mu.Unlock()
		job.State = "completed"
		if err != nil {
			job.State = "failed"
			job.Error = err.Error()
			if errors.Is(jobCtx.Err(), context.Canceled) {
				job.State = "stopped"
				job.Error = ""
			} else if errors.Is(jobCtx.Err(), context.DeadlineExceeded) {
				job.Error = "Local speech timed out. Try a shorter passage."
			}
		}
		if manager.active == job {
			manager.active = nil
		}
	}()
	return status, nil
}
func (manager *Manager) Status(owner, id string) (JobStatus, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	job := manager.jobs[id]
	if job == nil || job.owner != owner || job.cleanupPending {
		return JobStatus{}, ErrNotFound
	}
	job.accessed = time.Now()
	return job.JobStatus, nil
}
func (manager *Manager) Audio(owner, id string, index int) ([]byte, error) {
	manager.mu.Lock()
	job := manager.jobs[id]
	if job == nil || job.owner != owner || job.cleanupPending || index < 0 || index >= job.ReadyChunks {
		manager.mu.Unlock()
		return nil, ErrNotFound
	}
	job.accessed = time.Now()
	manager.mu.Unlock()
	return manager.audio.Read(id, index)
}
func (manager *Manager) Download(owner, id string) ([]byte, error) {
	status, err := manager.Status(owner, id)
	if err != nil {
		return nil, err
	}
	if status.State != "completed" {
		return nil, errors.New("Finish preparing the reading before exporting it.")
	}
	var waves [][]byte
	for i := 0; i < status.ReadyChunks; i++ {
		wave, err := manager.Audio(owner, id, i)
		if err != nil {
			return nil, err
		}
		waves = append(waves, wave)
	}
	return joinWaves(waves)
}
func (manager *Manager) Stop(ctx context.Context, owner, id string) error {
	manager.operations.Lock()
	defer manager.operations.Unlock()
	manager.mu.Lock()
	job := manager.jobs[id]
	owned := job != nil && job.owner == owner
	manager.mu.Unlock()
	if !owned {
		return ErrNotFound
	}
	return manager.cancelMatching(ctx, func(job *Job) bool { return job.ID == id && job.owner == owner })
}
func (manager *Manager) CancelConversation(ctx context.Context, id string) error {
	manager.operations.Lock()
	defer manager.operations.Unlock()
	return manager.cancelMatching(ctx, func(job *Job) bool { return id == "" || job.conversationID == id })
}
func (manager *Manager) cancelMatching(ctx context.Context, match func(*Job) bool) error {
	manager.mu.Lock()
	var jobs []*Job
	for _, job := range manager.jobs {
		if match(job) {
			job.cleanupPending = true
			job.cancel()
			jobs = append(jobs, job)
		}
	}
	manager.mu.Unlock()
	for _, job := range jobs {
		select {
		case <-job.done:
		case <-ctx.Done():
			return ctx.Err()
		}
		if err := manager.audio.Remove(job.ID); err != nil {
			return err
		}
		manager.mu.Lock()
		delete(manager.jobs, job.ID)
		manager.mu.Unlock()
	}
	return nil
}
func (manager *Manager) reap() {
	timer := time.NewTicker(time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-manager.ctx.Done():
			return
		case <-timer.C:
			manager.operations.Lock()
			_ = manager.cancelMatching(manager.ctx, func(job *Job) bool { return job.cleanupPending || time.Since(job.accessed) > 30*time.Minute })
			manager.operations.Unlock()
		}
	}
}
func splitText(text string) []string {
	limit := 240
	for _, r := range text {
		if unicode.Is(unicode.Han, r) {
			limit = 96
			break
		}
	}
	remaining := []rune(text)
	var result []string
	for len(remaining) > 0 {
		end := len(remaining)
		if end > limit {
			end = limit
		}
		cut := end
		for i := end - 1; i >= 0; i-- {
			if strings.ContainsRune(".!?。！？\n", remaining[i]) && i >= 25 {
				cut = i + 1
				break
			}
			if i == 0 && end < len(remaining) && limit == 240 {
				for j := end - 1; j >= end/2; j-- {
					if unicode.IsSpace(remaining[j]) {
						cut = j + 1
						break
					}
				}
			}
		}
		if part := strings.TrimSpace(string(remaining[:cut])); part != "" {
			result = append(result, part)
		}
		remaining = remaining[cut:]
	}
	return result
}
