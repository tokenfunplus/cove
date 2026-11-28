package miniapps

import (
	"maps"
	"testing"
)

func TestSkippedMigrationsPreserveFirstDefault(t *testing.T) {
	db, service := storeAt(t, ":memory:")
	t.Cleanup(func() { _ = db.Close() })
	pkg, err := Validate(example(t))
	if err != nil {
		t.Fatal(err)
	}
	pkg.Publisher = "migration-author"
	first := newRelease(t, service, pkg, "local")
	create := func(name string) Instance {
		t.Helper()
		book, err := service.Create(t.Context(), CreateRequest{ReleaseID: first.ID, Name: name, Grants: first.Package.Capabilities})
		if err != nil {
			t.Fatal(err)
		}
		return book
	}
	direct, staged := create("Direct upgrade"), create("Staged upgrade")
	pkg.Version, pkg.SchemaVersion = "1.1.0", 2
	pkg.Collections["items"].Fields["priority"] = "number"
	pkg.Actions["inbox.add"].Values["priority"] = 2.0
	pkg.Seed["items"][0]["priority"] = 2.0
	pkg.Migrations = []Migration{{From: 1, To: 2, Defaults: map[string]map[string]any{"items": {"priority": 2.0}}}}
	second := newRelease(t, service, pkg, "local")
	pkg.Version, pkg.SchemaVersion = "1.2.0", 3
	pkg.Collections["items"].Fields["starred"] = "bool"
	pkg.Actions["inbox.add"].Values["starred"] = false
	pkg.Actions["inbox.add"].Values["priority"] = 7.0
	pkg.Seed["items"][0]["starred"] = false
	pkg.Seed["items"][0]["priority"] = 7.0
	pkg.Migrations = append(pkg.Migrations, Migration{From: 2, To: 3, Defaults: map[string]map[string]any{"items": {"priority": 7.0, "starred": false}}})
	third := newRelease(t, service, pkg, "local")
	upgrade := func(book Instance, release Release) Instance {
		t.Helper()
		updated, err := service.Upgrade(t.Context(), book.ID, UpgradeRequest{ReleaseID: release.ID, Revision: book.Revision, Grants: book.Grants})
		if err != nil {
			t.Fatal(err)
		}
		return updated
	}
	upgrade(direct, third)
	staged = upgrade(staged, second)
	upgrade(staged, third)
	directRows := call(t, service, direct.ID, read("inbox.all")).Records
	stagedRows := call(t, service, staged.ID, read("inbox.all")).Records
	if len(directRows) != 1 || len(stagedRows) != 1 {
		t.Fatal("upgrade lost records", directRows, stagedRows)
	}
	if directRows[0].Fields["priority"] != 2.0 || directRows[0].Fields["starred"] != false || !maps.Equal(directRows[0].Fields, stagedRows[0].Fields) {
		t.Fatal("skipping releases changed the materialized defaults", directRows, stagedRows)
	}
}
