package main

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// The fixture transport returns authored results in process. A real endpoint is
// contacted only when the author explicitly supplied its loopback address.
type previewModel struct {
	name     string
	endpoint *url.URL
	response string
	real     *http.Transport
}

type previewChoice struct {
	Index        int               `json:"index"`
	Delta        map[string]string `json:"delta"`
	FinishReason *string           `json:"finish_reason"`
}

type previewCompletionChunk struct {
	Choices []previewChoice `json:"choices"`
}

func newPreviewModel(address, response string) (*previewModel, error) {
	real := address != ""
	if !real {
		address = "http://127.0.0.1/v1"
	}
	endpoint, err := url.Parse(address)
	if err != nil || endpoint.Scheme != "http" && endpoint.Scheme != "https" || !net.ParseIP(endpoint.Hostname()).IsLoopback() || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" || (endpoint.Path != "" && endpoint.Path != "/" && strings.TrimSuffix(endpoint.Path, "/") != "/v1") {
		return nil, errors.New("choose a loopback model URL such as http://127.0.0.1:8080/v1")
	}
	if response == "" {
		response = "Example response from the preview fixture."
	}
	model := &previewModel{name: "Simulated author model", endpoint: endpoint, response: response}
	if real {
		model.name = "Author-selected local endpoint"
		model.real = http.DefaultTransport.(*http.Transport).Clone()
		model.real.Proxy = nil
	}
	return model, nil
}

func (m *previewModel) Close() {
	if m.real != nil {
		m.real.CloseIdleConnections()
	}
}

func (m *previewModel) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme != m.endpoint.Scheme || r.URL.Host != m.endpoint.Host {
		return nil, errors.New("destination outside preview model endpoint")
	}
	var content, body string
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/v1/models":
		content = "application/json"
		body = `{"data":[{"id":"fixture-model","object":"model"}]}`
	case r.Method == http.MethodPost && r.URL.Path == "/v1/chat/completions":
		content = "text/event-stream"
		stop := "stop"
		chunks := []previewCompletionChunk{
			{Choices: []previewChoice{{Index: 0, Delta: map[string]string{"content": m.response}}}},
			{Choices: []previewChoice{{Index: 0, Delta: map[string]string{}, FinishReason: &stop}}},
		}
		var stream strings.Builder
		for _, chunk := range chunks {
			encoded, err := json.Marshal(chunk)
			if err != nil {
				return nil, err
			}
			stream.WriteString("data: ")
			stream.Write(encoded)
			stream.WriteString("\n\n")
		}
		stream.WriteString("data: [DONE]\n\n")
		body = stream.String()
	default:
		return nil, errors.New("unsupported preview model operation")
	}
	if m.real != nil {
		return m.real.RoundTrip(r)
	}
	if r.Body != nil {
		r.Body.Close()
	}
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {content}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
}
