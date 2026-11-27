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
		message, _ := json.Marshal(m.response)
		body = "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":" + string(message) + "},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
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
