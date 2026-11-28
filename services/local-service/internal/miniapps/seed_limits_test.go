package miniapps

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestSeedRecordSizeMatchesInstanceCreation(t *testing.T) {
	for _, test := range []struct {
		name      string
		edit      func(map[string]any)
		wantValid bool
	}{
		{"combined text fields exceed record limit", func(row map[string]any) {
			row["title"], row["note"] = strings.Repeat("x", 60000), strings.Repeat("y", 40000)
		}, false},
		{"encoded escapes exceed record limit", func(row map[string]any) {
			row["title"], row["note"] = strings.Repeat("<", 10000), strings.Repeat("<", 10000)
		}, false},
		{"resolved date at record limit", func(row map[string]any) { seedSizeBoundary(t, row, 0) }, true},
		{"resolved date exceeds record limit", func(row map[string]any) { seedSizeBoundary(t, row, 1) }, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			pkg, err := Validate(example(t))
			if err != nil {
				t.Fatal(err)
			}
			pkg.Publisher = "seed-limit-author"
			test.edit(pkg.Seed["items"][0])
			raw, err := json.Marshal(pkg)
			if err != nil {
				t.Fatal(err)
			}
			_, err = Validate(raw)
			if !test.wantValid {
				if !errors.Is(err, ErrInvalid) {
					t.Fatal("oversized seed was accepted", err)
				}
				return
			}
			if err != nil {
				t.Fatal("valid seed was rejected", err)
			}
			db, service := storeAt(t, ":memory:")
			t.Cleanup(func() { _ = db.Close() })
			release, err := service.Install(t.Context(), raw, "local")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := service.Create(t.Context(), CreateRequest{ReleaseID: release.ID, Name: "Boundary fixture", Grants: release.Package.Capabilities}); err != nil {
				t.Fatal("validated seed could not create an instance", err)
			}
		})
	}
}

func seedSizeBoundary(t *testing.T, row map[string]any, extra int) {
	t.Helper()
	row["title"], row["note"], row["revisit"] = strings.Repeat("x", maxTextBytes), "", "2026-02-28"
	encoded, err := json.Marshal(row)
	if err != nil {
		t.Fatal(err)
	}
	row["note"] = strings.Repeat("y", maxRecordBytes-len(encoded)+extra)
	row["revisit"] = "$today"
}
