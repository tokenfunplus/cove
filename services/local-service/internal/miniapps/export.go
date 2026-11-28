package miniapps

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/appcatalog"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

// Allow instance records, base64-encoded attachments and the envelope.
const MaxBackupBytes = 42 << 20

var ErrBackupRelease = errors.New("install the exact package release used by this backup")

// Backup is an owner-initiated snapshot of the saved record collections. Its
// identity selects an installed release. It carries no executable package bytes.
type Backup struct {
	CatalogAuthority string                    `json:"catalog_authority,omitempty"`
	Attachments      []persistence.MiniAppBlob `json:"attachments,omitempty"`
	Format           string                    `json:"format"`
	ReleaseID        string                    `json:"release_id"`
	Digest           string                    `json:"digest"`
	Publisher        string                    `json:"publisher"`
	App              string                    `json:"app"`
	Version          string                    `json:"version"`
	Name             string                    `json:"name"`
	Collections      map[string][]Record       `json:"collections"`
}

func (s *Service) Export(ctx context.Context, id string) (Backup, error) {
	var result Backup
	err := s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		instance, err := loadInstance(tx, id)
		if err != nil {
			return err
		}
		release, err := loadRelease(tx, instance.ReleaseID)
		if err != nil {
			return err
		}
		result = Backup{
			Format: "cove-instance/1", ReleaseID: release.ID, Digest: release.Digest, CatalogAuthority: release.CatalogAuthority,
			Publisher: release.Package.Publisher, App: release.Package.App,
			Version: release.Package.Version, Name: instance.Name,
			Collections: map[string][]Record{},
		}
		result.Attachments, err = tx.AppBlobs(id, true)
		if err != nil {
			return err
		}
		for collection := range release.Package.Collections {
			rows, err := loadRecords(tx, id, collection)
			if err != nil {
				return err
			}
			result.Collections[collection] = rows
		}
		return nil
	})
	return result, err
}

func decodeBackup(raw []byte) (Backup, error) {
	var b Backup
	if len(raw) == 0 || len(raw) > MaxBackupBytes || !utf8.Valid(raw) {
		return b, invalid("backup size or encoding")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := scanTypedJSON(dec, 0, reflect.TypeFor[Backup]()); err != nil {
		return b, invalid("malformed or ambiguous backup")
	}
	if _, err := dec.Token(); err != io.EOF {
		return b, invalid("unexpected trailing backup data")
	}
	dec = json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&b); err != nil {
		return b, invalid("unsupported backup fields")
	}
	if b.Format != "cove-instance/1" || !short(b.Name, 100) || len(b.ReleaseID) != 64 || len(b.Digest) != 64 {
		return b, invalid("backup format, identity or name")
	}
	if b.CatalogAuthority != "" {
		channel, authority, _ := releaseOrigin("catalog:" + b.CatalogAuthority)
		if channel != "catalog" || authority == "" || !backupHasAuthority(b, authority) {
			return b, invalid("backup signing authority")
		}
	}
	return b, nil
}

func backupHasAuthority(b Backup, authority string) bool {
	return b.ReleaseID == releaseID("catalog:"+authority, b.Publisher, b.App, b.Version) || b.ReleaseID == releaseID("official-catalog:"+authority, b.Publisher, b.App, b.Version)
}

// Archived releases may move between the bundle and the signed catalog.
// A personal import is always resolved within its original distribution channel.
func releaseForBackup(tx *persistence.MiniAppStore, b Backup) (Release, error) {
	original, err := loadRelease(tx, b.ReleaseID)
	if err == nil && matchesBackup(original, b) {
		return original, nil
	}
	if err != nil && !errors.Is(err, ErrNotFound) {
		return Release{}, err
	}
	builtin := releaseID("builtin", b.Publisher, b.App, b.Version)
	fromBundle := b.ReleaseID == builtin
	fromCatalog := b.CatalogAuthority != "" && backupHasAuthority(b, b.CatalogAuthority)
	if !fromBundle && !fromCatalog {
		return Release{}, ErrBackupRelease
	}
	ids, err := tx.ReleaseIDs()
	if err != nil {
		return Release{}, err
	}
	for _, id := range ids {
		r, err := loadRelease(tx, id)
		if err != nil {
			return Release{}, err
		}
		if !matchesBackup(r, b) {
			continue
		}
		if fromCatalog && r.Origin == "builtin" && appcatalog.IsBundledDigest(b.Digest) ||
			fromBundle && r.Origin == "catalog" && r.OfficialCatalog ||
			fromCatalog && r.Origin == "catalog" && r.CatalogAuthority == b.CatalogAuthority {
			return r, nil
		}
	}
	return Release{}, ErrBackupRelease
}

func matchesBackup(r Release, b Backup) bool {
	return r.Digest == b.Digest && r.Package.Publisher == b.Publisher && r.Package.App == b.App && r.Package.Version == b.Version
}

// Restore creates a separate disabled instance. Treat saved fields as literal
// user data, never as expressions from a package.
func (s *Service) Restore(ctx context.Context, raw []byte) (Instance, error) {
	backup, err := decodeBackup(raw)
	if err != nil {
		return Instance{}, err
	}
	var restored Instance
	err = s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		release, err := releaseForBackup(tx, backup)
		if err != nil {
			return err
		}
		p := release.Package
		if len(backup.Collections) != len(p.Collections) {
			return invalid("backup collection list")
		}
		restored = Instance{
			ID: uuid.NewString(), ReleaseID: release.ID, Name: backup.Name, Revision: 1,
			Enabled: false, Grants: []string{},
		}
		if err := saveInstance(tx, restored); err != nil {
			return err
		}
		if len(backup.Attachments) > 64 {
			return invalid("backup attachment limit")
		}
		blobSize := 0
		seenBlobs := map[string]bool{}
		for _, b := range backup.Attachments {
			blobSize += len(b.Data)
			if !validBlob(b) || blobSize > 16<<20 || seenBlobs[b.ID] {
				return invalid("backup attachment")
			}
			seenBlobs[b.ID] = true
			if err := tx.SaveAppBlob(restored.ID, b); err != nil {
				return err
			}
		}
		count := 0
		for name, collection := range p.Collections {
			rows, exists := backup.Collections[name]
			count += len(rows)
			if !exists || rows == nil || count > maxRecords {
				return invalid("backup collection or record limit")
			}
			seen := map[string]bool{}
			for _, row := range rows {
				id, err := uuid.Parse(row.ID)
				if err != nil || id.String() != row.ID || seen[row.ID] || row.Revision < 1 || row.Revision >= 1<<53 || !inputOK(row.Fields, collection.Fields) {
					return invalid("backup contains an invalid record")
				}
				seen[row.ID] = true
				if err := saveRecord(tx, restored.ID, name, row); err != nil {
					return err
				}
			}
		}
		size, err := tx.InstanceRecordBytes(restored.ID)
		if err != nil {
			return err
		}
		if size > 16<<20 {
			return invalid("backup instance storage limit")
		}
		return nil
	})
	if err != nil {
		return Instance{}, err
	}
	return restored, nil
}
