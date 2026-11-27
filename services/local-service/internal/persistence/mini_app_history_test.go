package persistence

import (
	"path/filepath"
	"testing"
)

func TestCompactAppPayloadsPreservesDeduplicationAndUserRecords(t *testing.T) {
	ctx := t.Context()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "history.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	err = store.MiniAppTransaction(ctx, func(tx *MiniAppStore) error {
		if err := tx.AddRelease(AppRelease{ID: "release", Origin: "local", Digest: "digest", Manifest: []byte("{}")}); err != nil {
			return err
		}
		if err := tx.SaveInstance(AppInstance{ID: "test", ReleaseID: "release", Grants: []byte("[]")}); err != nil {
			return err
		}
		if err := tx.SaveRecord("test", "items", AppRecord{ID: "record", Revision: 1, Fields: []byte(`{"title":"user-owned"}`)}); err != nil {
			return err
		}
		return tx.SaveInvocation("test", "write", "fingerprint", []byte(`{"records":[]}`))
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = store.BeginAppTask(ctx, "test", "finished", "job-fingerprint", `{"Target":{"input":{"title":"synthetic source"}}}`); err != nil {
		t.Fatal(err)
	}
	if err = store.FinishAppTask(ctx, "test", "finished", "completed", "candidate", ""); err != nil {
		t.Fatal(err)
	}
	if err = store.BeginAppTask(ctx, "test", "in-progress", "other", "{}"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.db.Exec("UPDATE mini_app_tasks SET created_at=0; UPDATE mini_app_invocations SET created_at=0"); err != nil {
		t.Fatal(err)
	}
	if err = store.PruneAppHistory(ctx); err != nil {
		t.Fatal(err)
	}
	task, found, err := store.FindAppTask(ctx, "test", "finished")
	if err != nil || !found || task.State != "expired" || task.Result != "" || task.Fingerprint != "job-fingerprint" {
		t.Fatal("retired task lost identity or retained result", err)
	}
	active, err := store.AppTask(ctx, "test", "in-progress")
	if err != nil || active.State != "running" {
		t.Fatal("active task was lost", err)
	}
	err = store.MiniAppTransaction(ctx, func(tx *MiniAppStore) error {
		fp, payload, err := tx.Invocation("test", "write")
		if err != nil {
			return err
		}
		if fp != "fingerprint" || len(payload) != 0 {
			t.Fatal("write tombstone was lost")
		}
		records, err := tx.Records("test", "items")
		if err == nil && len(records) != 1 {
			t.Fatal("user record was removed")
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}
