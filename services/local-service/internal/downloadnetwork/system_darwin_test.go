//go:build darwin && cgo

package downloadnetwork

import (
	"net/url"
	"testing"
)

func TestNativePACResolution(t *testing.T) {
	target, _ := url.Parse("https://huggingface.co/model")
	for _, scenario := range []struct{ result, want string }{
		{"PROXY localhost:7890; DIRECT", "http://localhost:7890"},
		{"SOCKS localhost:1080; DIRECT", "socks5://localhost:1080"},
		{"DIRECT", ""},
	} {
		proxy, configured, err := proxyForPAC(`function FindProxyForURL(url, host) { return "`+scenario.result+`"; }`, target)
		if err != nil || !configured {
			t.Fatalf("PAC: %v configured=%v", err, configured)
		}
		got := ""
		if proxy != nil {
			got = proxy.String()
		}
		if got != scenario.want {
			t.Fatalf("PAC route %q want %q", got, scenario.want)
		}
	}
	if _, _, err := proxyForPAC("invalid javascript!", target); err == nil {
		t.Fatal("invalid PAC accepted")
	}
}
