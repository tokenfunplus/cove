package appcatalog

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestFileRefreshWaitersCancelWithoutRepeatingFetchAndTrustChangesStayClosed(t *testing.T) {
	public, key, _ := ed25519.GenerateKey(nil)
	otherPublic, _, _ := ed25519.GenerateKey(nil)
	config := Catalog{URL: "https://catalog.example/index.json", PublicKey: base64.StdEncoding.EncodeToString(public)}
	other := Catalog{URL: "https://other.example/index.json", PublicKey: base64.StdEncoding.EncodeToString(otherPublic)}
	source := []byte(`{"publisher":"author","app":"notes","name":"Notes","version":"1.0.0","schema_version":1}`)
	next := []byte(strings.Replace(string(source), `"1.0.0"`, `"1.1.0"`, 1))
	candidate, err := entry(next, "catalog")
	if err != nil {
		t.Fatal(err)
	}
	oldBody, newBody := signedTestIndex(t, key, 1, source), signedTestIndex(t, key, 2, source, next)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	started, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	var calls atomic.Int64
	previous := http.DefaultTransport
	requestStarted := false
	defer func() {
		unblock()
		cancel()
		if requestStarted {
			select {
			case <-finished:
			case <-time.After(5 * time.Second):
				t.Error("file refresh did not stop")
			}
		}
		http.DefaultTransport = previous
	}()
	http.DefaultTransport = catalogTransport(func(r *http.Request) (*http.Response, error) {
		body := oldBody
		if call := calls.Add(1); call > 1 {
			if call == 2 {
				close(started)
			}
			select {
			case <-release:
			case <-r.Context().Done():
				return nil, r.Context().Err()
			}
			body = newBody
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: r}, nil
	})
	directory, _ := Open("", config)
	if _, err := directory.List(ctx); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	requestStarted = true
	go func() {
		defer close(finished)
		_, err := directory.ListForRelease(ctx, candidate.Digest)
		done <- err
	}()
	select {
	case <-started:
	case err := <-done:
		t.Fatal("file refresh never reached the transport", err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	waiter, stopWaiter := context.WithTimeout(ctx, 100*time.Millisecond)
	defer stopWaiter()
	if _, err := directory.ListForRelease(waiter, candidate.Digest); !errors.Is(err, context.DeadlineExceeded) || calls.Load() != 2 {
		t.Fatal("waiting file check repeated the fetch or ignored cancellation", err, calls.Load())
	}
	if err := directory.ReplaceTrust(other, config); err != nil {
		t.Fatal(err)
	}
	unblock()
	select {
	case err := <-done:
		if !errors.Is(err, ErrCatalogChanged) {
			t.Fatal("refresh accepted an authority that changed while fetching", err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if directory.KnownRelease(candidate.Digest) || calls.Load() != 2 {
		t.Fatal("stale refresh attested the file under the replacement authority")
	}
}
