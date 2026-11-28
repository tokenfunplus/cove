package appcatalog

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSlowerFailedRequestCannotReplaceFreshVerifiedCache(t *testing.T) {
	pub, key, _ := ed25519.GenerateKey(nil)
	config := Catalog{URL: "https://catalog.example/index.json", PublicKey: base64.StdEncoding.EncodeToString(pub)}
	source := []byte(`{"publisher":"author","app":"notes","name":"Notes","version":"1.0.0","schema_version":1}`)
	oldBody, newBody := signedTestIndex(t, key, 1, source), signedTestIndex(t, key, 2, source)
	var calls atomic.Int64
	started, release := make(chan struct{}), make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	var requests sync.WaitGroup
	prior := http.DefaultTransport
	defer func() {
		unblock()
		cancel()
		finished := make(chan struct{})
		go func() { requests.Wait(); close(finished) }()
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Error("catalog requests did not stop during cleanup")
		}
		http.DefaultTransport = prior
	}()
	http.DefaultTransport = catalogTransport(func(r *http.Request) (*http.Response, error) {
		body := newBody
		if calls.Add(1) == 1 {
			close(started)
			select {
			case <-release:
			case <-r.Context().Done():
				return nil, r.Context().Err()
			}
			body = oldBody
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: r}, nil
	})
	d, _ := Open("", config)
	type listResult struct {
		entries []Entry
		err     error
	}
	startList := func() <-chan listResult {
		result := make(chan listResult, 1)
		requests.Add(1)
		go func() {
			defer requests.Done()
			entries, err := d.List(ctx)
			result <- listResult{entries, err}
		}()
		return result
	}
	await := func(result <-chan listResult) listResult {
		t.Helper()
		select {
		case value := <-result:
			return value
		case <-ctx.Done():
			t.Fatal("timed out waiting for catalog request", ctx.Err())
			return listResult{}
		}
	}
	first := startList()
	select {
	case <-started:
	case result := <-first:
		t.Fatal("first catalog request finished before reaching the transport", result.err)
	case <-ctx.Done():
		t.Fatal("first catalog request did not reach the transport", ctx.Err())
	}
	if fresh := await(startList()); fresh.err != nil {
		t.Fatal(fresh.err)
	}
	unblock()
	if result := await(first); result.err == nil {
		t.Fatal("outdated in-flight response was not rejected")
	}
	cached := await(startList())
	if cached.err != nil {
		t.Fatal("an old in-flight failure replaced a fresh successful cache", cached.err)
	}
	if calls.Load() != 2 {
		t.Fatal("fresh verified cache was replaced and fetched again", calls.Load())
	}
	for _, e := range cached.entries {
		if e.Publisher == "author" {
			return
		}
	}
	t.Fatal("a fresh verified remote entry disappeared")
}
