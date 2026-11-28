package appcatalog

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestFileRefreshFailurePreservesVerifiedCatalogAndBrieflyBacksOff(t *testing.T) {
	public, key, _ := ed25519.GenerateKey(nil)
	config := Catalog{URL: "https://catalog.example/index.json", PublicKey: base64.StdEncoding.EncodeToString(public)}
	source := []byte(`{"publisher":"author","app":"notes","name":"Notes","version":"1.0.0","schema_version":1}`)
	next := []byte(strings.Replace(string(source), `"1.0.0"`, `"1.1.0"`, 1))
	oldEntry, _ := entry(source, "catalog")
	candidate, _ := entry(next, "catalog")
	oldBody, newBody := signedTestIndex(t, key, 1, source), signedTestIndex(t, key, 2, source, next)
	calls := 0
	status := http.StatusOK
	body := oldBody
	previous := http.DefaultTransport
	defer func() { http.DefaultTransport = previous }()
	http.DefaultTransport = catalogTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: r}, nil
	})
	directory, _ := Open("", config)
	if _, err := directory.List(t.Context()); err != nil {
		t.Fatal(err)
	}
	status = http.StatusServiceUnavailable
	fallback, failure := directory.ListForRelease(t.Context(), candidate.Digest)
	if failure == nil || calls != 2 || slices.ContainsFunc(fallback, func(item Entry) bool { return item.Origin == "catalog" }) {
		t.Fatal("failed file check did not return only bundled fallback metadata", failure, calls)
	}
	if entries, err := directory.List(t.Context()); err != nil || calls != 2 || !slices.ContainsFunc(entries, func(item Entry) bool { return item.Digest == oldEntry.Digest }) {
		t.Fatal("failed file check replaced the verified Discover cache", err, calls)
	}
	if _, err := directory.ListForRelease(t.Context(), candidate.Digest); err != failure || calls != 2 {
		t.Fatal("a repeated file check did not reuse the brief failure backoff", err, calls)
	}
	if _, err := directory.ListForRelease(t.Context(), "another-missing-file"); err != failure || calls != 2 {
		t.Fatal("a different missing file repeated the same failed directory request", err, calls)
	}
	if _, err := directory.ListForRelease(t.Context(), oldEntry.Digest); err != nil || calls != 2 {
		t.Fatal("file-check backoff hid a release already in the verified cache", err, calls)
	}
	cancelled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := directory.ListForRelease(cancelled, candidate.Digest); !errors.Is(err, context.Canceled) || calls != 2 {
		t.Fatal("file-check backoff hid cancellation", err, calls)
	}
	if directory.fileRetryAt.After(time.Now().Add(5 * time.Second)) {
		t.Fatal("file-check failure backoff is not brief")
	}
	directory.fileRetryAt = time.Time{}
	status, body = http.StatusOK, newBody
	if entries, err := directory.ListForRelease(t.Context(), candidate.Digest); err != nil || calls != 3 || !slices.ContainsFunc(entries, func(item Entry) bool { return item.Digest == candidate.Digest }) {
		t.Fatal("file check did not recover after its failure backoff", err, calls)
	}
	if _, err := directory.ListForRelease(t.Context(), "another-missing-file"); err != nil || calls != 4 {
		t.Fatal("successful refresh retained a prior file-check failure", err, calls)
	}
	status = http.StatusServiceUnavailable
	if _, err := directory.ListForRelease(t.Context(), "another-missing-file"); err == nil || calls != 5 {
		t.Fatal("second failed file check did not reach the catalog", err, calls)
	}
	changed := config
	changed.URL = "https://moved.example/index.json"
	if err := directory.Configure(changed); err != nil {
		t.Fatal(err)
	}
	status = http.StatusOK
	if _, err := directory.ListForRelease(t.Context(), "another-missing-file"); err != nil || calls != 6 {
		t.Fatal("changed catalog settings reused a prior file-check failure", err, calls)
	}
}

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

type observedCatalogRefreshWait struct {
	context.Context
	waiting chan struct{}
	once    sync.Once
}

func (ctx *observedCatalogRefreshWait) Done() <-chan struct{} {
	ctx.once.Do(func() { close(ctx.waiting) })
	return ctx.Context.Done()
}

