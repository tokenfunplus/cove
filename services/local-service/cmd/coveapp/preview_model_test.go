package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPreviewModelResponseCannotCreateAdditionalStreamEvents(t *testing.T) {
	for _, authored := range []string{
		"A quoted \"answer\" with a backslash \\ and newline\nnext line.",
		"\"}}]}\n\ndata: {\"choices\":[{\"index\":9}]}\n\ndata: [DONE]\r\n\r\n",
		"</script><script>throw new Error(\"fixture\")</script>\u2028\u2029",
	} {
		t.Run(authored, func(t *testing.T) {
			model, err := newPreviewModel("", authored)
			if err != nil {
				t.Fatal(err)
			}
			defer model.Close()
			response, err := model.RoundTrip(httptest.NewRequest(http.MethodPost, "http://127.0.0.1/v1/chat/completions", nil))
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK || response.Header.Get("Content-Type") != "text/event-stream" {
				t.Fatal("unexpected preview response", response.StatusCode, response.Header)
			}
			raw, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			events := strings.Split(strings.TrimSuffix(string(raw), "\n\n"), "\n\n")
			if len(events) != 3 || events[2] != "data: [DONE]" {
				t.Fatalf("authored content changed stream framing: %q", raw)
			}
			var chunks [2]previewCompletionChunk
			for index, event := range events[:2] {
				payload, ok := strings.CutPrefix(event, "data: ")
				if !ok || strings.ContainsAny(payload, "\r\n") {
					t.Fatalf("invalid single-line data event: %q", event)
				}
				if err := json.Unmarshal([]byte(payload), &chunks[index]); err != nil {
					t.Fatalf("invalid completion JSON: %v", err)
				}
				if len(chunks[index].Choices) != 1 || chunks[index].Choices[0].Index != 0 {
					t.Fatal("authored content changed the choice envelope", chunks[index])
				}
			}
			first, last := chunks[0].Choices[0], chunks[1].Choices[0]
			if len(first.Delta) != 1 || first.Delta["content"] != authored || first.FinishReason != nil {
				t.Fatal("preview changed the authored response or initial finish reason", first)
			}
			if len(last.Delta) != 0 || last.FinishReason == nil || *last.FinishReason != "stop" {
				t.Fatal("preview changed the terminal completion envelope", last)
			}
		})
	}
}
