package provider

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func FuzzParseSSEData(f *testing.F) {
	for _, seed := range []string{
		"[DONE]", " \t[DONE]\r", "", "null", "{}", "{", "[]",
		`{"choices":[{"delta":{"content":"Hello"},"finish_reason":"length"}]}`,
		`{"error":{"message":"synthetic-private-provider-message","code":"secret"}}`,
		`{"choices":[{"delta":{"content":42}}]}`,
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, data string) {
		if len(data) > maxSSELineSize {
			t.Skip()
		}
		event, done, err := parseSSEData(data)
		if err != nil {
			if !errors.Is(err, ErrProtocol) || done || event != (Event{}) {
				t.Fatal("invalid frame returned data or an unexpected error")
			}
			return
		}
		if done {
			if strings.TrimSpace(data) != "[DONE]" || event != (Event{}) {
				t.Fatal("a non-terminal frame completed the stream")
			}
			return
		}
		switch event.Type {
		case EventFailed:
			if event != (Event{Type: EventFailed, ErrorCode: "provider_error", ErrorMessage: "The Provider rejected the generation request."}) {
				t.Fatal("raw Provider error data escaped classification")
			}
		case EventDelta:
			if !utf8.ValidString(event.Delta) || !utf8.ValidString(event.FinishReason) || event.ErrorCode != "" || event.ErrorMessage != "" {
				t.Fatal("delta contains invalid text or error data")
			}
		default:
			t.Fatal("parser produced an unsupported event type")
		}
	})
}

func FuzzSSEContentRoundTrip(f *testing.F) {
	f.Add("Hello \u4e2d\u6587\n\"quoted\"", "stop", false)
	f.Add("", "length", true)
	f.Add("data: [DONE]\n\n", "", true)
	f.Fuzz(func(t *testing.T, content, reason string, crlf bool) {
		if len(content)+len(reason) > 4096 || !utf8.ValidString(content) || !utf8.ValidString(reason) {
			t.Skip()
		}
		frame, err := json.Marshal(map[string]any{"choices": []any{map[string]any{
			"delta": map[string]string{"content": content}, "finish_reason": reason,
		}}})
		if err != nil {
			t.Fatal(err)
		}
		newline := "\n"
		if crlf {
			newline = "\r\n"
		}
		body := ": keepalive" + newline + newline + "data: " + string(frame) + newline + newline + "data: [DONE]" + newline + newline
		stream := newSSECompletionStream(io.NopCloser(strings.NewReader(body)))
		defer stream.Close()
		for _, want := range []Event{{Type: EventStarted}, {Type: EventDelta, Delta: content, FinishReason: reason}, {Type: EventCompleted, FinishReason: reason}} {
			got, err := stream.Recv(context.Background())
			if err != nil || !reflect.DeepEqual(got, want) {
				t.Fatal("SSE framing changed content, finish reason, or event order")
			}
		}
		if _, err := stream.Recv(context.Background()); !errors.Is(err, io.EOF) {
			t.Fatal("stream accepted data after completion")
		}
	})
}
