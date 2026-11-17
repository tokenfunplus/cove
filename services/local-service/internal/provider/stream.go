package provider

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
)

const (
	maxSSELineSize     = 64 << 10
	maxSSEEventSize    = 1 << 20
	maxSSEStreamSize   = 16 << 20
	MaxCompletionBytes = 4 << 20
)

type Provider interface {
	Validate(ctx context.Context, input ValidateInput) (ValidationResult, error)
	Stream(ctx context.Context, input CompletionInput) (CompletionStream, error)
}

type ProviderMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type CompletionInput struct {
	Profile              Profile
	Secret               credentials.Secret
	Messages             []ProviderMessage
	GenerationParameters GenerationParameters
}

// GenerationParameters map to optional OpenAI-compatible chat completion
// fields. Nil fields are intentionally not sent, preserving Provider defaults.
type GenerationParameters struct {
	Temperature *float64
	TopP        *float64
	MaxTokens   *int
}

type EventType string

const (
	EventStarted   EventType = "started"
	EventDelta     EventType = "delta"
	EventCompleted EventType = "completed"
	EventStopped   EventType = "stopped"
	EventFailed    EventType = "failed"
)

type Event struct {
	Type         EventType
	Delta        string
	FinishReason string
	ErrorCode    string
	ErrorMessage string
}

type CompletionStream interface {
	Recv(ctx context.Context) (Event, error)
	Close() error
}

type sseCompletionStream struct {
	reader       *bufio.Reader
	body         io.ReadCloser
	started      bool
	finished     bool
	data         []string
	eventBytes   int
	streamBytes  int
	finishReason string
}

func newSSECompletionStream(body io.ReadCloser) *sseCompletionStream {
	return &sseCompletionStream{reader: bufio.NewReaderSize(body, maxSSELineSize), body: body}
}

func (stream *sseCompletionStream) Recv(ctx context.Context) (Event, error) {
	if stream.finished {
		return Event{}, io.EOF
	}
	if !stream.started {
		stream.started = true
		return Event{Type: EventStarted}, nil
	}
	for {
		if err := ctx.Err(); err != nil {
			return Event{}, err
		}
		rawLine, err := stream.reader.ReadSlice('\n')
		stream.eventBytes += len(rawLine)
		stream.streamBytes += len(rawLine)
		if errors.Is(err, bufio.ErrBufferFull) || stream.eventBytes > maxSSEEventSize || stream.streamBytes > maxSSEStreamSize {
			stream.finished = true
			return Event{}, ErrProtocol
		}
		if err != nil && !errors.Is(err, io.EOF) {
			stream.finished = true
			return Event{}, errors.Join(ErrProviderUnavailable, err)
		}
		if errors.Is(err, io.EOF) {
			stream.finished = true
			return Event{}, ErrProtocol
		}
		line := strings.TrimSuffix(strings.TrimSuffix(string(rawLine), "\n"), "\r")
		if line == "" {
			stream.eventBytes = 0
			if len(stream.data) == 0 {
				continue
			}
			event, done, parseErr := parseSSEData(strings.Join(stream.data, "\n"))
			stream.data = nil
			if parseErr != nil {
				stream.finished = true
				return Event{}, parseErr
			}
			if done {
				stream.finished = true
				return Event{Type: EventCompleted, FinishReason: stream.finishReason}, nil
			}
			if event.FinishReason != "" {
				stream.finishReason = event.FinishReason
			}
			return event, nil
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		if strings.HasPrefix(line, "data:") {
			stream.data = append(stream.data, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
}

func (stream *sseCompletionStream) Close() error {
	stream.finished = true
	return stream.body.Close()
}

func parseSSEData(data string) (Event, bool, error) {
	if strings.TrimSpace(data) == "[DONE]" {
		return Event{}, true, nil
	}
	var payload struct {
		Choices []struct {
			Delta struct {
				Content string `json:"content"`
			} `json:"delta"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(data), &payload); err != nil {
		return Event{}, false, ErrProtocol
	}
	if payload.Error != nil {
		return Event{Type: EventFailed, ErrorCode: "provider_error", ErrorMessage: "The Provider rejected the generation request."}, false, nil
	}
	if len(payload.Choices) == 0 {
		return Event{}, false, ErrProtocol
	}
	return Event{Type: EventDelta, Delta: payload.Choices[0].Delta.Content, FinishReason: payload.Choices[0].FinishReason}, false, nil
}

var _ Provider = (*HTTPAdapter)(nil)
