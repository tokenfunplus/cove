package provider

import (
	"context"
	"encoding/json"
	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStreamCarriesUsageOnlyChunksWithoutFabricatingMissingCounts(t *testing.T) {
	for _, value := range []string{`{"prompt_tokens":0,"completion_tokens":42}`, `{"completion_tokens":42}`} {
		stream := newSSECompletionStream(io.NopCloser(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"Answer\"}}]}\n\ndata: {\"choices\":[],\"usage\":" + value + "}\n\ndata: [DONE]\n\n")))
		for {
			event, err := stream.Recv(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if event.Type != EventCompleted {
				continue
			}
			if event.Usage == nil || event.Usage.OutputTokens == nil || *event.Usage.OutputTokens != 42 {
				t.Fatalf("usage = %#v", event.Usage)
			}
			if strings.Contains(value, "prompt_tokens") && (event.Usage.InputTokens == nil || *event.Usage.InputTokens != 0) {
				t.Fatal("lost zero input usage")
			}
			if !strings.Contains(value, "prompt_tokens") && event.Usage.InputTokens != nil {
				t.Fatal("invented input usage")
			}
			break
		}
	}
}

func TestUsageRequestFallsBackOnlyForAnExplicitOptionalFieldRejection(t *testing.T) {
	for _, rejection := range []string{`{"error":{"message":"Unknown field stream_options"}}`, `{"error":{"message":"Invalid model"}}`} {
		calls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls++
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if calls == 1 {
				if body["stream_options"] == nil {
					t.Error("usage was not requested")
				}
				w.WriteHeader(400)
				_, _ = w.Write([]byte(rejection))
				return
			}
			if body["stream_options"] != nil {
				t.Error("unsupported option was repeated")
			}
			_, _ = w.Write([]byte("data: [DONE]\n\n"))
		}))
		profile, err := NormalizeProfile(Profile{Kind: KindOpenAICompatible, Name: "Fixture", Endpoint: server.URL, Model: "model", AuthMethod: AuthBearer})
		if err != nil {
			t.Fatal(err)
		}
		stream, err := NewHTTPAdapter(server.Client()).Stream(context.Background(), CompletionInput{Profile: profile, Secret: credentials.Secret{Value: "fixture-key"}})
		if strings.Contains(rejection, "stream_options") {
			if err != nil || calls != 2 {
				t.Fatalf("fallback: calls=%d err=%v", calls, err)
			}
		} else if err == nil || calls != 1 {
			t.Fatalf("unrelated rejection retried: calls=%d err=%v", calls, err)
		}
		if stream != nil {
			_ = stream.Close()
		}
		server.Close()
	}
}

func TestChatReasoningFieldsStaySeparateFromAnswerText(t *testing.T) {
	for _, field := range []string{"reasoning_content", "reasoning"} {
		event, _, err := parseSSEData(`{"choices":[{"delta":{"` + field + `":"Plan the answer.","content":"Final answer."}}]}`)
		if err != nil || event.Delta != "Final answer." || event.ReasoningDelta != "Plan the answer." {
			t.Fatalf("reasoning projection: %#v, %v", event, err)
		}
	}
}
