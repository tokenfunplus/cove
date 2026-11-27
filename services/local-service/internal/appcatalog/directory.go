package appcatalog

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"os"
	"path/filepath"
	"sync"
)

type checkpoint struct {
	Sequence int64  `json:"sequence"`
	Digest   string `json:"digest"`
}

type preferences struct {
	ReleaseDigests map[string]bool       `json:"releases,omitempty"`
	Versions       map[string]string     `json:"versions,omitempty"`
	Publishers     map[string]bool       `json:"publishers,omitempty"`
	Config         *Catalog              `json:"config,omitempty"`
	Checkpoints    map[string]checkpoint `json:"checkpoints,omitempty"`
}

// Directory persists the selected trust root and the newest verified index across Launcher sessions.
type Directory struct {
	mu       sync.Mutex
	path     string
	defaults Catalog
	loadErr  error
	prefs    preferences
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
func (d *Directory) Configure(config Catalog) error {
	if err := config.Validate(); err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.loadErr != nil {
		return d.loadErr
	}
	for signer := range d.prefs.Checkpoints {
		if config.PublicKey != "" && signer != config.PublicKey {
			return errors.New("this installation already trusts another catalog signing key")
		}
	}
	next := d.prefs
	next.Config = &config
	return d.save(next)
}
func (d *Directory) List(ctx context.Context) ([]Entry, error) {
	if d.loadErr != nil {
		entries, _ := (Catalog{}).List(ctx)
		return entries, d.loadErr
	}
	config := d.Config()
	return config.list(ctx, func(index *SignedIndex) error {
		d.mu.Lock()
		defer d.mu.Unlock()
		if config != d.config() {
			return errors.New("catalog settings changed")
		}
		for signer := range d.prefs.Checkpoints {
			if signer != config.PublicKey {
				return errors.New("catalog signing key differs from the trusted key")
			}
		}
		prior := d.prefs.Checkpoints[config.PublicKey]
		if index.Sequence < prior.Sequence || index.Sequence == prior.Sequence && index.Digest != prior.Digest {
			return errors.New("catalog release index is older than the trusted revision")
		}
		if prior.Digest == index.Digest {
			return nil
		}
		next := d.prefs
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
			version := e.Publisher + "/" + e.App + "/" + e.Version
			if digest, seen := next.Versions[version]; seen && digest != e.Digest {
				return errors.New("a published catalog release changed its contents")
			}
			next.Versions[version] = e.Digest
			next.Publishers[e.Publisher] = true
			next.ReleaseDigests[e.Digest] = true
		}
		next.Checkpoints = map[string]checkpoint{config.PublicKey: {Sequence: index.Sequence, Digest: index.Digest}}
		return d.save(next)
	})
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
