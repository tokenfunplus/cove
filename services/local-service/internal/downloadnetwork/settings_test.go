package downloadnetwork

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

type memoryStore struct {
	value            Settings
	loadErr, saveErr error
}

func (s *memoryStore) LoadDownloadNetwork(context.Context) (Settings, error) {
	return s.value, s.loadErr
}
func (s *memoryStore) SaveDownloadNetwork(_ context.Context, value Settings) error {
	if s.saveErr != nil {
		return s.saveErr
	}
	s.value = value
	return nil
}

func TestNormalize(t *testing.T) {
	for _, input := range []Settings{
		{Mode: "other"}, {Mode: "direct", ProxyURL: "http://localhost:1"},
		{Mode: "manual"}, {Mode: "manual", ProxyURL: "ftp://localhost:1"},
		{Mode: "manual", ProxyURL: "http://private-user:private-password@localhost:1"},
		{Mode: "manual", ProxyURL: "http://localhost"}, {Mode: "manual", ProxyURL: "http://localhost:65536"},
		{Mode: "manual", ProxyURL: "http://localhost:1/path"}, {Mode: "manual", ProxyURL: "http://localhost:1?"},
		{Mode: "manual", ProxyURL: "http://localhost:1?token=private-token"}, {Mode: "manual", ProxyURL: "http://localhost:1#x"},
	} {
		_, err := Normalize(input)
		if err == nil || strings.Contains(err.Error(), "private-") {
			t.Errorf("expected sanitized validation error for mode %s", input.Mode)
		}
	}
	for input, want := range map[string]string{
		" http://LOCALHOST:7890/ ": "http://localhost:7890", "socks5://[::1]:1080": "socks5://[::1]:1080", "https://proxy.example:443": "https://proxy.example:443", "socks5h://localhost:1080": "socks5h://localhost:1080",
	} {
		got, err := Normalize(Settings{Mode: "manual", ProxyURL: input})
		if err != nil || got.ProxyURL != want {
			t.Fatalf("normalize: %v %v", got, err)
		}
	}
}

func TestSettingsSnapshotAndFailedSave(t *testing.T) {
	store := &memoryStore{value: Defaults()}
	service := New(store, nil)
	service.resolve = func(context.Context, *url.URL) ([]*url.URL, bool, error) { return []*url.URL{nil}, true, nil }
	client, closeOld, err := service.Client(&http.Client{Timeout: time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }})
	if err != nil {
		t.Fatal(err)
	}
	defer closeOld()
	manual := Settings{Mode: "manual", ProxyURL: "http://localhost:7890"}
	if _, err = service.Save(context.Background(), manual); err != nil {
		t.Fatal(err)
	}
	request, _ := http.NewRequest("GET", "https://huggingface.co/model", nil)
	old, err := singleRoute(client, request)
	if err != nil || old != nil || client.Timeout != time.Minute || client.CheckRedirect(request, nil) != http.ErrUseLastResponse {
		t.Fatal("snapshot or client policy changed")
	}
	next, cleanup, err := service.Client(client)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	route, err := singleRoute(next, request)
	if err != nil || route.String() != manual.ProxyURL {
		t.Fatal("new settings not applied")
	}
	store.saveErr = errors.New("private-file-path")
	if _, err = service.Save(context.Background(), Settings{Mode: "direct"}); err == nil || strings.Contains(err.Error(), "private-file-path") {
		t.Fatal("unsafe save error")
	}
	view, _ := service.Settings()
	if view.Configuration != manual {
		t.Fatal("failed save changed route")
	}
	store.loadErr = errors.New("private-file-path")
	broken := New(store, nil)
	if _, _, err = broken.Client(client); err == nil {
		t.Fatal("corrupt settings must fail closed")
	}
	store.saveErr = nil
	if _, err = broken.Save(context.Background(), Defaults()); err != nil {
		t.Fatal(err)
	}
}

func TestSystemPrecedenceAndLoopbackBypass(t *testing.T) {
	t.Setenv("HTTPS_PROXY", "http://environment.example:8123")
	t.Setenv("https_proxy", "http://environment.example:8123")
	t.Setenv("NO_PROXY", "")
	t.Setenv("no_proxy", "")
	service := New(&memoryStore{value: Defaults()}, nil)
	request, _ := http.NewRequest("GET", "https://huggingface.co/model", nil)
	for _, scenario := range []struct {
		configured bool
		route      string
		fail       bool
		want       string
		wantErr    bool
	}{
		{false, "", false, "http://environment.example:8123", false}, {true, "", false, "", false},
		{true, "http://system.example:8080", false, "http://system.example:8080", false}, {true, "", true, "", true},
	} {
		service.resolve = func(context.Context, *url.URL) ([]*url.URL, bool, error) {
			if scenario.fail {
				return nil, true, errors.New("private-pac-url")
			}
			if scenario.route == "" {
				return []*url.URL{nil}, scenario.configured, nil
			}
			u, _ := url.Parse(scenario.route)
			return []*url.URL{u}, scenario.configured, nil
		}
		client, cleanup, err := service.Client(&http.Client{})
		if err != nil {
			t.Fatal(err)
		}
		u, err := singleRoute(client, request)
		cleanup()
		if (err != nil) != scenario.wantErr {
			t.Fatal("wrong system error behavior")
		}
		if err != nil {
			if strings.Contains(err.Error(), "private-pac-url") {
				t.Fatal("leaked resolver error")
			}
			continue
		}
		got := ""
		if u != nil {
			got = u.String()
		}
		if got != scenario.want {
			t.Fatalf("route %q want %q", got, scenario.want)
		}
	}
	for _, mode := range []Settings{Defaults(), {Mode: "direct"}, {Mode: "manual", ProxyURL: "http://localhost:7890"}} {
		client, cleanup, err := service.client(&http.Client{}, mode)
		if err != nil {
			t.Fatal(err)
		}
		for _, host := range []string{"localhost", "127.0.0.1", "[::1]", "worker.localhost"} {
			r, _ := http.NewRequest("GET", "http://"+host+":1234/", nil)
			u, err := singleRoute(client, r)
			if err != nil || u != nil {
				t.Fatal("loopback was proxied")
			}
		}
		cleanup()
	}
}

