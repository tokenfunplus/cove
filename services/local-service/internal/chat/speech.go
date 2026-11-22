package chat

import (
	"context"
	"errors"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/speech"
)

type SpeechModel struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Engine       string         `json:"engine"`
	Languages    []string       `json:"languages"`
	Voices       []speech.Voice `json:"voices"`
	DefaultVoice string         `json:"default_voice"`
	Installed    bool           `json:"installed"`
	RuntimeReady bool           `json:"runtime_ready"`
}
type SpeechConfiguration struct {
	Settings persistence.SpeechSettings `json:"settings"`
	Models   []SpeechModel              `json:"models"`
}
type SpeechInput struct {
	ConversationID string `json:"conversation_id"`
	MessageID      string `json:"message_id"`
	Selection      string `json:"selection,omitempty"`
}
type SpeechPreview struct {
	Text    string                    `json:"text"`
	ModelID string                    `json:"model_id"`
	Profile persistence.SpeechProfile `json:"profile"`
}
type DebateSpeechInput struct {
	DebateID string `json:"debate_id"`
	TurnID   string `json:"turn_id"`
}

func (service *Service) SetSpeech(manager *speech.Manager) { service.speech = manager }
func (service *Service) SpeechSettings(ctx context.Context) (SpeechConfiguration, error) {
	if service.speech == nil {
		return SpeechConfiguration{}, errors.New("Local speech is unavailable.")
	}
	settings, err := service.speech.Settings(ctx)
	if err != nil {
		return SpeechConfiguration{}, err
	}
	statuses := service.speech.Statuses()
	result := SpeechConfiguration{Settings: settings, Models: []SpeechModel{}}
	for _, model := range speech.Registry {
		entry := SpeechModel{ID: model.ID, Name: model.Name, Engine: model.Engine, Languages: model.Languages, Voices: model.Voices, DefaultVoice: model.DefaultVoice}
		for _, status := range statuses {
			if status.ID == model.ID {
				entry.Installed = status.State == "installed"
				entry.RuntimeReady = status.RuntimeReady
				break
			}
		}
		result.Models = append(result.Models, entry)
	}
	return result, nil
}
func (service *Service) SaveSpeechSettings(ctx context.Context, settings persistence.SpeechSettings) (SpeechConfiguration, error) {
	if service.speech == nil {
		return SpeechConfiguration{}, errors.New("Local speech is unavailable.")
	}
	if err := service.speech.SaveSettings(ctx, settings); err != nil {
		return SpeechConfiguration{}, err
	}
	return service.SpeechSettings(ctx)
}
func (service *Service) ReadAloud(ctx context.Context, owner string, input SpeechInput) (speech.JobStatus, error) {
	if service.speech == nil {
		return speech.JobStatus{}, errors.New("Local speech is unavailable.")
	}
	service.startMu.Lock()
	defer service.startMu.Unlock()
	view, err := service.store.LoadConversation(ctx, input.ConversationID)
	if err != nil {
		return speech.JobStatus{}, err
	}
	for _, message := range view.Messages {
		if message.ID == input.MessageID && message.Role == "assistant" {
			body := message.Body
			if input.Selection != "" {
				if utf8.RuneCountInString(input.Selection) > 6000 {
					return speech.JobStatus{}, errors.New("Select up to 6,000 characters for reading.")
				}
				body = input.Selection
			}
			return service.speech.Start(ctx, owner, speech.Request{Text: body, ConversationID: input.ConversationID})
		}
	}
	return speech.JobStatus{}, errors.New("This saved answer is no longer available for reading.")
}
func (service *Service) PreviewSpeech(ctx context.Context, owner string, input SpeechPreview) (speech.JobStatus, error) {
	if service.speech == nil {
		return speech.JobStatus{}, errors.New("Local speech is unavailable.")
	}
	if utf8.RuneCountInString(input.Text) > 400 {
		return speech.JobStatus{}, errors.New("Use up to 400 characters for a voice preview.")
	}
	return service.speech.Start(ctx, owner, speech.Request{Text: input.Text, ModelID: input.ModelID, Profile: &input.Profile})
}
func (service *Service) ReadDebateAloud(ctx context.Context, owner string, input DebateSpeechInput) (speech.JobStatus, error) {
	if service.speech == nil {
		return speech.JobStatus{}, errors.New("Local speech is unavailable.")
	}
	service.startMu.Lock()
	defer service.startMu.Unlock()
	store, err := service.debateStore()
	if err != nil {
		return speech.JobStatus{}, err
	}
	// Resolve the settled original, never browser-supplied text or live reasoning.
	turn, err := store.ReadDebateTurn(ctx, input.DebateID, input.TurnID)
	if err != nil {
		return speech.JobStatus{}, err
	}
	if turn.State != "completed" || turn.Kind == "summary" {
		return speech.JobStatus{}, errors.New("Only completed participant turns can be read aloud.")
	}
	return service.speech.Start(ctx, owner, speech.Request{Text: turn.Body, ConversationID: input.DebateID})
}
func (service *Service) SpeechStatus(owner, id string) (speech.JobStatus, error) {
	if service.speech == nil {
		return speech.JobStatus{}, speech.ErrNotFound
	}
	return service.speech.Status(owner, id)
}
func (service *Service) SpeechAudio(owner, id string, index int) ([]byte, error) {
	if service.speech == nil {
		return nil, speech.ErrNotFound
	}
	if index < 0 {
		return service.speech.Download(owner, id)
	}
	return service.speech.Audio(owner, id, index)
}
func (service *Service) StopSpeech(ctx context.Context, owner, id string) error {
	if service.speech == nil {
		return speech.ErrNotFound
	}
	return service.speech.Stop(ctx, owner, id)
}
