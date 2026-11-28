// Package appcatalog resolves independently signed releases. Browser input
// selects a release identity and never supplies the network destination.
package appcatalog

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	_ "embed"
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

// Only immutable legacy identities are retained. App rules and package bytes are not embedded.
//
//go:embed legacy-releases.json
var legacyJSON []byte

const MaxPackage = 1 << 20
const maxIndex = 8 << 20

type Entry struct {
	CatalogAuthority string `json:"catalog_authority,omitempty"`
	OfficialCatalog  bool   `json:"official_catalog,omitempty"`
	MinHostVersion   string `json:"min_host_version,omitempty"`
	Publisher        string `json:"publisher"`
	App              string `json:"app"`
	Version          string `json:"version"`
	SchemaVersion    int    `json:"schema_version"`
	Name             string `json:"name"`
	Description      string `json:"description,omitempty"`
	Digest           string `json:"digest"`
	Origin           string `json:"origin"`
	Raw              []byte `json:"-"`
}

type Catalog struct {
	URL       string `json:"url"`
	PublicKey string `json:"public_key"`
}

func (c Catalog) Validate() error {
	if c.URL == "" && c.PublicKey == "" {
		return nil
	}
	u, err := url.Parse(c.URL)
	key, e := base64.StdEncoding.DecodeString(c.PublicKey)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" || e != nil || len(key) != ed25519.PublicKeySize || base64.StdEncoding.EncodeToString(key) != c.PublicKey {
		return errors.New("use an HTTPS index URL and a base64 Ed25519 public key")
	}
	return nil
}

type SignedIndex struct {
	Format    int       `json:"format"`
	Sequence  int64     `json:"sequence"`
	IssuedAt  time.Time `json:"issued_at"`
	ExpiresAt time.Time `json:"expires_at"`
	Packages  [][]byte  `json:"packages"`
	Digest    string    `json:"-"`
}

func entry(raw []byte, origin string) (Entry, error) {
	var item Entry
	if len(raw) > MaxPackage || json.Unmarshal(raw, &item) != nil || item.App == "" || item.Publisher == "" || item.Version == "" || item.SchemaVersion < 1 {
		return Entry{}, errors.New("invalid catalog entry")
	}
	digest := sha256.Sum256(raw)
	item.Digest, item.Origin, item.Raw = hex.EncodeToString(digest[:]), origin, raw
	// Package bytes cannot attest their own distribution authority.
	item.CatalogAuthority, item.OfficialCatalog = "", false
	return item, nil
}

func (c Catalog) remote(ctx context.Context) (*SignedIndex, error) {
	if err := c.Validate(); err != nil {
		return nil, err
	}
	key, err := base64.StdEncoding.DecodeString(c.PublicKey)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.URL, nil)
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

func verify(raw []byte, key ed25519.PublicKey) (*SignedIndex, error) {
	var envelope struct{ Payload, Signature []byte }
	if json.Unmarshal(raw, &envelope) != nil || !ed25519.Verify(key, envelope.Payload, envelope.Signature) {
		return nil, errors.New("invalid catalog signature")
	}
	var index SignedIndex
	now := time.Now().UTC()
	if json.Unmarshal(envelope.Payload, &index) != nil || index.Format != 2 || index.Sequence <= 0 || len(index.Packages) > 128 ||
		index.IssuedAt.IsZero() || index.IssuedAt.After(now.Add(5*time.Minute)) || !index.ExpiresAt.After(now) || !index.ExpiresAt.After(index.IssuedAt) || index.ExpiresAt.Sub(index.IssuedAt) > 31*24*time.Hour {
		return nil, errors.New("invalid or expired signed catalog")
	}
	sum := sha256.Sum256(envelope.Payload)
	index.Digest = hex.EncodeToString(sum[:])
	return &index, nil
}

func (c Catalog) List(ctx context.Context) ([]Entry, error) { return c.list(ctx, nil) }
func (c Catalog) list(ctx context.Context, accept func(*SignedIndex) error) ([]Entry, error) {
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
		if origin == "catalog" {
			for _, legacy := range legacyIdentities {
				if legacy.Publisher == e.Publisher && legacy.App == e.App && legacy.Version == e.Version && legacy.Digest != e.Digest {
					return errors.New("a legacy published release changed its contents")
				}
			}
			e.CatalogAuthority = Authority(c.PublicKey)
		}
		all[key] = e
		return nil
	}
	var remoteErr error
	if c.URL != "" || c.PublicKey != "" {
		verified := map[[3]string]Entry{}
		index, err := c.remote(ctx)
		if err == nil {
			for _, p := range index.Packages {
				if err = add(p, "catalog"); err != nil {
					break
				}
			}
			if err == nil && accept != nil {
				err = accept(index)
			}
		}
		if err != nil {
			all = verified
			remoteErr = err
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
	return entries, remoteErr
}

type legacyIdentity struct {
	Publisher string `json:"publisher"`
	App       string `json:"app"`
	Version   string `json:"version"`
	Digest    string `json:"digest"`
}

// This compatibility list never supplies app bytes or admits a new release.
var legacyIdentities = func() []legacyIdentity {
	var identities []legacyIdentity
	if err := json.Unmarshal(legacyJSON, &identities); err != nil {
		panic("invalid legacy release identities")
	}
	return identities
}()

func IsBundledDigest(digest string) bool {
	for _, identity := range legacyIdentities {
		if identity.Digest == digest {
			return true
		}
	}
	return false
}

func IsLegacyRelease(publisher, app, version, digest string) bool {
	for _, identity := range legacyIdentities {
		if identity.Publisher == publisher && identity.App == app && identity.Version == version && identity.Digest == digest {
			return true
		}
	}
	return false
}

func ReservedPublisher(publisher string) bool {
	if publisher == "cove" {
		return true
	}
	for _, identity := range legacyIdentities {
		if identity.Publisher == publisher {
			return true
		}
	}
	return false
}

// Authority identifies the Ed25519 trust root without exposing mutable URLs.
func Authority(publicKey string) string {
	key, err := base64.StdEncoding.DecodeString(publicKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return ""
	}
	sum := sha256.Sum256(key)
	return hex.EncodeToString(sum[:])
}

// ReleaseOrigin is an internal, persisted provenance token. Public DTOs retain
// the catalog channel and expose its attested authority separately.
func (e Entry) ReleaseOrigin() string {
	if e.Origin != "catalog" || e.CatalogAuthority == "" {
		return e.Origin
	}
	if e.OfficialCatalog {
		return "official-catalog:" + e.CatalogAuthority
	}
	return "catalog:" + e.CatalogAuthority
}
