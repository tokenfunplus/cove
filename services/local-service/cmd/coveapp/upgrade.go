package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"reflect"
	"slices"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

type upgradeFixture struct {
	Grants      []string `json:"grants"`
	Attachments []struct {
		Name string `json:"name"`
		Data []byte `json:"data"`
	} `json:"attachments"`
	Before []scenarioStep `json:"before"`
	After  []scenarioStep `json:"after"`
}

func upgradeTest(oldFile, newFile, fixtureFile string, out io.Writer) error {
	raw, err := readBounded(oldFile)
	if err != nil {
		return err
	}
	next, err := readBounded(newFile)
	if err != nil {
		return err
	}
	var fixture upgradeFixture
	if err = readFixture(fixtureFile, &fixture); err != nil {
		return err
	}
	if len(fixture.Before) == 0 && len(fixture.After) == 0 && len(fixture.Attachments) == 0 {
		return errors.New("provide before steps, after steps, or attachments to exercise the upgrade")
	}
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		return err
	}
	defer store.Close()
	ctx := context.Background()
	return withWorkspace(store, raw, fixture.Grants, func(w workspace, pkg miniapps.Package) error {
		for _, f := range fixture.Attachments {
			if err := w.service.ImportBlob(ctx, w.id, persistence.MiniAppBlob{ID: uuid.NewString(), Name: f.Name, Size: len(f.Data), Data: f.Data}); err != nil {
				return fmt.Errorf("fixture attachment: %w", err)
			}
		}
		if err := w.runSteps(pkg, fixture.Before, 0, out); err != nil {
			return fmt.Errorf("before upgrade: %w", err)
		}
		old, err := w.service.Instance(ctx, w.id)
		if err != nil {
			return err
		}
		before, err := w.service.Export(ctx, w.id)
		if err != nil {
			return err
		}
		release, err := installAuthorPackage(ctx, w.service, next)
		if err != nil {
			return err
		}
		grants := slices.DeleteFunc(slices.Clone(old.Grants), func(k string) bool { return !slices.Contains(release.Package.Capabilities, k) })
		_, err = w.service.Upgrade(ctx, w.id, miniapps.UpgradeRequest{Revision: old.Revision, ReleaseID: release.ID, Grants: grants})
		if err != nil {
			return fmt.Errorf("upgrade: %w", err)
		}
		current, err := w.service.Instance(ctx, w.id)
		if err != nil {
			return err
		}
		if current.ID != old.ID || current.Name != old.Name || current.Enabled != old.Enabled || current.Revision != old.Revision+1 || current.ReleaseID != release.ID || !slices.Equal(current.Grants, grants) {
			return errors.New("upgraded instance identity, version, revision, or grants differ from the expected state")
		}
		after, err := w.service.Export(ctx, w.id)
		if err != nil {
			return err
		}
		if err = verifyPreserved(before, after); err != nil {
			return err
		}
		fmt.Fprintf(out, "ok %s -> %s: saved fields, record revisions, %d attachments and %d grants verified\n", pkg.Version, release.Package.Version, len(after.Attachments), len(grants))
		if err = w.runSteps(release.Package, fixture.After, len(fixture.Before), out); err != nil {
			return fmt.Errorf("after upgrade: %w", err)
		}
		return nil
	})
}

func verifyPreserved(before, after miniapps.Backup) error {
	if !reflect.DeepEqual(before.Attachments, after.Attachments) {
		return errors.New("upgrade changed stored attachments")
	}
	for collection, oldRows := range before.Collections {
		rows, ok := after.Collections[collection]
		if !ok || len(rows) != len(oldRows) {
			return fmt.Errorf("upgrade changed the record count in %s", collection)
		}
		byID := make(map[string]miniapps.Record, len(rows))
		for _, r := range rows {
			byID[r.ID] = r
		}
		for _, old := range oldRows {
			r, ok := byID[old.ID]
			if !ok {
				return fmt.Errorf("upgrade lost a record in %s", collection)
			}
			for key, val := range old.Fields {
				if got, ok := r.Fields[key]; !ok || !reflect.DeepEqual(got, val) {
					return fmt.Errorf("upgrade changed previously saved %s.%s", collection, key)
				}
			}
			unchanged := maps.Equal(old.Fields, r.Fields)
			if unchanged && r.Revision != old.Revision || !unchanged && r.Revision <= old.Revision {
				return fmt.Errorf("incorrect migrated record revision in %s", collection)
			}
		}
	}
	return nil
}
