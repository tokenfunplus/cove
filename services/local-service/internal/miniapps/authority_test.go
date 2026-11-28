package miniapps

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestCatalogAuthorityPersistsAndLegacyCatalogDoesNotAdoptASigner(t *testing.T) {
	path := filepath.Join(t.TempDir(), "catalog.sqlite")
	db, service := storeAt(t, path)
	pkg, err := Validate(example(t))
	if err != nil {
		t.Fatal(err)
	}
	pkg.Publisher, pkg.App = "author", "notes"
	legacy := newRelease(t, service, pkg, "catalog")
	bound := newRelease(t, service, pkg, "catalog:"+strings.Repeat("a", 64))
	if legacy.ID == bound.ID {
		t.Fatal("unbound legacy and signed releases share an identity")
	}
	book, err := service.Create(t.Context(), CreateRequest{ReleaseID: legacy.ID, Name: "Legacy notes", Grants: pkg.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	pkg.Version = "1.1.0"
	next := newRelease(t, service, pkg, "catalog:"+strings.Repeat("a", 64))
	if _, err := service.Upgrade(t.Context(), book.ID, UpgradeRequest{Revision: book.Revision, ReleaseID: next.ID, Grants: book.Grants}); !errors.Is(err, ErrInvalid) {
		t.Fatal("legacy release silently adopted a signer", err)
	}
	before, err := service.Export(t.Context(), book.ID)
	if err != nil || before.ReleaseID != legacy.ID {
		t.Fatal("rejected upgrade changed legacy data", err)
	}
	db.Close()
	reopened, service := storeAt(t, path)
	defer reopened.Close()
	stored, err := service.Release(t.Context(), bound.ID)
	if err != nil || stored.Origin != "catalog" || stored.CatalogAuthority != strings.Repeat("a", 64) || stored.OfficialCatalog {
		t.Fatal("persisted signer was lost or relabeled", stored, err)
	}
	if _, err := service.Instance(t.Context(), book.ID); err != nil {
		t.Fatal("legacy instance became unreadable", err)
	}
}

func TestCatalogAuthorityCannotReplaceBundledOrPersonalLineages(t *testing.T) {
	db, service := storeAt(t, ":memory:")
	defer db.Close()
	pkg, err := Validate(example(t))
	if err != nil {
		t.Fatal(err)
	}
	old := newRelease(t, service, pkg, "builtin")
	book, err := service.Create(t.Context(), CreateRequest{ReleaseID: old.ID, Name: "Bundled notes", Grants: pkg.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	pkg.Version = "1.2.3"
	custom := newRelease(t, service, pkg, "catalog:"+strings.Repeat("a", 64))
	if _, err := service.Upgrade(t.Context(), book.ID, UpgradeRequest{Revision: book.Revision, ReleaseID: custom.ID, Grants: book.Grants}); !errors.Is(err, ErrInvalid) {
		t.Fatal("custom signer replaced a bundled identity", err)
	}
	official := newRelease(t, service, pkg, "official-catalog:"+strings.Repeat("a", 64))
	if _, err := service.Upgrade(t.Context(), book.ID, UpgradeRequest{Revision: book.Revision, ReleaseID: official.ID, Grants: book.Grants}); err != nil {
		t.Fatal("official successor rejected", err)
	}
}

func TestLegacyBackupCannotInferASignerFromIdenticalRepublications(t *testing.T) {
	sourceDB, source := storeAt(t, ":memory:")
	defer sourceDB.Close()
	pkg, err := Validate(example(t))
	if err != nil {
		t.Fatal(err)
	}
	pkg.Publisher, pkg.App = "legacy-author", "notes"
	legacy := newRelease(t, source, pkg, "catalog")
	book, err := source.Create(t.Context(), CreateRequest{ReleaseID: legacy.ID, Name: "My notes", Grants: pkg.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	backup, err := source.Export(t.Context(), book.ID)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(backup)
	if err != nil {
		t.Fatal(err)
	}
	destinationDB, destination := storeAt(t, ":memory:")
	defer destinationDB.Close()
	newRelease(t, destination, pkg, "catalog:"+strings.Repeat("a", 64))
	newRelease(t, destination, pkg, "catalog:"+strings.Repeat("b", 64))
	if _, err := destination.Restore(t.Context(), raw); !errors.Is(err, ErrBackupRelease) {
		t.Fatal("legacy snapshot arbitrarily adopted a signer", err)
	}
}
