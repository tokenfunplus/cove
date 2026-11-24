// Package downloadnetwork owns routing preferences for model and speech downloads.
package downloadnetwork

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
)

type Settings struct {
	Mode     string `json:"mode"`
	ProxyURL string `json:"proxy_url"`
}

func Defaults() Settings { return Settings{Mode: "system"} }

func Normalize(value Settings) (Settings, error) {
	value.ProxyURL = strings.TrimSpace(value.ProxyURL)
	if value.Mode == "system" || value.Mode == "direct" {
		if value.ProxyURL != "" {
			return Settings{}, errors.New("A proxy address is only used in Manual proxy mode.")
		}
		return value, nil
	}
	if value.Mode != "manual" {
		return Settings{}, errors.New("Choose System proxy, Manual proxy, or Direct connection.")
	}
	u, err := url.Parse(value.ProxyURL)
	if err != nil || len(value.ProxyURL) > 2048 || u == nil || u.Opaque != "" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return Settings{}, errors.New("Use a proxy URL with a host and port, without credentials, paths, or query parameters.")
	}
	if u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "socks5" && u.Scheme != "socks5h" {
		return Settings{}, errors.New("Use an http://, https://, socks5://, or socks5h:// proxy URL.")
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 || strings.ContainsAny(u.Hostname(), " \t\r\n/\\") {
		return Settings{}, errors.New("Use a proxy host and a port between 1 and 65535.")
	}
	u.Host = net.JoinHostPort(strings.ToLower(u.Hostname()), strconv.Itoa(port))
	u.Path = ""
	value.ProxyURL = u.String()
	return value, nil
}

type Store interface {
	LoadDownloadNetwork(context.Context) (Settings, error)
	SaveDownloadNetwork(context.Context, Settings) error
}

type View struct {
	Configuration        Settings `json:"configuration"`
	SystemProxySupported bool     `json:"system_proxy_supported"`
}

type Target struct{ Name, URL string }
type proxyResolver func(context.Context, *url.URL) ([]*url.URL, bool, error)

type Service struct {
	mu       sync.RWMutex
	store    Store
	settings Settings
	loadErr  error
	targets  []Target
	resolve  proxyResolver
}

func New(store Store, targets []Target) *Service {
	value, err := store.LoadDownloadNetwork(context.Background())
	if err == nil {
		value, err = Normalize(value)
	}
	return &Service{store: store, settings: value, loadErr: err, targets: append([]Target(nil), targets...), resolve: systemProxy}
}

func (service *Service) Settings() (View, error) {
	service.mu.RLock()
	defer service.mu.RUnlock()
	if service.loadErr != nil {
		return View{}, errors.New("Download network settings could not be loaded. Save a new configuration in Settings > Network.")
	}
	return View{Configuration: service.settings, SystemProxySupported: systemProxySupported}, nil
}

func (service *Service) Save(ctx context.Context, value Settings) (View, error) {
	value, err := Normalize(value)
	if err != nil {
		return View{}, err
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	if err := service.store.SaveDownloadNetwork(ctx, value); err != nil {
		return View{}, errors.New("Download network settings could not be saved. The previous configuration is unchanged.")
	}
	service.settings, service.loadErr = value, nil
	return View{Configuration: value, SystemProxySupported: systemProxySupported}, nil
}

// Client snapshots preferences for one download, preserving its existing timeout
// and redirect policy. Saving settings does not reroute an in-flight transfer.
func (service *Service) Client(template *http.Client) (*http.Client, func(), error) {
	view, err := service.Settings()
	if err != nil {
		return nil, nil, err
	}
	return service.client(template, view.Configuration)
}
