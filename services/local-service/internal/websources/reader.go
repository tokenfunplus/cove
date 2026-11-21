// Package websources retrieves bounded public webpages and extracts source text.
package websources

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	readability "codeberg.org/readeck/go-readability/v2"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"golang.org/x/net/html/charset"
)

const Timeout = 15 * time.Second

type Reader struct {
	client *http.Client
	slots  chan struct{}
}

func NewReader() *Reader {
	transport := &http.Transport{
		DialContext:            dialPublic,
		TLSHandshakeTimeout:    5 * time.Second,
		ResponseHeaderTimeout:  10 * time.Second,
		MaxResponseHeaderBytes: 64 << 10,
		DisableKeepAlives:      true,
	}
	return &Reader{client: &http.Client{
		Transport: transport,
		Timeout:   Timeout,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) > 3 {
				return fmt.Errorf("too many redirects")
			}
			return validateURL(request.URL)
		},
	}, slots: make(chan struct{}, 2)}
}

func invalid(message string) error {
	return fmt.Errorf("%w: %s", documents.ErrInvalidDocument, message)
}

func validateURL(target *url.URL) error {
	if (target.Scheme != "https" && target.Scheme != "http") || target.Hostname() == "" || target.User != nil || target.Opaque != "" {
		return invalid("Enter a public HTTP or HTTPS webpage URL without embedded credentials.")
	}
	if strings.ContainsAny(target.Hostname(), "\\%") {
		return invalid("The webpage host is invalid.")
	}
	if address, err := netip.ParseAddr(target.Hostname()); err == nil && !publicAddress(address) {
		return invalid("Webpage reading requires a public internet address.")
	}
	return nil
}

var restrictedNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("64:ff9b::/96"), netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("2001::/32"), netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
}

func publicAddress(address netip.Addr) bool {
	address = address.Unmap()
	if !address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() {
		return false
	}
	for _, network := range restrictedNetworks {
		if network.Contains(address) {
			return false
		}
	}
	return true
}

// Resolve and dial the same checked address, preserving HTTP Host and TLS SNI.
func dialPublic(ctx context.Context, network, destination string) (net.Conn, error) {
	dialer := net.Dialer{Timeout: 5 * time.Second}
	return (publicDialer{lookup: net.DefaultResolver.LookupNetIP, dial: dialer.DialContext}).DialContext(ctx, network, destination)
}

type publicDialer struct {
	lookup func(context.Context, string, string) ([]netip.Addr, error)
	dial   func(context.Context, string, string) (net.Conn, error)
}

func (dialer publicDialer) DialContext(ctx context.Context, network, destination string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(destination)
	if err != nil {
		return nil, invalid("The webpage host is invalid.")
	}
	addresses, err := dialer.lookup(ctx, "ip", host)
	if err != nil || len(addresses) == 0 {
		return nil, invalid("The webpage host could not be resolved.")
	}
	for _, address := range addresses {
		if !publicAddress(address) {
			return nil, invalid("Webpage reading requires a public internet address.")
		}
	}
	for _, address := range addresses {
		connection, dialErr := dialer.dial(ctx, network, net.JoinHostPort(address.String(), port))
		if dialErr == nil {
			return connection, nil
		}
	}
	return nil, invalid("The webpage connection could not be established.")
}

func (reader *Reader) Fetch(ctx context.Context, sourceURL string) (documents.Prepared, error) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	select {
	case reader.slots <- struct{}{}:
		defer func() { <-reader.slots }()
	case <-ctx.Done():
		return documents.Prepared{}, ctx.Err()
	}
	target, err := url.Parse(strings.TrimSpace(sourceURL))
	if err != nil {
		return documents.Prepared{}, invalid("Enter a valid webpage URL.")
	}
	if err := validateURL(target); err != nil {
		return documents.Prepared{}, err
	}
	target.Fragment = ""
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return documents.Prepared{}, invalid("Enter a valid webpage URL.")
	}
	request.Header.Set("User-Agent", "Cove/1.0 (webpage reader)")
	request.Header.Set("Accept", "text/html, application/xhtml+xml, text/plain;q=0.9")
	response, err := reader.client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return documents.Prepared{}, invalid("Webpage reading was cancelled or exceeded 15 seconds.")
		}
		return documents.Prepared{}, invalid("The webpage could not be reached. Check the URL and try again.")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return documents.Prepared{}, invalid(fmt.Sprintf("The webpage returned HTTP %d. It may require login or block automated reading.", response.StatusCode))
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, documents.MaxFileBytes+1))
	if err != nil {
		return documents.Prepared{}, invalid("The webpage download was interrupted.")
	}
	if len(data) == 0 || len(data) > documents.MaxFileBytes {
		return documents.Prepared{}, invalid("A webpage must contain between 1 byte and 4 MiB.")
	}
	contentType := response.Header.Get("Content-Type")
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	mediaType, parameters, err := mime.ParseMediaType(contentType)
	if err != nil || (mediaType != "text/html" && mediaType != "application/xhtml+xml" && mediaType != "text/plain") {
		return documents.Prepared{}, invalid("Choose an HTML or plain-text webpage.")
	}
	var decoded io.Reader = bytes.NewReader(data)
	if mediaType != "text/plain" || parameters["charset"] != "" || !utf8.Valid(data) {
		decoded, err = charset.NewReader(decoded, contentType)
		if err != nil {
			return documents.Prepared{}, invalid("The webpage character encoding could not be read.")
		}
	}
	var text bytes.Buffer
	title := response.Request.URL.Hostname()
	if mediaType == "text/plain" {
		_, err = io.Copy(&text, io.LimitReader(decoded, documents.MaxFileBytes+1))
	} else {
		article, parseErr := readability.FromReader(decoded, response.Request.URL)
		if parseErr != nil {
			return documents.Prepared{}, invalid("The webpage has no readable article. It may require JavaScript or login.")
		}
		title = article.Title()
		err = article.RenderText(&text)
	}
	if err != nil || text.Len() > documents.MaxFileBytes {
		return documents.Prepared{}, invalid("The webpage text could not be extracted within the source limits.")
	}
	if strings.TrimSpace(text.String()) == "" {
		return documents.Prepared{}, invalid("The webpage has no readable text. It may require JavaScript or login.")
	}
	prepared, err := documents.Parse(ctx, documents.Input{Name: "webpage.txt", Data: text.Bytes()})
	if err != nil {
		return documents.Prepared{}, err
	}
	title = strings.Join(strings.FieldsFunc(title, func(character rune) bool {
		return unicode.IsControl(character) || character == '/' || character == '\\'
	}), " ")
	if title == "" {
		title = response.Request.URL.Hostname()
	}
	titleRunes := []rune(title)
	if len(titleRunes) > 190 {
		title = string(titleRunes[:190])
	}
	digest := sha256.Sum256(data)
	prepared.Web = &documents.WebSource{OriginalURL: target.String(), FinalURL: response.Request.URL.String(), FetchedAt: time.Now().UTC().Format(time.RFC3339Nano), ContentSHA256: fmt.Sprintf("%x", digest)}
	prepared.Name = title + ".html"
	prepared.MediaType = "text/html"
	prepared.Size = len(data)
	prepared.ExtractionVersion = "cove-web-readability-v1"
	prepared.Data = data
	identity, err := json.Marshal(prepared.Snapshot)
	if err != nil {
		return documents.Prepared{}, err
	}
	snapshotDigest := sha256.Sum256(identity)
	prepared.ID = fmt.Sprintf("%x", snapshotDigest)
	return prepared, nil
}
