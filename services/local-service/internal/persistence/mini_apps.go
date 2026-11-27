package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
)

const miniAppsMigration = `
CREATE TABLE IF NOT EXISTS mini_app_releases (
 id TEXT PRIMARY KEY, digest TEXT NOT NULL, origin TEXT NOT NULL, manifest BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS mini_app_instances (
 id TEXT PRIMARY KEY, release_id TEXT NOT NULL REFERENCES mini_app_releases(id), name TEXT NOT NULL,
 revision INTEGER NOT NULL, enabled INTEGER NOT NULL, grants BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS mini_app_blobs (
 instance_id TEXT NOT NULL REFERENCES mini_app_instances(id) ON DELETE CASCADE,
 id TEXT NOT NULL, name TEXT NOT NULL, content BLOB NOT NULL, PRIMARY KEY(instance_id,id)
);
CREATE TABLE IF NOT EXISTS mini_app_records (
 instance_id TEXT NOT NULL REFERENCES mini_app_instances(id) ON DELETE CASCADE,
 collection TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, fields BLOB NOT NULL,
 PRIMARY KEY(instance_id, collection, id)
);
CREATE TABLE IF NOT EXISTS mini_app_invocations (
 instance_id TEXT NOT NULL REFERENCES mini_app_instances(id) ON DELETE CASCADE,
 id TEXT NOT NULL, fingerprint TEXT NOT NULL, result BLOB NOT NULL, PRIMARY KEY(instance_id,id)
);
CREATE TABLE IF NOT EXISTS mini_app_tasks (
 instance_id TEXT NOT NULL REFERENCES mini_app_instances(id) ON DELETE CASCADE,
 id TEXT NOT NULL, fingerprint TEXT NOT NULL, state TEXT NOT NULL, request TEXT NOT NULL DEFAULT '',
 result TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', snapshot TEXT NOT NULL DEFAULT '', verification TEXT NOT NULL DEFAULT '', PRIMARY KEY(instance_id,id)
);
PRAGMA user_version=30;
`

// MiniAppTransaction scopes reads, validations and changes to a single consistent snapshot.
func (s *SQLiteStore) MiniAppTransaction(ctx context.Context, run func(*MiniAppStore) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = run(&MiniAppStore{ctx, tx}); err != nil {
		return err
	}
	return tx.Commit()
}

type MiniAppStore struct {
	ctx context.Context
	tx  *sql.Tx
}
type AppRelease struct {
	ID, Digest, Origin string
	Manifest           []byte
}
type AppInstance struct {
	ID, ReleaseID, Name string
	Revision            int64
	Enabled             bool
	Grants              []byte
}
type AppRecord struct {
	ID       string
	Revision int64
	Fields   []byte
}

