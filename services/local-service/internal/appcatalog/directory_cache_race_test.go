package appcatalog

import (
	"crypto/ed25519"
	"encoding/base64"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
)

func TestSlowerFailedRequestCannotReplaceFreshVerifiedCache(t *testing.T) {
	pub, key, _ := ed25519.GenerateKey(nil)
	config := Catalog{URL: "https://catalog.example/index.json", PublicKey: base64.StdEncoding.EncodeToString(pub)}
	source := []byte(`{"publisher":"author","app":"notes","name":"Notes","version":"1.0.0","schema_version":1}`)
	oldBody, newBody := signedTestIndex(t, key, 1, source), signedTestIndex(t, key, 2, source)
	var calls atomic.Int64
	started, release := make(chan struct{}), make(chan struct{})
	prior := http.DefaultTransport
	defer func() { http.DefaultTransport = prior }()
	http.DefaultTransport = catalogTransport(func(r *http.Request) (*http.Response, error) {
		body := newBody
		if calls.Add(1) == 1 {
			close(started)
			<-release
			body = oldBody
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: r}, nil
	})
	d, _ := Open("", config)
	done := make(chan error, 1)
	go func() { _, err := d.List(t.Context()); done <- err }()
	<-started
	if _, err := d.List(t.Context()); err != nil {
		close(release)
		<-done
		t.Fatal(err)
	}
	close(release)
	if err := <-done; err == nil {
		t.Fatal("outdated in-flight response was not rejected")
	}
	entries, err := d.List(t.Context())
	if err != nil {
		t.Fatal("an old in-flight failure replaced a fresh successful cache", err)
	}
	for _, e := range entries {
		if e.Publisher == "author" {
			return
		}
	}
	t.Fatal("a fresh verified remote entry disappeared")
}
