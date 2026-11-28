package persistence

import (
	"fmt"
	"path/filepath"
	"strings"
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

func TestPreparedActivityReplayPreservesAdmittedStateAndHidesExpiredRows(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	err = store.MiniAppTransaction(t.Context(), func(tx *MiniAppStore) error {
		if err := tx.AddRelease(AppRelease{ID: "r", Manifest: []byte("{}")}); err != nil {
			return err
		}
		if err := tx.SaveInstance(AppInstance{ID: "i", ReleaseID: "r", Grants: []byte("[]")}); err != nil {
			return err
		}
		for _, status := range []string{"prepared", "running", "prepared", "completed", "prepared"} {
			if err := tx.RecordActivity("i", "operation", "r", "generate", "page", status); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	activity, err := store.AppActivity(t.Context(), "i")
	if err != nil || len(activity) != 1 || activity[0].Status != "completed" {
		t.Fatalf("replay reset activity: %v %v", activity, err)
	}
	if _, err := store.db.Exec("UPDATE mini_app_activity SET created_at=unixepoch()-604801"); err != nil {
		t.Fatal(err)
	}
	activity, err = store.AppActivity(t.Context(), "i")
	if err != nil || len(activity) != 0 {
		t.Fatalf("expired activity was returned: %v %v", activity, err)
	}
}

func TestTaskHistoryBudgetCountsUTF8Bytes(t *testing.T) {
	store, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	err = store.MiniAppTransaction(t.Context(), func(tx *MiniAppStore) error {
		if err := tx.AddRelease(AppRelease{ID: "r", Manifest: []byte("{}")}); err != nil {
			return err
		}
		return tx.SaveInstance(AppInstance{ID: "i", ReleaseID: "r", Grants: []byte("[]")})
	})
	if err != nil {
		t.Fatal(err)
	}
	text := strings.Repeat("\u65e5", 52000)
	for n := range 30 {
		id := fmt.Sprint(n)
		if err := store.BeginAppTask(t.Context(), "i", id, id, "{}"); err != nil {
			t.Fatal(err)
		}
		if err := store.FinishAppTask(t.Context(), "i", id, "completed", text, ""); err != nil {
			t.Fatal(err)
		}
	}
	var bytes int
	if err := store.db.QueryRow("SELECT sum(length(CAST(result AS BLOB))) FROM mini_app_tasks WHERE instance_id='i'").Scan(&bytes); err != nil {
		t.Fatal(err)
	}
	if bytes > 4194304 || bytes == 0 {
		t.Fatalf("retained %d bytes", bytes)
	}
}
