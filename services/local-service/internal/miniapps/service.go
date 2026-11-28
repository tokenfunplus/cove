package miniapps

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

type Release struct {
	CatalogAuthority string  `json:"catalog_authority,omitempty"`
	OfficialCatalog  bool    `json:"official_catalog,omitempty"`
	ID               string  `json:"id"`
	Origin           string  `json:"origin"`
	Digest           string  `json:"digest"`
	Package          Package `json:"package"`
}
type Instance struct {
	CloudEnabled bool     `json:"cloud_enabled"`
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	ReleaseID    string   `json:"release_id"`
	Enabled      bool     `json:"enabled"`
	Grants       []string `json:"grants"`
	Revision     int64    `json:"revision"`
}
type CreateRequest struct {
	CloudEnabled bool     `json:"cloud_enabled"`
	ReleaseID    string   `json:"release_id"`
	Name         string   `json:"name"`
	Grants       []string `json:"grants"`
}
type ConfigRequest struct {
	CloudEnabled bool     `json:"cloud_enabled"`
	Revision     int64    `json:"revision"`
	Enabled      bool     `json:"enabled"`
	Grants       []string `json:"grants"`
}
type UpgradeRequest struct {
	CloudEnabled *bool    `json:"cloud_enabled,omitempty"`
	Revision     int64    `json:"revision"`
	ReleaseID    string   `json:"release_id"`
	Grants       []string `json:"grants"`
}

type Service struct {
	// InstanceChanges synchronizes the host's grant changes and their side effects
	// with the short admission step for files, speech and model work.
	InstanceChanges sync.Mutex
	store           *persistence.SQLiteStore
	secret          [32]byte
	now             func() time.Time
}

func New(store *persistence.SQLiteStore) *Service {
	s := &Service{store: store, now: time.Now}
	rand.Read(s.secret[:])
	return s
}
func digest(raw []byte) string { hash := sha256.Sum256(raw); return hex.EncodeToString(hash[:]) }
func releaseID(origin, publisher, app, version string) string {
	return digest([]byte(origin + "/" + publisher + "/" + app + "/" + version))
}

