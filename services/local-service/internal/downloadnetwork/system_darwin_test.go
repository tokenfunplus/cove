//go:build darwin && cgo

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
	"testing"
)

func TestNativePACFallbackReachesNextProxy(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "model fixture") }))
	defer server.Close()
	target, _ := url.Parse("http://artifact.invalid/model")
	script := `function FindProxyForURL(url, host) { return "PROXY offline.invalid:7890; PROXY ` + server.Listener.Addr().String() + `; DIRECT"; }`
	routes, configured, err := proxyForPAC(script, target)
	if err != nil || !configured {
		t.Fatalf("PAC resolution: %v", err)
	}
	client := pacClient(t, routes, nil, func(ctx context.Context, network, address string) (net.Conn, error) {
		if address == "offline.invalid:7890" {
			return nil, &net.OpError{Op: "dial", Net: network, Err: errors.New("synthetic refusal")}
		}
		if address != server.Listener.Addr().String() {
			t.Errorf("unexpected route: %s", address)
		}
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	})
	response, err := client.Get(target.String())
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil || string(data) != "model fixture" {
		t.Fatal("native PAC fallback did not reach the next proxy")
	}
}

func TestNativePACResolution(t *testing.T) {
	target, _ := url.Parse("https://huggingface.co/model")
	for _, scenario := range []struct {
		result string
		want   []string
	}{
		{"PROXY localhost:7890; DIRECT", []string{"http://localhost:7890", "DIRECT"}},
		{"SOCKS localhost:1080; PROXY backup.example:8080; DIRECT", []string{"socks5://localhost:1080", "http://backup.example:8080", "DIRECT"}},
		{"DIRECT", []string{"DIRECT"}},
	} {
		routes, configured, err := proxyForPAC(`function FindProxyForURL(url, host) { return "`+scenario.result+`"; }`, target)
		if err != nil || !configured {
			t.Fatalf("PAC: %v configured=%v", err, configured)
		}
		var got []string
		for _, route := range routes {
			name := "DIRECT"
			if route != nil {
				name = route.String()
			}
			got = append(got, name)
		}
		if !reflect.DeepEqual(got, scenario.want) {
			t.Fatalf("PAC routes %v want %v", got, scenario.want)
		}
	}
	if _, _, err := proxyForPAC("invalid javascript!", target); err == nil {
		t.Fatal("invalid PAC accepted")
	}
}
