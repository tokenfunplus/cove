package persistence

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func taskActivityStore(t *testing.T) *SQLiteStore {
	t.Helper()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "tasks.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	err = store.MiniAppTransaction(t.Context(), func(tx *MiniAppStore) error {
		if err := tx.AddRelease(AppRelease{ID: "release", Manifest: []byte("{}")}); err != nil {
			return err
		}
		return tx.SaveInstance(AppInstance{ID: "instance", ReleaseID: "release", Grants: []byte("[]")})
	})
	if err != nil {
		t.Fatal(err)
	}
	return store
}

const frozenActivityTask = `{"Release":"original-release","Target":{"action":"fixture.generate","surface":"panel"}}`

func TestTaskReadsRetainTheFrozenRelease(t *testing.T) {
	store := taskActivityStore(t)
	if err := store.BeginAppTask(t.Context(), "instance", "task", "fingerprint", frozenActivityTask); err != nil {
		t.Fatal(err)
	}
	// The active instance uses "release", while the task belongs to its earlier release.
	task, err := store.AppTask(t.Context(), "instance", "task")
	if err != nil || task.ReleaseID != "original-release" || task.Action != "fixture.generate" {
		t.Fatal("task detail lost its originating release or action", task, err)
	}
	tasks, err := store.ListAppTasks(t.Context(), "instance")
	if err != nil || len(tasks) != 1 || tasks[0].ReleaseID != "original-release" || tasks[0].Action != task.Action {
		t.Fatal("task history lost its originating release or action", tasks, err)
	}
}

func failTaskActivity(t *testing.T, store *SQLiteStore, status string) {
	t.Helper()
	// The status is supplied only by these fixed test cases.
	_, err := store.db.Exec("CREATE TRIGGER fail_activity BEFORE INSERT ON mini_app_activity WHEN NEW.status='" + status + "' BEGIN SELECT RAISE(FAIL,'fixture activity unavailable'); END")
	if err != nil {
		t.Fatal(err)
	}
}

func restoreTaskActivity(t *testing.T, store *SQLiteStore) {
	t.Helper()
	if _, err := store.db.Exec("DROP TRIGGER fail_activity"); err != nil {
		t.Fatal(err)
	}
}

func assertTaskActivity(t *testing.T, store *SQLiteStore, status string) {
	t.Helper()
	entries, err := store.AppActivity(t.Context(), "instance")
	if err != nil || len(entries) != 1 {
		t.Fatal("task activity missing", entries, err)
	}
	entry := entries[0]
	if entry.Status != status || entry.Action != "fixture.generate" || entry.Surface != "panel" || entry.Release != "original-release" {
		t.Fatal("task activity differs from frozen request", entry)
	}
}

func TestTaskAdmissionAndActivityCommitTogether(t *testing.T) {
	for _, browser := range []bool{false, true} {
		name := "ordinary"
		if browser {
			name = "browser"
		}
		t.Run(name, func(t *testing.T) {
			store := taskActivityStore(t)
			begin := func() error {
				if browser {
					return store.BeginBrowserAppTask(t.Context(), "instance", "task", "fingerprint", frozenActivityTask, ProviderSnapshot{})
				}
				return store.BeginAppTask(t.Context(), "instance", "task", "fingerprint", frozenActivityTask)
			}
			failTaskActivity(t, store, "running")
			if err := begin(); err == nil {
				t.Fatal("expected admission failure")
			}
			if _, found, err := store.FindAppTask(t.Context(), "instance", "task"); err != nil || found {
				t.Fatal("failed admission left an orphan task", found, err)
			}
			restoreTaskActivity(t, store)
			if err := begin(); err != nil {
				t.Fatal("failed admission could not be retried", err)
			}
			assertTaskActivity(t, store, "running")
		})
	}
}

