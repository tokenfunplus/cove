package downloadnetwork

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/http/httpproxy"
)

func loopback(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	return host == "localhost" || strings.HasSuffix(host, ".localhost") || net.ParseIP(host).IsLoopback()
}

func (service *Service) client(template *http.Client, value Settings) (*http.Client, func(), error) {
	value, err := Normalize(value)
	if err != nil {
		return nil, nil, err
	}
	base := template.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	transport, ok := base.(*http.Transport)
	if !ok {
		return nil, nil, errors.New("The download transport does not support proxy configuration.")
	}
	transport = transport.Clone()
	environment := httpproxy.FromEnvironment().ProxyFunc()
	manual, _ := url.Parse(value.ProxyURL)
	transport.Proxy = func(request *http.Request) (*url.URL, error) {
		if loopback(request.URL.Hostname()) || value.Mode == "direct" {
			return nil, nil
		}
		if value.Mode == "manual" {
			return manual, nil
		}
		resolved, configured, err := service.resolve(request.Context(), request.URL)
		if err != nil {
			return nil, errors.New("The macOS proxy configuration could not be resolved. Test the connection in Settings > Network or choose Manual proxy.")
		}
		if configured {
			return resolved, nil
		}
		return environment(request.URL)
	}
	client := *template
	client.Transport = transport
	return &client, transport.CloseIdleConnections, nil
}

type Check struct {
	Source  string `json:"source"`
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

type TestResult struct {
	OK     bool    `json:"ok"`
	Checks []Check `json:"checks"`
}

func allowedHost(host string) bool {
	return host == "huggingface.co" || strings.HasSuffix(host, ".hf.co") || strings.HasSuffix(host, ".huggingface.co") || host == "github.com" || host == "release-assets.githubusercontent.com" || host == "objects.githubusercontent.com"
}

// Test only visits fixed registry targets, reads at most 64 bytes per source,
// and does not persist the draft settings or start an installation.
func (service *Service) Test(ctx context.Context, value Settings) (TestResult, error) {
	if len(service.targets) == 0 {
		return TestResult{}, errors.New("Connection test sources are unavailable.")
	}
	client, closeClient, err := service.client(&http.Client{Timeout: 12 * time.Second, CheckRedirect: func(request *http.Request, via []*http.Request) error {
		if len(via) > 8 || request.URL.Scheme != "https" || !allowedHost(request.URL.Hostname()) {
			return errors.New("The download source redirected to an unsupported destination.")
		}
		request.Header.Del("Authorization")
		return nil
	}}, value)
	if err != nil {
		return TestResult{}, err
	}
	defer closeClient()
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	return testSources(ctx, client, service.targets), nil
}

func testSources(ctx context.Context, client *http.Client, targets []Target) TestResult {
	result := TestResult{OK: true, Checks: make([]Check, len(targets))}
	var workers sync.WaitGroup
	for i, target := range targets {
		workers.Add(1)
		go func() {
			defer workers.Done()
			check := Check{Source: target.Name, Message: "The download source could not be reached. Check your network or proxy address and try again."}
			defer func() { result.Checks[i] = check }()
			u, err := url.Parse(target.URL)
			if err != nil || u.Scheme != "https" || !allowedHost(u.Hostname()) || u.User != nil {
				check.Message = "The connection test source is unavailable."
				return
			}
			request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.URL, nil)
			if err != nil {
				return
			}
			request.Header.Set("Range", "bytes=0-63")
			request.Header.Set("Accept-Encoding", "identity")
			response, err := client.Do(request)
			if err != nil {
				return
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
				check.Message = "The source responded but could not serve the download. Try again later."
				return
			}
			n, err := io.Copy(io.Discard, io.LimitReader(response.Body, 64))
			check.OK = err == nil && n > 0
			if check.OK {
				check.Message = "Download source reached."
			}
		}()
	}
	workers.Wait()
	for _, check := range result.Checks {
		result.OK = result.OK && check.OK
	}
	return result
}
