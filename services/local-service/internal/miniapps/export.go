package miniapps

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

// Allow instance records, base64-encoded attachments and the envelope.
const MaxBackupBytes = 42 << 20

var ErrBackupRelease = errors.New("install the exact package release used by this backup")

// Backup is an owner-initiated snapshot of the saved record collections. Its
// identity selects an installed release. It carries no executable package bytes.
type Backup struct {
	Attachments []persistence.MiniAppBlob `json:"attachments,omitempty"`
	Format      string                    `json:"format"`
	ReleaseID   string                    `json:"release_id"`
	Digest      string                    `json:"digest"`
	Publisher   string                    `json:"publisher"`
	App         string                    `json:"app"`
	Version     string                    `json:"version"`
	Name        string                    `json:"name"`
	Collections map[string][]Record       `json:"collections"`
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
			Format: "cove-instance/1", ReleaseID: release.ID, Digest: release.Digest,
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
	if err := scanJSON(dec, 0); err != nil {
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
	return b, nil
}

// Archived releases may move between the bundle and the signed catalog.
// A personal import is always resolved within its original distribution channel.
func releaseForBackup(tx *persistence.MiniAppStore, b Backup) (Release, error) {
	builtin := releaseID("builtin", b.Publisher, b.App, b.Version)
	catalog := releaseID("catalog", b.Publisher, b.App, b.Version)
	candidates := []string{b.ReleaseID}
	switch b.ReleaseID {
	case builtin:
		candidates = append(candidates, catalog)
	case catalog:
		candidates = append(candidates, builtin)
	}
	for _, id := range candidates {
		r, err := loadRelease(tx, id)
		if errors.Is(err, ErrNotFound) {
			if b.Publisher != "cove" && id == b.ReleaseID && id == releaseID("local", b.Publisher, b.App, b.Version) {
				return restoreLocalPackageFromBundle(tx, b, builtin)
			}
			continue
		}
		if err != nil {
			return Release{}, err
		}
		if r.Digest == b.Digest && r.Package.Publisher == b.Publisher && r.Package.App == b.App && r.Package.Version == b.Version {
			return r, nil
		}
	}
	return Release{}, ErrBackupRelease
}

// Earlier releases allowed a bundled third-party package file to be installed
// locally. Restore the exact original local identity on a replacement Mac.
func restoreLocalPackageFromBundle(tx *persistence.MiniAppStore, b Backup, builtin string) (Release, error) {
	row, err := tx.Release(builtin)
	if errors.Is(err, sql.ErrNoRows) {
		return Release{}, ErrBackupRelease
	}
	if err != nil {
		return Release{}, err
	}
	if row.Origin != "builtin" || row.Digest != b.Digest {
		return Release{}, ErrBackupRelease
	}
	local, err := Preview(row.Manifest, "local")
	if err != nil {
		return Release{}, err
	}
	if local.ID != b.ReleaseID || local.Digest != b.Digest {
		return Release{}, ErrBackupRelease
	}
	row.ID, row.Origin = local.ID, local.Origin
	return local, tx.AddRelease(row)
}

// Restore creates a separate disabled instance. Validate the snapshot as typed
// literal data; expressions in user text must never be evaluated on restore.
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
