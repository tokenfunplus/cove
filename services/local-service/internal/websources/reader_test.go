package websources

import (
	"compress/gzip"
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
)

func TestPublicDestinationsAndRedirects(t *testing.T) {
	for _, input := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.168.0.1", "0.0.0.0", "198.18.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "64:ff9b::7f00:1", "2002:7f00:1::"} {
		if publicAddress(netip.MustParseAddr(input)) {
			t.Errorf("accepted non-public address %s", input)
		}
	}
	for _, input := range []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"} {
		if !publicAddress(netip.MustParseAddr(input)) {
			t.Errorf("rejected public address %s", input)
		}
	}
	reader := NewReader()
	for _, input := range []string{"file:///etc/passwd", "http://127.0.0.1/", "http://[::1]/", "https://user:secret@example.com/", "https://example.com%25zone/"} {
		if _, err := reader.Fetch(context.Background(), input); err == nil {
			t.Errorf("accepted invalid target %s", input)
		}
	}
	if _, err := dialPublic(context.Background(), "tcp", "127.0.0.1:80"); err == nil {
		t.Fatal("dialer allowed a private destination")
	}
	target, _ := url.Parse("http://127.0.0.1/private")
	if err := reader.client.CheckRedirect(&http.Request{URL: target}, nil); err == nil {
		t.Fatal("redirect validation allowed a private destination")
	}
}

func fixtureReader(t *testing.T, handler http.HandlerFunc) *Reader {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	reader := NewReader()
	// Only this synthetic test transport maps a public fixture hostname to loopback.
	reader.client.Transport.(*http.Transport).DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, strings.TrimPrefix(server.URL, "http://"))
	}
	return reader
}

func TestReaderExtractsSnapshotsAndBoundsDecodedBodies(t *testing.T) {
	articleText := strings.Repeat("Synthetic research evidence for a local webpage fixture. ", 30)
	reader := fixtureReader(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "" || request.Header.Get("Cookie") != "" || request.Header.Get("X-Cove-Session-Token") != "" {
			t.Error("local credentials reached the webpage")
		}
		switch request.URL.Path {
		case "/redirect":
			http.Redirect(writer, request, "http://127.0.0.1/private", http.StatusFound)
		case "/oversized":
			writer.Header().Set("Content-Encoding", "gzip")
			writer.Header().Set("Content-Type", "text/plain")
			compressed := gzip.NewWriter(writer)
			_, _ = compressed.Write([]byte(strings.Repeat("x", (4<<20)+1)))
			_ = compressed.Close()
		case "/binary":
			writer.Header().Set("Content-Type", "application/octet-stream")
			_, _ = writer.Write([]byte{0, 1, 2})
		case "/login":
			writer.WriteHeader(http.StatusForbidden)
		default:
			writer.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = fmt.Fprintf(writer, "<html><head><title>Fixture article</title></head><body><nav>Navigation</nav><article><h1>Fixture article</h1><p>%s</p><p>Unicode \u4e2d\u6587.</p></article><script>ignoredScript()</script></body></html>", articleText)
		}
	})
	source, err := reader.Fetch(context.Background(), "http://fixture.example/article#section")
	if err != nil {
		t.Fatal(err)
	}
	if source.Web == nil || source.Web.OriginalURL != "http://fixture.example/article" || len(source.ID) != 64 || len(source.Web.ContentSHA256) != 64 || source.Web.FetchedAt == "" || source.ExtractionVersion != "cove-web-readability-v1" {
		t.Fatalf("missing webpage identity: %#v", source.Snapshot)
	}
	var text strings.Builder
	for _, section := range source.Sections {
		text.WriteString(section.Text)
	}
	if !strings.Contains(text.String(), "Synthetic research") || !strings.Contains(text.String(), "\u4e2d\u6587") || strings.Contains(text.String(), "ignoredScript") || !strings.Contains(string(source.Data), "<html>") {
		t.Fatal("source text or original bytes were lost")
	}
	for _, path := range []string{"redirect", "oversized", "binary", "login"} {
		if _, err := reader.Fetch(context.Background(), "http://fixture.example/"+path); err == nil {
			t.Errorf("accepted invalid response %s", path)
		}
	}
}

func TestReaderCancelsAnActiveDownload(t *testing.T) {
	started := make(chan struct{})
	reader := fixtureReader(t, func(writer http.ResponseWriter, request *http.Request) {
		close(started)
		<-request.Context().Done()
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := reader.Fetch(ctx, "http://fixture.example/slow"); done <- err }()
	<-started
	cancel()
	if err := <-done; err == nil {
		t.Fatal("cancelled download succeeded")
	}
}
