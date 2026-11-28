package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
)

const packageDir = "../../internal/appcatalog/testdata/legacy-releases"
const fixturesDir = "../../../../packages/api-contract/fixtures/mini-apps"

func TestValidateStandardInput(t *testing.T) {
	for _, tc := range []struct {
		name    string
		source  []byte
		wantErr string
	}{
		{name: "valid package", source: starter},
		{name: "oversized input", source: bytes.Repeat([]byte(" "), (2<<20)+1), wantErr: "input exceeds 2 MiB"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input, err := os.CreateTemp(t.TempDir(), "stdin-")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { input.Close() })
			if _, err = input.Write(tc.source); err != nil {
				t.Fatal(err)
			}
			if _, err = input.Seek(0, io.SeekStart); err != nil {
				t.Fatal(err)
			}
			previous := os.Stdin
			os.Stdin = input
			t.Cleanup(func() { os.Stdin = previous })
			var output bytes.Buffer
			err = run([]string{"validate", "-"}, &output)
			if tc.wantErr != "" {
				if err == nil || err.Error() != tc.wantErr {
					t.Fatalf("got %v, want %q", err, tc.wantErr)
				}
			} else if err != nil || !strings.Contains(output.String(), "is valid") {
				t.Fatalf("standard input validation: %v; output %q", err, output.String())
			}
			if _, err = input.Stat(); err != nil {
				t.Fatalf("validation closed standard input: %v", err)
			}
		})
	}
}

func TestAuthorBuildAndPack(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.json")
	app := filepath.Join(dir, "personal-notes.coveapp")
	for _, args := range [][]string{
		{"init", "my-studio", "notes", src},
		{"validate", src}, {"preview", src}, {"pack", src, app},
	} {
		if err := run(args, io.Discard); err != nil {
			t.Fatalf("%v: %v", args, err)
		}
	}
	if err := run([]string{"init", "my-studio", "notes", src}, io.Discard); err == nil {
		t.Fatal("overwrote an existing file")
	}
	raw, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	packed, err := os.ReadFile(app)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(raw, packed) {
		t.Fatal("pack changed release bytes")
	}
	if _, err := miniapps.Preview(packed, "local"); err != nil {
		t.Fatalf("personal artifact cannot be imported: %v", err)
	}
	if err := run([]string{"init", "cove", "notes", filepath.Join(dir, "bad.json")}, io.Discard); err == nil {
		t.Fatal("created a personal package with a reserved publisher")
	}
}

func TestReferenceScenarios(t *testing.T) {
	for _, slug := range []string{"japanese-review-book", "reading-inbox"} {
		t.Run(slug, func(t *testing.T) {
			src := filepath.Join(packageDir, slug+".coveapp")
			if err := run([]string{"test", src, filepath.Join(fixturesDir, slug+".json")}, io.Discard); err != nil {
				t.Fatal(err)
			}
			var out bytes.Buffer
			if err := run([]string{"preview", src}, &out); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(out.String(), "[home]") {
				t.Fatalf("no home page in preview: %s", out.String())
			}
		})
	}
}

func TestAuthorCanEvolveReadingInbox(t *testing.T) {
	ctx := context.Background()
	source, err := os.ReadFile(filepath.Join(packageDir, "reading-inbox.coveapp"))
	if err != nil {
		t.Fatal(err)
	}
	source = bytes.Replace(source, []byte(`"bookshelf"`), []byte(`"independent-studio"`), 1)
	err = inPreview(source, func(w workspace, pkg miniapps.Package) error {
		result, err := w.step(pkg, scenarioStep{Action: "inbox.add", Inputs: map[string]any{"title": "New issue", "note": "Read tomorrow."}}, nil, 1)
		if err != nil {
			return err
		}
		row := result.Records[0]
		pkg.Version = "1.1.0"
		pkg.SchemaVersion++
		pkg.Collections["items"].Fields["starred"] = "bool"
		pkg.Actions["inbox.add"].Values["starred"] = false
		pkg.Actions["inbox.defer"].Values["revisit"] = "$today+1"
		for _, item := range pkg.Seed["items"] {
			item["starred"] = false
		}
		pkg.Migrations = []miniapps.Migration{{From: 1, To: 2, Defaults: map[string]map[string]any{"items": {"starred": false}}}}
		next, err := json.Marshal(pkg)
		if err != nil {
			return err
		}
		release, err := installAuthorPackage(ctx, w.service, next)
		if err != nil {
			return err
		}
		instance, err := w.service.Instance(ctx, w.id)
		if err != nil {
			return err
		}
		if _, err = w.service.Upgrade(ctx, w.id, miniapps.UpgradeRequest{ReleaseID: release.ID, Revision: instance.Revision, Grants: instance.Grants}); err != nil {
			return err
		}
		all, err := w.step(pkg, scenarioStep{Action: "inbox.all"}, nil, 2)
		if err != nil {
			return err
		}
		for _, item := range all.Records {
			if item.ID != row.ID {
				continue
			}
			if item.Fields["title"] != "New issue" || item.Fields["starred"] != false {
				t.Fatalf("upgrade lost the user record: %v", item)
			}
			// Use the upgraded rule and check its date against an independent action using today's date.
			deferResult, err := w.step(pkg, scenarioStep{Action: "inbox.defer", Select: []int{0}}, []miniapps.Record{item}, 3)
			if err != nil {
				return err
			}
			start, err := time.Parse(time.DateOnly, row.Fields["revisit"].(string))
			if err != nil {
				return err
			}
			if got := deferResult.Records[0].Fields["revisit"]; got != start.AddDate(0, 0, 1).Format(time.DateOnly) {
				t.Fatalf("upgraded defer rule gave %v", got)
			}
			return nil
		}
		t.Fatal("user record is missing after upgrade")
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestScaffoldRejectsKnownBundledPublishers(t *testing.T) {
	for _, publisher := range []string{"cove", "bookshelf"} {
		if err := run([]string{"init", publisher, "my-notes", filepath.Join(t.TempDir(), "app.json")}, io.Discard); err == nil {
			t.Fatal("accepted reserved publisher", publisher)
		}
	}
}