func TestTaskSettlementAndActivityCommitTogether(t *testing.T) {
	for _, browser := range []bool{false, true} {
		name := "ordinary"
		if browser {
			name = "browser"
		}
		t.Run(name, func(t *testing.T) {
			store := taskActivityStore(t)
			var err error
			if browser {
				err = store.BeginBrowserAppTask(t.Context(), "instance", "task", "fingerprint", frozenActivityTask, ProviderSnapshot{})
			} else {
				err = store.BeginAppTask(t.Context(), "instance", "task", "fingerprint", frozenActivityTask)
			}
			if err != nil {
				t.Fatal(err)
			}
			finish := func(state string) error {
				if browser {
					return store.FinishBrowserAppTask(t.Context(), "instance", "task", state, "candidate", "", GenerationVerification{}, "receipt")
				}
				return store.FinishAppTask(t.Context(), "instance", "task", state, "candidate", "")
			}
			failTaskActivity(t, store, "completed")
			if err := finish("completed"); err == nil {
				t.Fatal("expected settlement failure")
			}
			task, err := store.AppTask(t.Context(), "instance", "task")
			if err != nil || task.State != "running" || task.Result != "" || task.Verification != nil {
				t.Fatal("failed settlement partially committed", task, err)
			}
			accepted, err := store.AppBrowserSettlement(t.Context(), "instance", "task", "receipt")
			if err != nil || accepted {
				t.Fatal("failed settlement retained its receipt", accepted, err)
			}
			assertTaskActivity(t, store, "running")
			restoreTaskActivity(t, store)
			if err := finish("completed"); err != nil {
				t.Fatal("settlement retry failed", err)
			}
			assertTaskActivity(t, store, "completed")
			task, err = store.AppTask(t.Context(), "instance", "task")
			if err != nil || task.State != "completed" || task.Result != "candidate" {
				t.Fatal("settlement retry lost the result", task, err)
			}
			if browser {
				accepted, err = store.AppBrowserSettlement(t.Context(), "instance", "task", "receipt")
				if err != nil || !accepted {
					t.Fatal("settlement retry lost its receipt", accepted, err)
				}
				if err := finish("failed"); !errors.Is(err, sql.ErrNoRows) {
					t.Fatal("terminal browser task accepted a second settlement", err)
				}
			} else if err := finish("failed"); err != nil {
				t.Fatal("ordinary terminal finish must remain a no-op", err)
			}
			assertTaskActivity(t, store, "completed")
		})
	}
}

func TestTaskActivityReadsMetadataBeforeCompaction(t *testing.T) {
	store := taskActivityStore(t)
	if err := store.BeginAppTask(t.Context(), "instance", "task", "fingerprint", frozenActivityTask); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec("UPDATE mini_app_tasks SET created_at=0"); err != nil {
		t.Fatal(err)
	}
	if err := store.FinishAppTask(t.Context(), "instance", "task", "completed", "candidate", ""); err != nil {
		t.Fatal(err)
	}
	assertTaskActivity(t, store, "completed")
	var state, request string
	if err := store.db.QueryRow("SELECT state,request FROM mini_app_tasks").Scan(&state, &request); err != nil || state != "expired" || request != "{}" {
		t.Fatal("fixture did not exercise request compaction", state, request, err)
	}
}

func TestTaskRecoveryAndActivityCommitTogether(t *testing.T) {
	store := taskActivityStore(t)
	if err := store.BeginAppTask(t.Context(), "instance", "task", "fingerprint", frozenActivityTask); err != nil {
		t.Fatal(err)
	}
	failTaskActivity(t, store, "failed")
	if err := store.RecoverAppTasks(t.Context()); err == nil {
		t.Fatal("expected recovery failure")
	}
	task, err := store.AppTask(t.Context(), "instance", "task")
	if err != nil || task.State != "running" {
		t.Fatal("failed recovery partially committed", task, err)
	}
	assertTaskActivity(t, store, "running")
	restoreTaskActivity(t, store)
	if err := store.RecoverAppTasks(t.Context()); err != nil {
		t.Fatal("recovery retry failed", err)
	}
	task, err = store.AppTask(t.Context(), "instance", "task")
	if err != nil || task.State != "failed" || task.Error == "" {
		t.Fatal("interrupted task was not recovered", task, err)
	}
	assertTaskActivity(t, store, "failed")
}
