package downloadnetwork

import (
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"sync"

	"golang.org/x/net/http/httpproxy"
)

// routeTransport retries bodyless downloads only when a connection fails before
// a response arrives. HTTP errors and partially consumed artifacts are not replayed.
type routeTransport struct {
	base        *http.Transport
	settings    Settings
	resolve     proxyResolver
	environment func(*url.URL) (*url.URL, error)
	mu          sync.Mutex
	transports  map[string]*http.Transport
}

func newRouteTransport(base *http.Transport, settings Settings, resolve proxyResolver) *routeTransport {
	return &routeTransport{base: base.Clone(), settings: settings, resolve: resolve,
		environment: httpproxy.FromEnvironment().ProxyFunc(), transports: make(map[string]*http.Transport)}
}

func (transport *routeTransport) routes(request *http.Request) ([]*url.URL, error) {
	if loopback(request.URL.Hostname()) || transport.settings.Mode == "direct" {
		return []*url.URL{nil}, nil
	}
	if transport.settings.Mode == "manual" {
		proxy, _ := url.Parse(transport.settings.ProxyURL)
		return []*url.URL{proxy}, nil
	}
	routes, configured, err := transport.resolve(request.Context(), request.URL)
	if err != nil || (configured && len(routes) == 0) {
		return nil, errors.New("The macOS proxy configuration could not be resolved. Test the connection in Settings > Network or choose Manual proxy.")
	}
	if configured {
		return routes, nil
	}
	proxy, err := transport.environment(request.URL)
	if err != nil {
		return nil, errors.New("The download proxy environment is invalid.")
	}
	return []*url.URL{proxy}, nil
}

func (transport *routeTransport) forRoute(proxy *url.URL) *http.Transport {
	key := "DIRECT"
	if proxy != nil {
		key = proxy.String()
	}
	transport.mu.Lock()
	defer transport.mu.Unlock()
	if cached := transport.transports[key]; cached != nil {
		return cached
	}
	client := transport.base.Clone()
	client.Proxy = http.ProxyURL(proxy)
	transport.transports[key] = client
	return client
}

func (transport *routeTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if err := request.Context().Err(); err != nil {
		if request.Body != nil {
			_ = request.Body.Close()
		}
		return nil, err
	}
	routes, err := transport.routes(request)
	if err != nil {
		if request.Body != nil {
			_ = request.Body.Close()
		}
		return nil, err
	}
	for _, route := range routes {
		if err := request.Context().Err(); err != nil {
			if request.Body != nil {
				_ = request.Body.Close()
			}
			return nil, err
		}
		response, attemptErr := transport.forRoute(route).RoundTrip(request.Clone(request.Context()))
		if attemptErr == nil || response != nil {
			return response, attemptErr
		}
		err = attemptErr
		var networkError net.Error
		connectionFailure := errors.As(err, &networkError) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
		if !connectionFailure || (request.Method != http.MethodGet && request.Method != http.MethodHead) ||
			(request.Body != nil && request.Body != http.NoBody) {
			break
		}
	}
	return nil, err
}

func (transport *routeTransport) CloseIdleConnections() {
	transport.mu.Lock()
	defer transport.mu.Unlock()
	for _, client := range transport.transports {
		client.CloseIdleConnections()
	}
}