func TestManualHTTPProxyAndDirectLoopback(t *testing.T) {
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Host != "unresolvable.invalid" {
			t.Error("proxy did not receive destination")
		}
		io.WriteString(w, "via-proxy")
	}))
	defer proxyServer.Close()
	service := New(&memoryStore{value: Settings{Mode: "manual", ProxyURL: proxyServer.URL}}, nil)
	client, cleanup, err := service.Client(&http.Client{Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	response, err := client.Get("http://unresolvable.invalid/model")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(response.Body)
	if string(data) != "via-proxy" {
		t.Fatal("manual proxy unused")
	}
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "direct") }))
	defer direct.Close()
	response, err = client.Get(direct.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, _ = io.ReadAll(response.Body)
	if string(data) != "direct" {
		t.Fatal("loopback did not bypass proxy")
	}
}

func TestManualSOCKS5Proxy(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	done := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			done <- err
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		header := make([]byte, 2)
		if _, err = io.ReadFull(conn, header); err != nil {
			done <- err
			return
		}
		methods := make([]byte, int(header[1]))
		_, err = io.ReadFull(conn, methods)
		if err != nil {
			done <- err
			return
		}
		_, _ = conn.Write([]byte{5, 0})
		request := make([]byte, 5)
		if _, err = io.ReadFull(conn, request); err != nil {
			done <- err
			return
		}
		if request[3] != 3 {
			done <- errors.New("destination was not resolved through SOCKS")
			return
		}
		rest := make([]byte, int(request[4])+2)
		if _, err = io.ReadFull(conn, rest); err != nil {
			done <- err
			return
		}
		if string(rest[:len(rest)-2]) != "unresolvable.invalid" {
			done <- errors.New("wrong SOCKS destination")
			return
		}
		_, _ = conn.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 80})
		buf := make([]byte, 4096)
		_, err = conn.Read(buf)
		if err == nil {
			_, err = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nsocks")
		}
		done <- err
	}()
	service := New(&memoryStore{value: Settings{Mode: "manual", ProxyURL: "socks5://" + listener.Addr().String()}}, nil)
	client, cleanup, err := service.Client(&http.Client{Timeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	response, err := client.Get("http://unresolvable.invalid/model")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(response.Body)
	if string(data) != "socks" {
		t.Fatal("SOCKS route unused")
	}
	if err = <-done; err != nil {
		t.Fatal(err)
	}
}

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type countedBody struct {
	read   int
	closed bool
}

func (b *countedBody) Read(p []byte) (int, error) { b.read += len(p); return len(p), nil }
func (b *countedBody) Close() error               { b.closed = true; return nil }
func TestConnectionProbeBoundsAndSafeErrors(t *testing.T) {
	body := &countedBody{}
	client := &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Range") != "bytes=0-63" || r.Header.Get("Accept-Encoding") != "identity" {
			t.Error("unbounded test request")
		}
		return &http.Response{StatusCode: 206, Body: body, Header: make(http.Header)}, nil
	})}
	result := testSources(context.Background(), client, []Target{{"Model source", "https://huggingface.co/pinned-model"}})
	if !result.OK || body.read != 64 || !body.closed {
		t.Fatalf("probe not bounded: %+v read=%d closed=%v", result, body.read, body.closed)
	}
	client.Transport = roundTrip(func(*http.Request) (*http.Response, error) { return nil, errors.New("https://source/?private-token") })
	result = testSources(context.Background(), client, []Target{{"Model source", "https://huggingface.co/model"}, {"Invalid", "http://127.0.0.1:1234"}})
	if result.OK || strings.Contains(result.Checks[0].Message, "private-token") {
		t.Fatal("unsafe failure")
	}
}

func TestConnectionProbeDoesNotDrainRedirectBodies(t *testing.T) {
	for _, allowed := range []bool{true, false} {
		redirect, final := &countedBody{}, &countedBody{}
		calls := 0
		client := &http.Client{CheckRedirect: testRedirect, Transport: roundTrip(func(request *http.Request) (*http.Response, error) {
			calls++
			if calls == 1 {
				location := "https://cdn.hf.co/model"
				if !allowed {
					location = "https://untrusted.invalid/model"
				}
				return &http.Response{StatusCode: 302, ContentLength: 128, Header: http.Header{"Location": {location}}, Body: redirect}, nil
			}
			return &http.Response{StatusCode: 206, Header: make(http.Header), Body: final}, nil
		})}
		result := testSources(context.Background(), client, []Target{{"Model source", "https://huggingface.co/model"}})
		if result.OK != allowed || redirect.read != 0 || !redirect.closed {
			t.Fatalf("redirect body escaped the probe budget: allowed=%v read=%d closed=%v", allowed, redirect.read, redirect.closed)
		}
		if allowed && (calls != 2 || final.read != 64 || !final.closed) {
			t.Fatal("final source budget changed")
		}
		if !allowed && calls != 1 {
			t.Fatal("unsupported redirect was followed")
		}
	}
}

func singleRoute(client *http.Client, request *http.Request) (*url.URL, error) {
	routes, err := client.Transport.(*routeTransport).routes(request)
	if err != nil {
		return nil, err
	}
	return routes[0], nil
}
