package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/speech"
)

type speechChat interface {
	SpeechSettings(context.Context) (chat.SpeechConfiguration, error)
	SaveSpeechSettings(context.Context, persistence.SpeechSettings) (chat.SpeechConfiguration, error)
	ReadAloud(context.Context, string, chat.SpeechInput) (speech.JobStatus, error)
	ReadDebateAloud(context.Context, string, chat.DebateSpeechInput) (speech.JobStatus, error)
	PreviewSpeech(context.Context, string, chat.SpeechPreview) (speech.JobStatus, error)
	SpeechStatus(string, string) (speech.JobStatus, error)
	SpeechAudio(string, string, int) ([]byte, error)
	StopSpeech(context.Context, string, string) error
}

func (server *Server) speechCommand(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Cache-Control", "no-store")
	service, ok := server.chat.(speechChat)
	if !ok {
		writeError(writer, 503, "speech_unavailable", "Local speech is unavailable.")
		return
	}
	session, _ := localsecurity.SessionFromRequest(request)
	decode := func(target any) error {
		limit := int64(16 << 10)
		if request.URL.Path == "/api/speech" {
			limit = 80 << 10
		}
		request.Body = http.MaxBytesReader(writer, request.Body, limit)
		decoder := json.NewDecoder(request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(target); err != nil {
			return err
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			return errors.New("Expected one JSON object.")
		}
		return nil
	}
	var result any
	var err error
	switch {
	case request.URL.Path == "/api/speech/settings" && request.Method == http.MethodGet:
		result, err = service.SpeechSettings(request.Context())
	case request.URL.Path == "/api/speech/settings" && request.Method == http.MethodPut:
		var input persistence.SpeechSettings
		if decode(&input) != nil {
			writeError(writer, 400, "validation", "The speech settings are invalid.")
			return
		}
		result, err = service.SaveSpeechSettings(request.Context(), input)
	case request.URL.Path == "/api/speech" && request.Method == http.MethodPost:
		var input chat.SpeechInput
		if decode(&input) != nil {
			writeError(writer, 400, "validation", "Choose a saved answer to read aloud.")
			return
		}
		result, err = service.ReadAloud(request.Context(), session.ID, input)
	case request.URL.Path == "/api/speech/debate" && request.Method == http.MethodPost:
		var input chat.DebateSpeechInput
		if decode(&input) != nil || input.DebateID == "" || input.TurnID == "" {
			writeError(writer, 400, "validation", "Choose a completed debate turn to read aloud.")
			return
		}
		result, err = service.ReadDebateAloud(request.Context(), session.ID, input)
	case request.URL.Path == "/api/speech/preview" && request.Method == http.MethodPost:
		var input chat.SpeechPreview
		if decode(&input) != nil {
			writeError(writer, 400, "validation", "The voice preview is invalid.")
			return
		}
		result, err = service.PreviewSpeech(request.Context(), session.ID, input)
	case request.Method == http.MethodDelete:
		err = service.StopSpeech(request.Context(), session.ID, request.PathValue("speech"))
		if err == nil {
			writer.WriteHeader(http.StatusNoContent)
			return
		}
	default:
		result, err = service.SpeechStatus(session.ID, request.PathValue("speech"))
	}
	if err != nil {
		writeSpeechError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}
func (server *Server) speechAudio(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Cache-Control", "no-store")
	service, ok := server.chat.(speechChat)
	if !ok {
		writeError(writer, 503, "speech_unavailable", "Local speech is unavailable.")
		return
	}
	session, _ := localsecurity.SessionFromRequest(request)
	index := -1
	if raw := request.PathValue("chunk"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 || value >= 128 {
			writeError(writer, 404, "not_found", "This audio chunk is unavailable.")
			return
		}
		index = value
	}
	audio, err := service.SpeechAudio(session.ID, request.PathValue("speech"), index)
	if err != nil {
		writeSpeechError(writer, err)
		return
	}
	writer.Header().Set("Content-Type", "audio/wav")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.Header().Set("Content-Length", strconv.Itoa(len(audio)))
	if index < 0 {
		writer.Header().Set("Content-Disposition", `attachment; filename="cove-reading.wav"`)
	}
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(audio)
}
func writeSpeechError(writer http.ResponseWriter, err error) {
	var required *speech.ModelRequiredError
	switch {
	case errors.As(err, &required):
		writeError(writer, 409, "speech_model_required", err.Error())
	case errors.Is(err, speech.ErrNotFound), errors.Is(err, sql.ErrNoRows):
		writeError(writer, 404, "not_found", "This reading or saved answer is no longer available.")
	case errors.Is(err, context.Canceled):
		writeError(writer, 409, "speech_stopped", "Reading stopped.")
	default:
		writeError(writer, 400, "speech_error", err.Error())
	}
}
