package provider

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
)

func TestHTTPAdapterStreamsUnifiedEventsFromAnOpenAICompatibleSSEResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/chat/completions" {
			t.Fatalf("stream path = %q, want /v1/chat/completions", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("authorization = %q, want configured bearer key", request.Header.Get("Authorization"))
		}
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"Hel"))
		_, _ = writer.Write([]byte("lo\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n"))
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	profile, err := NormalizeProfile(Profile{
		Kind:       KindOpenAICompatible,
		Name:       "Fixture Provider",
		Endpoint:   server.URL,
		Model:      "model-a",
		AuthMethod: AuthBearer,
	})
	if err != nil {
		t.Fatalf("normalize profile: %v", err)
	}
	stream, err := NewHTTPAdapter(server.Client()).Stream(context.Background(), CompletionInput{
		Profile: profile,
		Secret:  credentials.Secret{Value: "test-key"},
		Messages: []ProviderMessage{{
			Role:    "user",
			Content: "Hello",
		}},
	})
	if err != nil {
		t.Fatalf("open completion stream: %v", err)
	}
	defer stream.Close()

	var events []Event
	for {
		event, err := stream.Recv(context.Background())
		if err != nil {
			t.Fatalf("receive completion event: %v", err)
		}
		events = append(events, event)
		if event.Type == EventCompleted {
			break
		}
	}
	if got, want := events, []Event{{Type: EventStarted}, {Type: EventDelta, Delta: "Hello"}, {Type: EventDelta, Delta: " world"}, {Type: EventCompleted}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("completion events = %#v, want %#v", got, want)
	}
}

func TestHTTPAdapterCarriesAProviderFinishReasonToTheCompletedEvent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n\n"))
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	stream := mustOpenTestStream(t, server.URL)
	defer stream.Close()
	var events []Event
	for {
		event, err := stream.Recv(context.Background())
		if err != nil {
			t.Fatalf("receive completion event: %v", err)
		}
		events = append(events, event)
		if event.Type == EventCompleted {
			break
		}
	}
	if got, want := events, []Event{{Type: EventStarted}, {Type: EventDelta, FinishReason: "length"}, {Type: EventCompleted, FinishReason: "length"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("completion events = %#v, want %#v", got, want)
	}
}

func TestHTTPAdapterSurfacesProviderErrorEventsWithoutLeakingRawResponseBodies(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"error\":{\"code\":\"model_error\",\"message\":\"model rejected\"}}\n\n"))
	}))
	defer server.Close()

	stream := mustOpenTestStream(t, server.URL)
	defer stream.Close()
	if _, err := stream.Recv(context.Background()); err != nil {
		t.Fatalf("receive started event: %v", err)
	}
	event, err := stream.Recv(context.Background())
	if err != nil {
		t.Fatalf("receive provider error event: %v", err)
	}
	if event.Type != EventFailed || event.ErrorCode != "provider_error" || event.ErrorMessage != "The Provider rejected the generation request." {
		t.Fatalf("provider error event = %#v, want classified failed event", event)
	}
}

func TestHTTPAdapterRejectsMalformedAndUnterminatedSSE(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "malformed JSON", body: "data: {not-json}\n\n"},
		{name: "missing terminal event", body: "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.Header().Set("Content-Type", "text/event-stream")
				_, _ = writer.Write([]byte(test.body))
			}))
			defer server.Close()

			stream := mustOpenTestStream(t, server.URL)
			defer stream.Close()
			if _, err := stream.Recv(context.Background()); err != nil {
				t.Fatalf("receive started event: %v", err)
			}
			_, err := stream.Recv(context.Background())
			if test.name == "missing terminal event" && err == nil {
				_, err = stream.Recv(context.Background())
			}
			if !errors.Is(err, ErrProtocol) {
				t.Fatalf("receive malformed or unterminated event error = %v, want protocol error", err)
			}
		})
	}
}

func TestHTTPAdapterRejectsAnOversizedSSELine(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: " + strings.Repeat("x", maxSSELineSize) + "\n\n"))
	}))
	defer server.Close()

	stream := mustOpenTestStream(t, server.URL)
	defer stream.Close()
	if _, err := stream.Recv(context.Background()); err != nil {
		t.Fatalf("receive started event: %v", err)
	}
	if _, err := stream.Recv(context.Background()); !errors.Is(err, ErrProtocol) {
		t.Fatalf("receive oversized event error = %v, want protocol error", err)
	}
}

func mustOpenTestStream(t *testing.T, endpoint string) CompletionStream {
	t.Helper()
	profile, err := NormalizeProfile(Profile{
		Kind:       KindOpenAICompatible,
		Name:       "Fixture Provider",
		Endpoint:   endpoint,
		Model:      "model-a",
		AuthMethod: AuthBearer,
	})
	if err != nil {
		t.Fatalf("normalize profile: %v", err)
	}
	stream, err := NewHTTPAdapter(nil).Stream(context.Background(), CompletionInput{
		Profile: profile,
		Secret:  credentials.Secret{Value: "test-key"},
	})
	if err != nil {
		t.Fatalf("open completion stream: %v", err)
	}
	return stream
}
