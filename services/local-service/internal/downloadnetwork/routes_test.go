package downloadnetwork

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func pacClient(t *testing.T, routes []*url.URL, resolveErr error, dial func(context.Context, string, string) (net.Conn, error)) *http.Client {
	t.Helper()
	service := New(&memoryStore{value: Defaults()}, nil)
	service.resolve = func(context.Context, *url.URL) ([]*url.URL, bool, error) { return routes, true, resolveErr }
	client, cleanup, err := service.Client(&http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{DialContext: dial}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cleanup)
	return client
}

func proxyAddress(value string) *url.URL { parsed, _ := url.Parse(value); return parsed }

func TestPACFallbackPreservesOrderAndExplicitDirect(t *testing.T) {
	for _, scenario := range []struct {
		scheme string
		direct bool
	}{{"http", false}, {"http", true}, {"socks5", false}, {"socks5", true}} {
		direct := scenario.direct
		t.Run(scenario.scheme+" "+map[bool]string{false: "next proxy", true: "explicit DIRECT"}[direct], func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "model fixture") }))
			defer server.Close()
			bad := proxyAddress(scenario.scheme + "://offline.invalid:7890")
			routes := []*url.URL{bad, proxyAddress(server.URL)}
			want := []string{bad.Host, routes[1].Host}
			if direct {
				routes[1] = nil
				want[1] = "artifact.invalid:80"
			}
			var mu sync.Mutex
			var attempts []string
			client := pacClient(t, routes, nil, func(ctx context.Context, network, address string) (net.Conn, error) {
				mu.Lock()
				attempts = append(attempts, address)
				mu.Unlock()
				if address == bad.Host {
					return nil, &net.OpError{Op: "dial", Net: network, Err: errors.New("synthetic proxy refusal")}
				}
				return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
			})
			response, err := client.Get("http://artifact.invalid/model")
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			data, err := io.ReadAll(response.Body)
			if err != nil || string(data) != "model fixture" {
				t.Fatalf("fallback artifact: %q %v", data, err)
			}
			mu.Lock()
			defer mu.Unlock()
			if !reflect.DeepEqual(attempts, want) {
				t.Fatalf("PAC order %v, want %v", attempts, want)
			}
		})
	}
}

func TestPACDoesNotInventFallbackOrReplayBodies(t *testing.T) {
	t.Setenv("http_proxy", "http://environment.invalid:9999")
	t.Setenv("HTTP_PROXY", "http://environment.invalid:9999")
	for _, scenario := range []struct {
		name, method string
		routes       []*url.URL
		resolveErr   error
		canceled     bool
		wantCalls    int
	}{
		{"no implicit DIRECT", "GET", []*url.URL{proxyAddress("http://offline.invalid:7890")}, nil, false, 1},
		{"resolution fails closed", "GET", nil, errors.New("private PAC location"), false, 0},
		{"empty system list fails closed", "GET", nil, nil, false, 0},
		{"body is not replayed", "POST", []*url.URL{proxyAddress("http://offline.invalid:7890"), nil}, nil, false, 1},
		{"cancellation stops fallback", "GET", []*url.URL{proxyAddress("http://offline.invalid:7890"), nil}, nil, true, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			var mu sync.Mutex
			calls := 0
			client := pacClient(t, scenario.routes, scenario.resolveErr, func(ctx context.Context, network, address string) (net.Conn, error) {
				mu.Lock()
				calls++
				mu.Unlock()
				if address != "offline.invalid:7890" {
					t.Errorf("invented fallback: %s", address)
				}
				return nil, &net.OpError{Op: "dial", Net: network, Err: errors.New("synthetic proxy refusal")}
			})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if scenario.canceled {
				cancel()
			}
			request, _ := http.NewRequestWithContext(ctx, scenario.method, "http://artifact.invalid/model", nil)
			if scenario.method == "POST" {
				request.Body = io.NopCloser(strings.NewReader("do not replay"))
			}
			_, err := client.Do(request)
			if err == nil || strings.Contains(err.Error(), "private PAC location") {
				t.Fatal("missing or unsafe failure")
			}
			mu.Lock()
			defer mu.Unlock()
			if calls != scenario.wantCalls {
				t.Fatalf("attempted %d connections, want %d", calls, scenario.wantCalls)
			}
		})
	}
}

func TestPACDoesNotFallbackAfterHTTPResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) }))
	defer server.Close()
	var mu sync.Mutex
	calls := 0
	client := pacClient(t, []*url.URL{proxyAddress(server.URL), nil}, nil, func(ctx context.Context, network, address string) (net.Conn, error) {
		mu.Lock()
		calls++
		mu.Unlock()
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	})
	response, err := client.Get("http://artifact.invalid/model")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	mu.Lock()
	defer mu.Unlock()
	if response.StatusCode != http.StatusServiceUnavailable || calls != 1 {
		t.Fatal("HTTP response was retried through another route")
	}
}
