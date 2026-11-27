package appcatalog

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"
)

type checkpoint struct {
	Sequence int64  `json:"sequence"`
	Digest   string `json:"digest"`
}

type preferences struct {
	TrustPolicy    int                   `json:"trust_policy,omitempty"`
	ReleaseDigests map[string]bool       `json:"releases,omitempty"`
	Versions       map[string]string     `json:"versions,omitempty"`
	Publishers     map[string]bool       `json:"publishers,omitempty"`
	Config         *Catalog              `json:"config,omitempty"`
	Checkpoints    map[string]checkpoint `json:"checkpoints,omitempty"`
}

// Directory persists the selected trust root and the newest verified index across Launcher sessions.
type Directory struct {
	mu            sync.Mutex
	path          string
	defaults      Catalog
	loadErr       error
	prefs         preferences
	cachedConfig  Catalog
	cachedUntil   time.Time
	cachedEntries []Entry
}

func Open(path string, defaults Catalog) (*Directory, error) {
	d := &Directory{path: path, defaults: defaults}
	if path != "" {
		raw, err := os.ReadFile(path)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			d.loadErr = err
		}
		if err == nil {
			if err = json.Unmarshal(raw, &d.prefs); err != nil {
				d.loadErr = err
				d.prefs = preferences{}
			}
		}
	}
	// Older preferences did not distinguish the official signing authority from a
	// user-selected directory. Reverify cached release identities under this policy.
	if d.prefs.TrustPolicy < 1 {
		d.prefs.ReleaseDigests = nil
	}
	return d, nil
}
func (d *Directory) config() Catalog {
	if d.prefs.Config != nil {
		return *d.prefs.Config
	}
	return d.defaults
}
func (d *Directory) Config() Catalog {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.config()
}
func (d *Directory) save(next preferences) error {
	if d.path != "" {
		file, err := os.CreateTemp(filepath.Dir(d.path), ".catalog-*")
		if err != nil {
			return err
		}
		defer os.Remove(file.Name())
		err = json.NewEncoder(file).Encode(next)
		if err == nil {
			err = file.Sync()
		}
		closeErr := file.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		if err = os.Rename(file.Name(), d.path); err != nil {
			return err
		}
	}
	d.prefs = next
	return nil
}

var ErrTrustConfirmation = errors.New("confirm the catalog signing authority before changing it")
var ErrCatalogChanged = errors.New("catalog settings changed; review the current signing authority")

func (d *Directory) Configure(config Catalog) error {
	return d.configure(config, nil)
}

// ReplaceTrust requires the authority shown in the confirmation to still be current.
// Checkpoints remain scoped to their signing key and survive a trust change.
func (d *Directory) ReplaceTrust(config, previous Catalog) error {
	return d.configure(config, &previous)
}