func Preview(raw []byte, origin string) (Release, error) {
	p, err := Validate(raw)
	if err != nil {
		return Release{}, err
	}
	channel, authority, official := releaseOrigin(origin)
	switch channel {
	case "catalog", "builtin", "local":
		// Distribution authority belongs to the installer. Structural validation
		// also runs in author-owned, disposable workspaces for unpublished apps.
	default:
		return Release{}, invalid("package origin")
	}
	id := releaseID(origin, p.Publisher, p.App, p.Version)
	return Release{ID: id, Package: p, Origin: channel, CatalogAuthority: authority, OfficialCatalog: official, Digest: digest(raw)}, nil
}
func lookup(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
func loadRelease(tx *persistence.MiniAppStore, id string) (r Release, err error) {
	row, err := tx.Release(id)
	if err != nil {
		return r, lookup(err)
	}
	r.ID, r.Digest = row.ID, row.Digest
	r.Origin, r.CatalogAuthority, r.OfficialCatalog = releaseOrigin(row.Origin)
	err = json.Unmarshal(row.Manifest, &r.Package)
	return
}
func loadInstance(tx *persistence.MiniAppStore, id string) (i Instance, err error) {
	row, err := tx.Instance(id)
	if err != nil {
		return i, lookup(err)
	}
	i = Instance{CloudEnabled: row.CloudEnabled, ID: row.ID, Name: row.Name, ReleaseID: row.ReleaseID, Enabled: row.Enabled, Revision: row.Revision}
	err = json.Unmarshal(row.Grants, &i.Grants)
	return
}
func saveInstance(tx *persistence.MiniAppStore, i Instance) error {
	if i.Grants == nil {
		i.Grants = []string{}
	}
	grants, err := json.Marshal(i.Grants)
	if err != nil {
		return err
	}
	return tx.SaveInstance(persistence.AppInstance{CloudEnabled: i.CloudEnabled, ID: i.ID, Name: i.Name, ReleaseID: i.ReleaseID, Enabled: i.Enabled, Revision: i.Revision, Grants: grants})
}

var ErrReleaseContents = fmt.Errorf("%w: a release with this version already has different contents; publish a new version", ErrConflict)

func (s *Service) Install(ctx context.Context, raw []byte, origin string) (Release, error) {
	r, err := Preview(raw, origin)
	if err != nil {
		return r, err
	}
	err = s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		before, err := tx.Release(r.ID)
		if err == nil {
			if before.Digest != r.Digest {
				return ErrReleaseContents
			}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		return tx.AddRelease(persistence.AppRelease{ID: r.ID, Origin: r.DistributionOrigin(), Digest: r.Digest, Manifest: raw})
	})
	return r, err
}
func (s *Service) Release(ctx context.Context, id string) (r Release, err error) {
	err = s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error { var err error; r, err = loadRelease(tx, id); return err })
	return
}
func (s *Service) Instance(ctx context.Context, id string) (i Instance, err error) {
	err = s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error { var err error; i, err = loadInstance(tx, id); return err })
	return
}
func (s *Service) Releases(ctx context.Context) ([]Release, error) {
	all := []Release{}
	err := s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		ids, err := tx.ReleaseIDs()
		if err != nil {
			return err
		}
		for _, id := range ids {
			r, err := loadRelease(tx, id)
			if err != nil {
				return err
			}
			all = append(all, r)
		}
		return nil
	})
	return all, err
}
func (s *Service) Instances(ctx context.Context) ([]Instance, error) {
	all := []Instance{}
	err := s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		ids, err := tx.InstanceIDs()
		if err != nil {
			return err
		}
		for _, id := range ids {
			i, err := loadInstance(tx, id)
			if err != nil {
				return err
			}
			all = append(all, i)
		}
		return nil
	})
	return all, err
}
func (s *Service) Create(ctx context.Context, req CreateRequest) (Instance, error) {
	var i Instance
	err := s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		r, err := loadRelease(tx, req.ReleaseID)
		if err != nil {
			return err
		}
		if !short(req.Name, 100) || !subset(req.Grants, r.Package.Capabilities) {
			return invalid("instance name or grants")
		}
		i = Instance{CloudEnabled: req.CloudEnabled, ID: uuid.NewString(), ReleaseID: r.ID, Name: strings.TrimSpace(req.Name), Enabled: true, Grants: append([]string{}, req.Grants...), Revision: 1}
		if err := saveInstance(tx, i); err != nil {
			return err
		}
		now := s.now()
		for col, records := range r.Package.Seed {
			for _, row := range records {
				fields := map[string]any{}
				for k, v := range row {
					fields[k] = resolve(v, nil, now)
				}
				if err := saveRecord(tx, i.ID, col, Record{ID: uuid.NewString(), Revision: 1, Fields: fields}); err != nil {
					return err
				}
			}
		}
		return nil
	})
	return i, err
}
func (s *Service) Configure(ctx context.Context, id string, req ConfigRequest) (Instance, error) {
	var i Instance
	err := s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		var err error
		i, err = loadInstance(tx, id)
		if err != nil {
			return err
		}
		if i.Revision != req.Revision {
			return ErrConflict
		}
		r, err := loadRelease(tx, i.ReleaseID)
		if err != nil {
			return err
		}
		if !subset(req.Grants, r.Package.Capabilities) {
			return invalid("grants")
		}
		i.Revision++
		i.Enabled = req.Enabled
		i.CloudEnabled = req.CloudEnabled && req.Enabled
		i.Grants = append([]string{}, req.Grants...)
		if !i.Enabled {
			i.Grants = []string{}
		}
		return saveInstance(tx, i)
	})
	return i, err
}
func (s *Service) Delete(ctx context.Context, id string) error {
	return s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		if _, err := loadInstance(tx, id); err != nil {
			return err
		}
		return tx.DeleteInstance(id)
	})
}
func (s *Service) CheckCapability(ctx context.Context, id, capability string) error {
	i, err := s.Instance(ctx, id)
	if err != nil {
		return err
	}
	if !i.Enabled || !slices.Contains(i.Grants, capability) {
		return ErrDenied
	}
	return nil
}
func newer(next, previous string) bool {
	a, b := strings.Split(next, "."), strings.Split(previous, ".")
	for n := range a {
		x, _ := strconv.Atoi(a[n])
		y, _ := strconv.Atoi(b[n])
		if x != y {
			return x > y
		}
	}
	return false
}
func (s *Service) Upgrade(ctx context.Context, id string, req UpgradeRequest) (Instance, error) {
	var i Instance
	err := s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		var err error
		i, err = loadInstance(tx, id)
		if err != nil {
			return err
		}
		if i.Revision != req.Revision {
			return ErrConflict
		}
		before, err := loadRelease(tx, i.ReleaseID)
		if err != nil {
			return err
		}
		after, err := loadRelease(tx, req.ReleaseID)
		if err != nil {
			return err
		}
		old, next := before.Package, after.Package
		sameOrigin := compatibleAuthority(before, after)
		if !sameOrigin || old.Publisher != next.Publisher || old.App != next.App || !newer(next.Version, old.Version) || next.SchemaVersion < old.SchemaVersion {
			return invalid("incompatible upgrade")
		}
		if !subset(req.Grants, next.Capabilities) {
			return invalid("upgrade grants")
		}
		if err := migrate(tx, i.ID, old, next, s.now()); err != nil {
			return err
		}
		size, err := tx.InstanceRecordBytes(id)
		if err != nil {
			return err
		}
		if size > 16<<20 {
			return invalid("upgraded instance exceeds storage limit")
		}
		if req.CloudEnabled != nil {
			i.CloudEnabled = *req.CloudEnabled
		}
		i.CloudEnabled = i.CloudEnabled && i.Enabled
		i.ReleaseID = after.ID
		i.Revision++
		i.Grants = append([]string{}, req.Grants...)
		if !i.Enabled {
			i.Grants = []string{}
		}
		return saveInstance(tx, i)
	})
	return i, err
}
func migrate(tx *persistence.MiniAppStore, id string, old, next Package, now time.Time) error {
	size, err := tx.InstanceRecordBytes(id)
	if err != nil {
		return err
	}
	// v1 permits additive fields with explicit defaults. Retyping or dropping
	// data requires a future migration contract and leaves existing data intact.
	defaults := map[string]map[string]any{}
	steps := map[int]Migration{}
	for _, m := range next.Migrations {
		steps[m.From] = m
	}
	for v := old.SchemaVersion; v < next.SchemaVersion; v++ {
		m, ok := steps[v]
		if !ok {
			return invalid("missing migration step")
		}
		for col, fields := range m.Defaults {
			if defaults[col] == nil {
				defaults[col] = map[string]any{}
			}
			for k, x := range fields {
				// Later defaults leave an already materialized value intact,
				// including when several schema transitions run in one upgrade.
				if _, exists := defaults[col][k]; !exists {
					defaults[col][k] = resolve(x, nil, now)
				}
			}
		}
	}
	if next.SchemaVersion == old.SchemaVersion && len(next.Collections) != len(old.Collections) {
		return invalid("collection change requires schema migration")
	}
	for col, c := range old.Collections {
		target := next.Collections[col]
		for k, t := range c.Fields {
			if target.Fields[k] != t {
				return invalid("upgrade would remove or retype a field")
			}
		}
		if len(target.Fields) == len(c.Fields) {
			continue
		}
		for k := range target.Fields {
			if _, exists := c.Fields[k]; !exists {
				if _, ok := defaults[col][k]; !ok {
					return invalid("missing default for new field")
				}
			}
		}
		rows, err := loadRecords(tx, id, col)
		if err != nil {
			return err
		}
		for _, row := range rows {
			before, err := json.Marshal(row.Fields)
			if err != nil {
				return err
			}
			for k, x := range defaults[col] {
				if _, exists := row.Fields[k]; !exists {
					row.Fields[k] = x
				}
			}
			after, err := json.Marshal(row.Fields)
			if err != nil {
				return err
			}
			size += len(after) - len(before)
			if size > 16<<20 {
				return invalid("upgraded instance exceeds storage limit")
			}
			row.Revision++
			if err := saveRecord(tx, id, col, row); err != nil {
				return err
			}
		}
	}
	return nil
}

