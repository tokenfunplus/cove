package miniapps

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestInstanceAttachmentIsolationRetryAndBackup(t *testing.T) {
	db, s := storeAt(t, ":memory:")
	defer db.Close()
	ctx := t.Context()
	var pkg Package
	if err := json.Unmarshal(example(t), &pkg); err != nil {
		t.Fatal(err)
	}
	pkg.Capabilities = append(pkg.Capabilities, "blobs.import")
	raw, err := json.Marshal(pkg)
	if err != nil {
		t.Fatal(err)
	}
	release, err := s.Install(ctx, raw, "local")
	if err != nil {
		t.Fatal(err)
	}
	create := func() Instance {
		i, err := s.Create(ctx, CreateRequest{ReleaseID: release.ID, Name: "Reader", Grants: []string{"blobs.import"}})
		if err != nil {
			t.Fatal(err)
		}
		return i
	}
	a, b := create(), create()
	file := persistence.MiniAppBlob{ID: uuid.NewString(), Name: "paper.bin", Data: []byte{0, 255}, Size: 2}
	for range 2 {
		if err := s.ImportBlob(ctx, a.ID, file); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Blob(ctx, b.ID, file.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	listed, err := s.Blobs(ctx, a.ID)
	if err != nil || len(listed) != 1 || listed[0].Data != nil {
		t.Fatal("unexpected metadata", err)
	}
	renamed := file
	renamed.Name = "another.bin"
	if err := s.ImportBlob(ctx, a.ID, renamed); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	backup, err := s.Export(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	raw, err = json.Marshal(backup)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := s.Restore(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Blob(ctx, restored.ID, file.ID); !errors.Is(err, ErrDenied) {
		t.Fatal(err)
	}
	_, err = s.Configure(ctx, restored.ID, ConfigRequest{Revision: restored.Revision, Enabled: true, Grants: []string{"blobs.import"}})
	if err != nil {
		t.Fatal(err)
	}
	copy, err := s.Blob(ctx, restored.ID, file.ID)
	if err != nil || !bytes.Equal(copy.Data, file.Data) {
		t.Fatal("attachment bytes changed", err)
	}
	if err := s.DeleteBlob(ctx, a.ID, file.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Blob(ctx, restored.ID, file.ID); err != nil {
		t.Fatal(err)
	}
}
