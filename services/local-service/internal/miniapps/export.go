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

// Restore creates a separate disabled instance. Validate the snapshot as typed
// literal data; expressions in user text must never be evaluated on restore.
func (s *Service) Restore(ctx context.Context, raw []byte) (Instance, error) {
	backup, err := decodeBackup(raw)
	if err != nil {
		return Instance{}, err
	}
	var restored Instance
	err = s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		release, err := loadRelease(tx, backup.ReleaseID)
		if errors.Is(err, ErrNotFound) || errors.Is(err, sql.ErrNoRows) {
			return ErrBackupRelease
		}
		if err != nil {
			return err
		}
		p := release.Package
		if release.Digest != backup.Digest || p.Publisher != backup.Publisher || p.App != backup.App || p.Version != backup.Version {
			return ErrBackupRelease
		}
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
