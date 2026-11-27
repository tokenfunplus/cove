package chat

import (
	"context"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/speech"
)

// App speech uses the saved local voice configuration and a session-and-instance
// owner. The lifecycle group lets grant revocation remove every tab's temporary WAVs.
func (service *Service) ReadMiniAppText(ctx context.Context, instance, session, text, language string) (speech.JobStatus, error) {
	if service.speech == nil {
		return speech.JobStatus{}, errors.New("Local speech is unavailable.")
	}
	if instance == "" || session == "" || strings.TrimSpace(text) == "" || utf8.RuneCountInString(text) > 6000 {
		return speech.JobStatus{}, errors.New("Choose up to 6,000 characters to read aloud.")
	}
	if language != "" && language != "ja" {
		return speech.JobStatus{}, errors.New("Choose an available speech language.")
	}
	japanese := language == "ja" || strings.ContainsFunc(text, func(r rune) bool { return unicode.In(r, unicode.Hiragana, unicode.Katakana) })
	return service.speech.Start(ctx, AppSpeechOwner(instance, session), speech.Request{
		SystemJapanese: japanese, Text: text, RenderedText: true, ConversationID: "mini-app/" + instance, PreserveOtherReadings: true,
	})
}
func AppSpeechOwner(instance, session string) string { return "mini-app/" + instance + "/" + session }
func (service *Service) RevokeAppSpeech(ctx context.Context, id string) error {
	if service.speech == nil {
		return nil
	}
	return service.speech.CancelConversation(ctx, "mini-app/"+id)
}

func (service *Service) JapaneseSpeechAvailable(ctx context.Context) bool {
	return service.speech != nil && speech.SystemJapaneseAvailable(ctx)
}