func TestFileRefreshWaiterRetriesCanceledOwnerAndReusesCompletedResults(t *testing.T) {
	for _, outcome := range []string{"canceled owner", "canceled owner with newer cache", "verified release", "verified miss", "remote failure", "remote failure with newer cache"} {
		t.Run(outcome, func(t *testing.T) {
			public, key, _ := ed25519.GenerateKey(nil)
			config := Catalog{URL: "https://catalog.example/index.json", PublicKey: base64.StdEncoding.EncodeToString(public)}
			source := []byte(`{"publisher":"author","app":"notes","name":"Notes","version":"1.0.0","schema_version":1}`)
			next := []byte(strings.Replace(string(source), `"1.0.0"`, `"1.1.0"`, 1))
			candidate, err := entry(next, "catalog")
			if err != nil {
				t.Fatal(err)
			}
			oldBody, newBody := signedTestIndex(t, key, 1, source), signedTestIndex(t, key, 2, source, next)
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			ownerContext, cancelOwner := context.WithCancel(ctx)
			started, release := make(chan struct{}), make(chan struct{})
			unblock := sync.OnceFunc(func() { close(release) })
			var workers sync.WaitGroup
			var calls atomic.Int64
			previous := http.DefaultTransport
			defer func() {
				cancelOwner()
				cancel()
				unblock()
				finished := make(chan struct{})
				go func() { workers.Wait(); close(finished) }()
				select {
				case <-finished:
				case <-time.After(5 * time.Second):
					t.Error("file refresh calls did not stop")
				}
				http.DefaultTransport = previous
			}()
			http.DefaultTransport = catalogTransport(func(r *http.Request) (*http.Response, error) {
				body, status := newBody, http.StatusOK
				switch calls.Add(1) {
				case 1:
					body = oldBody
				case 2:
					close(started)
					select {
					case <-release:
					case <-r.Context().Done():
						return nil, r.Context().Err()
					}
					if outcome == "verified miss" {
						body = oldBody
					} else if strings.HasPrefix(outcome, "remote failure") {
						status = http.StatusServiceUnavailable
					}
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: r}, nil
			})
			directory, _ := Open("", config)
			if _, err := directory.List(ctx); err != nil {
				t.Fatal(err)
			}
			type result struct {
				entries []Entry
				err     error
			}
			start := func(requestContext context.Context) <-chan result {
				output := make(chan result, 1)
				workers.Add(1)
				go func() {
					defer workers.Done()
					entries, err := directory.ListForRelease(requestContext, candidate.Digest)
					output <- result{entries, err}
				}()
				return output
			}
			await := func(output <-chan result) result {
				t.Helper()
				select {
				case value := <-output:
					return value
				case <-ctx.Done():
					t.Fatal("file verification did not finish", ctx.Err())
					return result{}
				}
			}
			owner := start(ownerContext)
			select {
			case <-started:
			case value := <-owner:
				t.Fatal("owner did not start its missing-release refresh", value.err)
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			if entries, err := directory.List(ctx); err != nil || calls.Load() != 2 || !slices.ContainsFunc(entries, func(item Entry) bool {
				return item.Publisher == "author" && item.Version == "1.0.0"
			}) {
				t.Fatal("pending file check blocked or replaced the verified catalog", err, calls.Load())
			}
			waiterContext := &observedCatalogRefreshWait{Context: ctx, waiting: make(chan struct{})}
			waiter := start(waiterContext)
			select {
			case <-waiterContext.waiting:
			case value := <-waiter:
				t.Fatal("waiter returned before the shared refresh completed", value.err)
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			newerCache := strings.HasSuffix(outcome, "with newer cache")
			if newerCache {
				// An ordinary directory read can replace an expired cache while
				// the original file refresh is still waiting on the network.
				directory.mu.Lock()
				directory.cachedUntil = time.Time{}
				directory.mu.Unlock()
				if _, err := directory.List(ctx); err != nil || !directory.KnownRelease(candidate.Digest) || calls.Load() != 3 {
					t.Fatal("ordinary directory fetch did not publish the newer cache", err, calls.Load())
				}
			}
			ownerCanceled := strings.HasPrefix(outcome, "canceled owner")
			if ownerCanceled {
				cancelOwner()
			} else {
				unblock()
			}
			owned, waited := await(owner), await(waiter)
			if ownerCanceled {
				if !errors.Is(owned.err, context.Canceled) || waited.err != nil || calls.Load() != 3 {
					t.Fatal("live waiter reused a canceled owner's stale cache", owned.err, waited.err, calls.Load())
				}
			} else {
				wantCalls := int64(2)
				if newerCache {
					wantCalls = 3
				}
				if calls.Load() != wantCalls || waited.err != owned.err || (waited.err != nil) != strings.HasPrefix(outcome, "remote failure") {
					t.Fatal("waiter repeated or changed the completed refresh", owned.err, waited.err, calls.Load())
				}
			}
			found := false
			for _, entry := range waited.entries {
				if entry.Digest == candidate.Digest {
					found = entry.Origin == "catalog" && entry.CatalogAuthority == Authority(config.PublicKey)
				}
			}
			if found != (ownerCanceled || outcome == "verified release") {
				t.Fatal("waiter returned the wrong verified release set", waited.err, found)
			}
			if strings.HasPrefix(outcome, "remote failure") {
				cached, err := directory.List(ctx)
				if err != nil || !slices.ContainsFunc(cached, func(item Entry) bool {
					return item.Publisher == "author" && (!newerCache || item.Digest == candidate.Digest)
				}) {
					t.Fatal("failed file refresh replaced the concurrently usable catalog", err)
				}
				if newerCache {
					if _, err := directory.ListForRelease(ctx, "another-missing-file"); err != nil || calls.Load() != 4 {
						t.Fatal("older failed file refresh blocked the newer catalog", err, calls.Load())
					}
				}
			}
		})
	}
}