func (s *MiniAppStore) Release(id string) (r AppRelease, err error) {
	err = s.tx.QueryRowContext(s.ctx, "SELECT id,digest,origin,manifest FROM mini_app_releases WHERE id=?", id).Scan(&r.ID, &r.Digest, &r.Origin, &r.Manifest)
	return
}
func (s *MiniAppStore) ReleaseIDs() ([]string, error) {
	return s.ids("SELECT id FROM mini_app_releases ORDER BY rowid")
}
func (s *MiniAppStore) InstanceIDs() ([]string, error) {
	return s.ids("SELECT id FROM mini_app_instances ORDER BY rowid")
}
func (s *MiniAppStore) ids(query string) ([]string, error) {
	rows, err := s.tx.QueryContext(s.ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
func (s *MiniAppStore) AddRelease(r AppRelease) error {
	_, err := s.tx.ExecContext(s.ctx, "INSERT INTO mini_app_releases(id,digest,origin,manifest) VALUES(?,?,?,?)", r.ID, r.Digest, r.Origin, r.Manifest)
	return err
}
func (s *MiniAppStore) Instance(id string) (i AppInstance, err error) {
	err = s.tx.QueryRowContext(s.ctx, "SELECT id,release_id,name,revision,enabled,grants FROM mini_app_instances WHERE id=?", id).Scan(&i.ID, &i.ReleaseID, &i.Name, &i.Revision, &i.Enabled, &i.Grants)
	return
}
func (s *MiniAppStore) SaveInstance(i AppInstance) error {
	_, err := s.tx.ExecContext(s.ctx, `INSERT INTO mini_app_instances(id,release_id,name,revision,enabled,grants) VALUES(?,?,?,?,?,?)
	ON CONFLICT(id) DO UPDATE SET release_id=excluded.release_id,revision=excluded.revision,enabled=excluded.enabled,grants=excluded.grants`, i.ID, i.ReleaseID, i.Name, i.Revision, i.Enabled, i.Grants)
	return err
}
func (s *MiniAppStore) DeleteInstance(id string) error {
	_, err := s.tx.ExecContext(s.ctx, "DELETE FROM mini_app_instances WHERE id=?", id)
	return err
}
func (s *MiniAppStore) Records(instance, collection string) ([]AppRecord, error) {
	rows, err := s.tx.QueryContext(s.ctx, "SELECT id,revision,fields FROM mini_app_records WHERE instance_id=? AND collection=? ORDER BY rowid", instance, collection)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []AppRecord
	for rows.Next() {
		var r AppRecord
		if err := rows.Scan(&r.ID, &r.Revision, &r.Fields); err != nil {
			return nil, err
		}
		records = append(records, r)
	}
	return records, rows.Err()
}
func (s *MiniAppStore) SaveRecord(instance, collection string, r AppRecord) error {
	_, err := s.tx.ExecContext(s.ctx, `INSERT INTO mini_app_records(instance_id,collection,id,revision,fields) VALUES(?,?,?,?,?)
	ON CONFLICT(instance_id,collection,id) DO UPDATE SET revision=excluded.revision,fields=excluded.fields`, instance, collection, r.ID, r.Revision, r.Fields)
	return err
}
func (s *MiniAppStore) RecordCount(instance string) (count int, err error) {
	err = s.tx.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM mini_app_records WHERE instance_id=?", instance).Scan(&count)
	return
}
func (s *MiniAppStore) Invocation(instance, id string) (fingerprint string, result []byte, err error) {
	err = s.tx.QueryRowContext(s.ctx, "SELECT fingerprint,result FROM mini_app_invocations WHERE instance_id=? AND id=?", instance, id).Scan(&fingerprint, &result)
	return
}
func (s *MiniAppStore) SaveInvocation(instance, id, fingerprint string, result []byte) error {
	_, err := s.tx.ExecContext(s.ctx, "INSERT INTO mini_app_invocations(instance_id,id,fingerprint,result,created_at) VALUES(?,?,?,?,unixepoch())", instance, id, fingerprint, result)
	if err == nil {
		_, err = s.tx.ExecContext(s.ctx, compactReceipts, instance)
	}
	return err
}

func (s *MiniAppStore) InstanceRecordBytes(instance string) (size int, err error) {
	err = s.tx.QueryRowContext(s.ctx, "SELECT COALESCE(SUM(length(fields)),0) FROM mini_app_records WHERE instance_id=?", instance).Scan(&size)
	return
}

func (s *MiniAppStore) DeleteRecords(instance, collection string, ids []string) error {
	raw, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	_, err = s.tx.ExecContext(s.ctx, `DELETE FROM mini_app_records WHERE instance_id=? AND collection=? AND id IN (SELECT value FROM json_each(?))`, instance, collection, string(raw))
	if err != nil {
		return err
	}
	// Earlier committed previews may contain previous versions of a deleted record.
	// Retain the operation fingerprint so a retry cannot recreate the erased content.
	_, err = s.tx.ExecContext(s.ctx, `UPDATE mini_app_invocations SET result=X''
      WHERE instance_id=? AND length(result)>0 AND EXISTS (
       SELECT 1 FROM json_each(CASE WHEN length(result)>0 THEN CAST(result AS TEXT) ELSE '{}' END,'$.records') r
       WHERE json_extract(r.value,'$.id') IN (SELECT value FROM json_each(?)))`, instance, string(raw))
	return err
}
