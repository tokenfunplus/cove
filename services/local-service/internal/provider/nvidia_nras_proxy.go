package provider

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"time"
)

const NvidiaNRASAttestationURL = "https://nras.attestation.nvidia.com/v3/attest/gpu"

var (
	ErrNvidiaNRASRedirect = errors.New("NVIDIA NRAS redirected the request")
	ErrNvidiaNRASUpstream = errors.New("NVIDIA NRAS is unavailable")
)

// NvidiaNRASProxy forwards opaque GPU evidence only to NVIDIA's fixed NRAS
// endpoint. The Browser Session credentials are deliberately not copied.
type NvidiaNRASProxy struct {
	client *http.Client
}

func NewNvidiaNRASProxy(client *http.Client) *NvidiaNRASProxy {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	clientCopy := *client
	clientCopy.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &NvidiaNRASProxy{client: &clientCopy}
}

func (proxy *NvidiaNRASProxy) Forward(writer http.ResponseWriter, request *http.Request, evidence []byte) error {
	if proxy == nil || proxy.client == nil {
		return ErrNvidiaNRASUpstream
	}
	upstream, err := http.NewRequestWithContext(request.Context(), http.MethodPost, NvidiaNRASAttestationURL, bytes.NewReader(evidence))
	if err != nil {
		return ErrNvidiaNRASUpstream
	}
	upstream.Header.Set("Content-Type", "application/json")
	response, err := proxy.client.Do(upstream)
	if err != nil {
		return ErrNvidiaNRASUpstream
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusMultipleChoices && response.StatusCode < http.StatusBadRequest {
		return ErrNvidiaNRASRedirect
	}

	copyNearAIProxyResponseHeaders(writer.Header(), response.Header)
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(response.StatusCode)
	_, _ = io.Copy(writer, response.Body)
	return nil
}
