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

type authorityHistory struct {
	Releases   map[string]bool   `json:"releases,omitempty"`
	Versions   map[string]string `json:"versions,omitempty"`
	Publishers map[string]bool   `json:"publishers,omitempty"`
}

type preferences struct {
	TrustPolicy    int                         `json:"trust_policy,omitempty"`
	ReleaseDigests map[string]bool             `json:"releases,omitempty"`
	Versions       map[string]string           `json:"versions,omitempty"`
	Publishers     map[string]bool             `json:"publishers,omitempty"`
	Config         *Catalog                    `json:"config,omitempty"`
	Checkpoints    map[string]checkpoint       `json:"checkpoints,omitempty"`
	Authorities    map[string]authorityHistory `json:"authorities,omitempty"`
}

type DirectorySettings struct {
	Catalog
	Defaults Catalog `json:"defaults"`
	Mode     string  `json:"mode"`
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
	if d.prefs.TrustPolicy < 2 {
		// A legacy version history can only be attributed when exactly one key
		// was ever accepted. Multi-authority histories must be reverified.
		key := d.config().PublicKey
		if _, known := d.prefs.Checkpoints[key]; key != "" && known && len(d.prefs.Checkpoints) == 1 {
			d.prefs.Authorities = map[string]authorityHistory{key: {Versions: maps.Clone(d.prefs.Versions), Publishers: maps.Clone(d.prefs.Publishers)}}
		}
		d.prefs.ReleaseDigests = nil
		d.prefs.Versions = nil
		d.prefs.Publishers = nil
		d.prefs.TrustPolicy = 2
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
func (d *Directory) Settings() DirectorySettings {
	d.mu.Lock()
	defer d.mu.Unlock()
	mode := "custom"
	if d.prefs.Config == nil {
		mode = "default"
	} else if d.prefs.Config.PublicKey == "" {
		mode = "bundled"
	}
	return DirectorySettings{Catalog: d.config(), Defaults: d.defaults, Mode: mode}
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
	return d.configure(config, nil, false)
}

// ReplaceTrust requires the authority shown in the confirmation to still be current.
// Checkpoints remain scoped to their signing key and survive a trust change.
func (d *Directory) ReplaceTrust(config, previous Catalog) error {
	return d.configure(config, &previous, false)
}

// UseDefaults removes the local override, including when this build has no remote directory.
func (d *Directory) UseDefaults(previous *Catalog) error {
	return d.configure(d.defaults, previous, true)
}

func (d *Directory) configure(config Catalog, previous *Catalog, followDefaults bool) error {
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
	if followDefaults || config.PublicKey != "" && config == d.defaults {
		next.Config = nil
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
		next.TrustPolicy = 2
		next.Authorities = maps.Clone(d.prefs.Authorities)
		if next.Authorities == nil {
			next.Authorities = make(map[string]authorityHistory)
		}
		previous := d.prefs.Authorities[config.PublicKey]
		history := authorityHistory{Releases: make(map[string]bool, len(index.Packages)), Publishers: maps.Clone(previous.Publishers), Versions: maps.Clone(previous.Versions)}
		if history.Publishers == nil {
			history.Publishers = make(map[string]bool)
		}
		if history.Versions == nil {
			history.Versions = make(map[string]string)
		}
		for _, raw := range index.Packages {
			e, err := entry(raw, "catalog")
			if err != nil {
				return err
			}
			if ReservedPublisher(e.Publisher) && (d.defaults.PublicKey == "" || config.PublicKey != d.defaults.PublicKey) {
				return errors.New("this signing authority cannot publish bundled app identities")
			}
			version := e.Publisher + "/" + e.App + "/" + e.Version
			if digest, seen := history.Versions[version]; seen && digest != e.Digest {
				return errors.New("a published catalog release changed its contents")
			}
			history.Versions[version] = e.Digest
			history.Publishers[e.Publisher] = true
			history.Releases[e.Digest] = true
		}
		if prior.Digest == index.Digest && maps.Equal(previous.Releases, history.Releases) {
			return nil
		}
		next.Authorities[config.PublicKey] = history
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
	return d.prefs.Authorities[d.config().PublicKey].Releases[digest]
}

func (d *Directory) KnownPublisher(name string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.prefs.Authorities[d.config().PublicKey].Publishers[name]
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
