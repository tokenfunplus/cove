package miniapps

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestLegacyCopySurvivesRestartAndIndependentOfficialUpgrade(t *testing.T) {
	path := filepath.Join(t.TempDir(), "workspace.sqlite")
	db, service := storeAt(t, path)
	raw, err := os.ReadFile("../appcatalog/testdata/legacy-releases/japanese-review-book-1.1.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	old, err := service.Install(t.Context(), raw, "builtin")
	if err != nil {
		t.Fatal(err)
	}
	grants := []string{"records.query", "records.commit", "blobs.import"}
	book, err := service.Create(t.Context(), CreateRequest{Name: "Saved learning", ReleaseID: old.ID, Grants: grants})
	if err != nil {
		t.Fatal(err)
	}
	rows := call(t, service, book.ID, read("review.listAll")).Records
	write := Invocation{Action: "review.markLearned", Surface: "page", OperationID: "learn-before-extraction", Records: []RecordRef{{ID: rows[0].ID, Revision: rows[0].Revision}}}
	write.Confirm = call(t, service, book.ID, write).Confirmation
	call(t, service, book.ID, write)
	if err := service.ImportBlob(t.Context(), book.ID, persistence.MiniAppBlob{ID: uuid.NewString(), Name: "lesson.txt", Size: 12, Data: []byte("Saved lesson")}); err != nil {
		t.Fatal(err)
	}
	before, err := service.Export(t.Context(), book.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, service = storeAt(t, path)
	defer db.Close()
	reopened, err := service.Export(t.Context(), book.ID)
	if err != nil || !reflect.DeepEqual(before, reopened) {
		t.Fatal("restart changed the legacy copy", err)
	}
	nextRaw, err := os.ReadFile("../appcatalog/testdata/legacy-releases/japanese-review-book-1.2.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	// The new version is absent from the compatibility list and independently distributed.
	nextRaw = bytes.Replace(nextRaw, []byte(`"version": "1.2.0"`), []byte(`"version": "1.3.0"`), 1)
	current, err := service.Instance(t.Context(), book.ID)
	if err != nil {
		t.Fatal(err)
	}
	custom, err := service.Install(t.Context(), nextRaw, "catalog:"+strings.Repeat("b", 64))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Upgrade(t.Context(), book.ID, UpgradeRequest{Revision: current.Revision, ReleaseID: custom.ID, Grants: grants}); err == nil {
		t.Fatal("a custom signer inherited the old official copy")
	}
	official, err := service.Install(t.Context(), nextRaw, "official-catalog:"+strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	afterInstance, err := service.Upgrade(t.Context(), book.ID, UpgradeRequest{Revision: current.Revision, ReleaseID: official.ID, Grants: grants})
	if err != nil {
		t.Fatal(err)
	}
	after, err := service.Export(t.Context(), book.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterInstance.ID != current.ID || afterInstance.Name != current.Name || !reflect.DeepEqual(afterInstance.Grants, current.Grants) || afterInstance.CloudEnabled {
		t.Fatal("upgrade changed the copy or permissions")
	}
	if !reflect.DeepEqual(before.Attachments, after.Attachments) {
		t.Fatal("upgrade changed attachments")
	}
	for _, oldRow := range before.Collections["questions"] {
		found := false
		for _, row := range after.Collections["questions"] {
			if row.ID != oldRow.ID {
				continue
			}
			found = true
			for field, value := range oldRow.Fields {
				if !reflect.DeepEqual(row.Fields[field], value) {
					t.Fatal("saved learning field changed", field)
				}
			}
		}
		if !found {
			t.Fatal("saved question lost")
		}
	}
}