func (d *Directory) configure(config Catalog, previous *Catalog) error {
	if err := config.Validate(); err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.loadErr != nil {
		return d.loadErr
	}
	current := d.config()
	if previous != nil && *previous != current {
		return ErrCatalogChanged
	}
	if current.PublicKey != config.PublicKey && previous == nil {
		return ErrTrustConfirmation
	}
	next := d.prefs
	next.Config = &config
	if current.PublicKey != config.PublicKey {
		next.ReleaseDigests = nil
	}
	if err := d.save(next); err != nil {
		return err
	}
	d.cachedEntries = nil
	d.cachedUntil = time.Time{}
	return nil
}
func (d *Directory) List(ctx context.Context) ([]Entry, error) {
	if d.loadErr != nil {
		entries, _ := (Catalog{}).List(ctx)
		return entries, d.loadErr
	}
	if err := ctx.Err(); err != nil {
		return bundledFallback(ctx, err)
	}
	d.mu.Lock()
	config := d.config()
	if config == d.cachedConfig && time.Now().Before(d.cachedUntil) {
		entries := cloneEntries(d.cachedEntries)
		d.mu.Unlock()
		return entries, nil
	}
	d.mu.Unlock()
	var expires time.Time
	var checkedDigest string
	entries, err := config.list(ctx, func(index *SignedIndex) error {
		expires = index.ExpiresAt
		checkedDigest = index.Digest
		d.mu.Lock()
		defer d.mu.Unlock()
		if config != d.config() {
			return errors.New("catalog settings changed")
		}
		prior := d.prefs.Checkpoints[config.PublicKey]
		if index.Sequence < prior.Sequence || index.Sequence == prior.Sequence && index.Digest != prior.Digest {
			return errors.New("catalog release index is older than the trusted revision")
		}
		next := d.prefs
		next.TrustPolicy = 1
		next.ReleaseDigests = make(map[string]bool, len(index.Packages))
		next.Publishers = make(map[string]bool, len(d.prefs.Publishers))
		maps.Copy(next.Publishers, d.prefs.Publishers)
		next.Versions = make(map[string]string, len(d.prefs.Versions))
		maps.Copy(next.Versions, d.prefs.Versions)
		for _, raw := range index.Packages {
			e, err := entry(raw, "catalog")
			if err != nil {
				return err
			}
			if ReservedPublisher(e.Publisher) && (d.defaults.PublicKey == "" || config.PublicKey != d.defaults.PublicKey) {
				return errors.New("this signing authority cannot publish bundled app identities")
			}
			version := e.Publisher + "/" + e.App + "/" + e.Version
			if digest, seen := next.Versions[version]; seen && digest != e.Digest {
				return errors.New("a published catalog release changed its contents")
			}
			next.Versions[version] = e.Digest
			next.Publishers[e.Publisher] = true
			next.ReleaseDigests[e.Digest] = true
		}
		if prior.Digest == index.Digest && d.prefs.TrustPolicy == 1 && maps.Equal(d.prefs.ReleaseDigests, next.ReleaseDigests) {
			return nil
		}
		next.Checkpoints = make(map[string]checkpoint, len(d.prefs.Checkpoints)+1)
		maps.Copy(next.Checkpoints, d.prefs.Checkpoints)
		next.Checkpoints[config.PublicKey] = checkpoint{Sequence: index.Sequence, Digest: index.Digest}
		return d.save(next)
	})
	if err == nil && ctx.Err() != nil {
		err = ctx.Err()
	}
	if err != nil {
		return bundledFallback(ctx, err)
	}
	if !expires.IsZero() {
		d.mu.Lock()
		if config == d.config() && d.prefs.Checkpoints[config.PublicKey].Digest == checkedDigest {
			d.cachedConfig = config
			d.cachedUntil = time.Now().Add(30 * time.Second)
			if expires.Before(d.cachedUntil) {
				d.cachedUntil = expires
			}
			d.cachedEntries = cloneEntries(entries)
		}
		d.mu.Unlock()
	}
	return entries, nil
}

func bundledFallback(ctx context.Context, err error) ([]Entry, error) {
	entries, _ := (Catalog{}).List(ctx)
	return entries, err
}

func cloneEntries(entries []Entry) []Entry {
	result := slices.Clone(entries)
	for index := range result {
		result[index].Raw = slices.Clone(result[index].Raw)
	}
	return result
}

func (d *Directory) KnownRelease(digest string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.prefs.ReleaseDigests[digest]
}

func (d *Directory) KnownPublisher(name string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.prefs.Publishers[name]
}

// BundledDefaults takes only the public HTTPS endpoint and verification key from release resources.
func BundledDefaults(path string, env Catalog) (Catalog, error) {
	if env.URL != "" || env.PublicKey != "" {
		return env, nil
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Catalog{}, nil
	}
	if err != nil {
		return Catalog{}, err
	}
	var c Catalog
	if err = json.Unmarshal(raw, &c); err != nil {
		return Catalog{}, err
	}
	return c, c.Validate()
}
