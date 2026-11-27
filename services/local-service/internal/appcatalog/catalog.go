// Package appcatalog resolves bundled and signed catalog releases. Browser input
// selects a release identity and never supplies the network destination.
package appcatalog

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sort"
	"time"
)

//go:embed packages/*.coveapp
var bundled embed.FS

const MaxPackage = 1 << 20
const maxIndex = 8 << 20

type Entry struct {
	Publisher     string `json:"publisher"`
	App           string `json:"app"`
	Version       string `json:"version"`
	SchemaVersion int    `json:"schema_version"`
	Name          string `json:"name"`
	Digest        string `json:"digest"`
	Origin        string `json:"origin"`
	Raw           []byte `json:"-"`
}

type Catalog struct {
	URL       string
	PublicKey string
}

func entry(raw []byte, origin string) (Entry, error) {
	var item Entry
	if len(raw) > MaxPackage || json.Unmarshal(raw, &item) != nil || item.App == "" || item.Publisher == "" || item.Version == "" || item.SchemaVersion < 1 {
		return Entry{}, errors.New("invalid catalog entry")
	}
	digest := sha256.Sum256(raw)
	item.Digest, item.Origin, item.Raw = hex.EncodeToString(digest[:]), origin, raw
	return item, nil
}

func (c Catalog) remote(ctx context.Context) ([][]byte, error) {
	u, err := url.Parse(c.URL)
	key, e := base64.StdEncoding.DecodeString(c.PublicKey)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" || e != nil || len(key) != ed25519.PublicKeySize {
		return nil, errors.New("invalid catalog configuration")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	client := http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, errors.New("catalog unavailable")
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxIndex+1))
	if err != nil || len(raw) > maxIndex {
		return nil, errors.New("invalid catalog size")
	}
	return verify(raw, key)
}

func verify(raw []byte, key ed25519.PublicKey) ([][]byte, error) {
	var envelope struct{ Payload, Signature []byte }
	if json.Unmarshal(raw, &envelope) != nil || !ed25519.Verify(key, envelope.Payload, envelope.Signature) {
		return nil, errors.New("invalid catalog signature")
	}
	var index struct {
		Format   int
		Packages [][]byte
	}
	if json.Unmarshal(envelope.Payload, &index) != nil || index.Format != 1 || len(index.Packages) > 128 {
		return nil, errors.New("invalid signed catalog")
	}
	return index.Packages, nil
}

func (c Catalog) List(ctx context.Context) ([]Entry, error) {
	files, err := bundled.ReadDir("packages")
	if err != nil {
		return nil, err
	}
	all := map[[3]string]Entry{}
	add := func(data []byte, origin string) error {
		e, err := entry(data, origin)
		if err != nil {
			return err
		}
		key := [3]string{e.Publisher, e.App, e.Version}
		if prev, ok := all[key]; ok {
			if prev.Digest != e.Digest {
				return errors.New("catalog version has conflicting contents")
			}
			return nil
		}
		all[key] = e
		return nil
	}
	for _, item := range files {
		data, err := bundled.ReadFile("packages/" + item.Name())
		if err != nil {
			return nil, err
		}
		if err := add(data, "builtin"); err != nil {
			return nil, err
		}
	}
	if c.URL != "" || c.PublicKey != "" {
		packages, err := c.remote(ctx)
		if err != nil {
			return nil, err
		}
		for _, p := range packages {
			if err := add(p, "catalog"); err != nil {
				return nil, err
			}
		}
	}
	entries := make([]Entry, 0, len(all))
	for _, e := range all {
		entries = append(entries, e)
	}
	sort.Slice(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.Publisher != b.Publisher {
			return a.Publisher < b.Publisher
		}
		if a.App != b.App {
			return a.App < b.App
		}
		return a.Version < b.Version
	})
	return entries, nil
}