// RemoveRelease preserves every instance and permits removal only after its users are removed.
func (s *Service) RemoveRelease(ctx context.Context, id string) error {
	return s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		if _, err := loadRelease(tx, id); err != nil {
			return err
		}
		return tx.DeleteUnusedAppRelease(id)
	})
}

// releaseOrigin decodes host-created provenance. An absent signing authority
// cannot authorize a catalog update.
func releaseOrigin(origin string) (channel, authority string, official bool) {
	for _, prefix := range []string{"catalog:", "official-catalog:"} {
		if strings.HasPrefix(origin, prefix) {
			key := strings.TrimPrefix(origin, prefix)
			decoded, err := hex.DecodeString(key)
			if err != nil || len(decoded) != sha256.Size || key != strings.ToLower(key) {
				return "", "", false
			}
			return "catalog", key, prefix == "official-catalog:"
		}
	}
	return origin, "", false
}

func (r Release) DistributionOrigin() string {
	if r.Origin != "catalog" || r.CatalogAuthority == "" {
		return r.Origin
	}
	if r.OfficialCatalog {
		return "official-catalog:" + r.CatalogAuthority
	}
	return "catalog:" + r.CatalogAuthority
}

func compatibleAuthority(before, after Release) bool {
	switch before.Origin {
	case "catalog":
		if after.Origin == "catalog" {
			return before.CatalogAuthority != "" && before.CatalogAuthority == after.CatalogAuthority
		}
		return after.Origin == "builtin" && before.OfficialCatalog
	case "builtin":
		return after.Origin == "builtin" || after.Origin == "catalog" && after.OfficialCatalog
	case "local":
		return after.Origin == "local"
	default:
		return false
	}
}
