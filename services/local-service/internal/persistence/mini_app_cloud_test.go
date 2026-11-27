package persistence

import (
	"path/filepath"
	"testing"
)

func TestCloudPolicyMigrationKeepsSavedRecordsAndStartsDenied(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cloud.sqlite")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	err = store.MiniAppTransaction(t.Context(), func(tx *MiniAppStore) error {
		if err := tx.AddRelease(AppRelease{ID: "release", Manifest: []byte("{}")}); err != nil {
			return err
		}
		if err := tx.SaveInstance(AppInstance{ID: "book", ReleaseID: "release", Name: "Existing", Enabled: true, Grants: []byte(`["ai.generate"]`), CloudEnabled: true}); err != nil {
			return err
		}
		return tx.SaveRecord("book", "items", AppRecord{ID: "saved", Revision: 3, Fields: []byte(`{"title":"Kept"}`)})
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.db.Exec("ALTER TABLE mini_app_instances DROP COLUMN cloud_enabled; PRAGMA user_version=31"); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	err = store.MiniAppTransaction(t.Context(), func(tx *MiniAppStore) error {
		instance, err := tx.Instance("book")
		if err != nil {
			return err
		}
		if instance.CloudEnabled || !instance.Enabled || instance.Name != "Existing" {
			t.Fatal("existing authority changed")
		}
		rows, err := tx.Records("book", "items")
		if err == nil && (len(rows) != 1 || rows[0].Revision != 3) {
			t.Fatal("saved data changed")
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}
