package persistence

import (
	"context"
	"database/sql"
)

func migrateMiniAppHistory(tx *sql.Tx) error {
	// Some imported databases already have additive fields. Check each table before extending it.
	for _, col := range []struct{ table, name, ddl string }{
		{"generations", "mini_app_scope", "ALTER TABLE generations ADD COLUMN mini_app_scope TEXT NOT NULL DEFAULT ''"},
		{"mini_app_invocations", "created_at", "ALTER TABLE mini_app_invocations ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0"},
		{"mini_app_tasks", "created_at", "ALTER TABLE mini_app_tasks ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0"},
	} {
		var count int
		if err := tx.QueryRow("SELECT COUNT(*) FROM pragma_table_info(?) WHERE name=?", col.table, col.name).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			if _, err := tx.Exec(col.ddl); err != nil {
				return err
			}
		}
	}
	_, err := tx.Exec(`UPDATE mini_app_tasks SET created_at=unixepoch() WHERE created_at=0;
 UPDATE mini_app_invocations SET created_at=unixepoch() WHERE created_at=0;
 CREATE TABLE IF NOT EXISTS mini_app_activity (
 instance_id TEXT NOT NULL REFERENCES mini_app_instances(id) ON DELETE CASCADE,
 operation_id TEXT NOT NULL,release_id TEXT NOT NULL,action TEXT NOT NULL,surface TEXT NOT NULL,
 status TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(instance_id,operation_id));
 CREATE INDEX IF NOT EXISTS mini_app_activity_time ON mini_app_activity(instance_id,created_at);
 PRAGMA user_version=31;`)
	return err
}

// Compact payloads while keeping small idempotency fingerprints that prevent a repeated write or model charge.
const compactReceipts = `WITH recent AS (
 SELECT rowid AS rid,created_at,row_number() OVER (ORDER BY rowid DESC) AS position,
 sum(length(result)) OVER (ORDER BY rowid DESC) AS bytes
 FROM mini_app_invocations WHERE instance_id=? AND length(result)>0)
 UPDATE mini_app_invocations SET result=X'' WHERE rowid IN
 (SELECT rid FROM recent WHERE position>64 OR bytes>4194304 OR created_at<unixepoch()-604800)`
const compactTasks = `WITH recent AS (
 SELECT rowid AS rid,created_at,row_number() OVER (ORDER BY rowid DESC) AS position,
 sum(length(CAST(request AS BLOB))+length(CAST(result AS BLOB))+length(CAST(verification AS BLOB))+length(CAST(snapshot AS BLOB))) OVER (ORDER BY rowid DESC) AS bytes
 FROM mini_app_tasks WHERE instance_id=? AND state NOT IN ('running','expired'))
 UPDATE mini_app_tasks SET state='expired',request='{}',result='',snapshot='',verification='',detail=''
 WHERE rowid IN (SELECT rid FROM recent WHERE position>30 OR bytes>4194304 OR created_at<unixepoch()-604800)`

func (s *SQLiteStore) PruneAppHistory(ctx context.Context) error {
	return s.MiniAppTransaction(ctx, func(tx *MiniAppStore) error {
		ids, err := tx.InstanceIDs()
		if err != nil {
			return err
		}
		for _, id := range ids {
			if _, err := tx.tx.ExecContext(ctx, compactReceipts, id); err != nil {
				return err
			}
			if _, err := tx.tx.ExecContext(ctx, compactTasks, id); err != nil {
				return err
			}
		}
		_, err = tx.tx.ExecContext(ctx, "DELETE FROM mini_app_activity WHERE created_at<unixepoch()-604800")
		return err
	})
}

type AppActivity struct {
	Operation string `json:"operation_id"`
	Release   string `json:"release_id"`
	Action    string `json:"action"`
	Surface   string `json:"surface"`
	Status    string `json:"status"`
	Time      int64  `json:"time"`
}

func (tx *MiniAppStore) RecordActivity(instance, operation, release, action, surface, status string) error {
	_, err := tx.tx.ExecContext(tx.ctx, `INSERT INTO mini_app_activity VALUES(?,?,?,?,?,?,unixepoch()) ON CONFLICT(instance_id,operation_id) DO UPDATE SET status=excluded.status,created_at=excluded.created_at`, instance, operation, release, action, surface, status)
	if err != nil {
		return err
	}
	_, err = tx.tx.ExecContext(tx.ctx, `DELETE FROM mini_app_activity WHERE rowid IN (SELECT rowid FROM mini_app_activity WHERE instance_id=? ORDER BY rowid DESC LIMIT -1 OFFSET 100)`, instance)
	return err
}
func (s *SQLiteStore) AppActivity(ctx context.Context, id string) ([]AppActivity, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT operation_id,release_id,action,surface,status,created_at FROM mini_app_activity WHERE instance_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	all := []AppActivity{}
	for rows.Next() {
		var e AppActivity
		if err = rows.Scan(&e.Operation, &e.Release, &e.Action, &e.Surface, &e.Status, &e.Time); err != nil {
			return nil, err
		}
		all = append(all, e)
	}
	return all, rows.Err()
}
