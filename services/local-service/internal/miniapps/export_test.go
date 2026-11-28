package miniapps

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestRestoreAcrossDistributionChannels(t *testing.T) {
	for _, tc := range []struct {
		from, to    string
		changeBytes bool
		wantRestore bool
	}{
		{"builtin", "catalog", false, false},
		{"catalog", "builtin", false, false},
		{"official-catalog:" + strings.Repeat("a", 64), "builtin", false, true},
		{"builtin", "official-catalog:" + strings.Repeat("a", 64), false, true},
		{"builtin", "catalog:" + strings.Repeat("a", 64), false, false},
		{"official-catalog:" + strings.Repeat("a", 64), "catalog:" + strings.Repeat("a", 64), false, true},
		{"catalog:" + strings.Repeat("a", 64), "official-catalog:" + strings.Repeat("a", 64), false, true},
		{"official-catalog:" + strings.Repeat("a", 64), "catalog:" + strings.Repeat("b", 64), false, false},
		{"catalog", "catalog:" + strings.Repeat("a", 64), false, false},
		{"catalog", "catalog:" + strings.Repeat("a", 64), true, false},
		{"builtin", "catalog", true, false},
		{"local", "catalog", false, false},
		{"local", "builtin", false, false},
		{"local", "builtin", true, false},
		{"catalog", "local", false, false},
	} {
		t.Run(tc.from+"-to-"+tc.to, func(t *testing.T) {
			ctx := t.Context()
			srcDB, source := storeAt(t, ":memory:")
			defer srcDB.Close()
			dstDB, destination := storeAt(t, ":memory:")
			defer dstDB.Close()
			data := example(t)
			original, err := source.Install(ctx, data, tc.from)
			if err != nil {
				t.Fatal(err)
			}
			book, err := source.Create(ctx, CreateRequest{ReleaseID: original.ID, Name: "Personal copy", Grants: original.Package.Capabilities})
			if err != nil {
				t.Fatal(err)
			}
			export, err := source.Export(ctx, book.ID)
			if err != nil {
				t.Fatal(err)
			}
			backup, err := json.Marshal(export)
			if err != nil {
				t.Fatal(err)
			}
			if tc.changeBytes {
				data = append(data, '\n')
			}
			installed, err := destination.Install(ctx, data, tc.to)
			if err != nil {
				t.Fatal(err)
			}
			got, err := destination.Restore(ctx, backup)
			if !tc.wantRestore {
				if !errors.Is(err, ErrBackupRelease) {
					t.Fatalf("expected missing release, got %v", err)
				}
				return
			}
			expectedID := installed.ID
			if err != nil || got.ReleaseID != expectedID || got.Enabled || len(got.Grants) != 0 {
				t.Fatalf("unexpected restore: %+v, %v", got, err)
			}
			restored, err := destination.Export(ctx, got.ID)
			if err != nil || !reflect.DeepEqual(restored.Collections, export.Collections) {
				t.Fatalf("restored records differ: %v", err)
			}
		})
	}
}

func TestRestorePreservesRecordsInSeparateDisabledInstance(t *testing.T) {
	db, s := storeAt(t, ":memory:")
	defer db.Close()
	ctx := t.Context()
	_, i := setup(t, s)
	write := Invocation{Action: "inbox.add", Surface: "page", OperationID: "new-note", Inputs: map[string]any{"title": "$today", "note": "$input.text"}}
	write.Confirm = call(t, s, i.ID, write).Confirmation
	call(t, s, i.ID, write)
	source, err := s.Export(ctx, i.ID)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(source)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := s.Restore(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	if restored.ID == i.ID || restored.Enabled || len(restored.Grants) != 0 || restored.ReleaseID != i.ReleaseID {
		t.Fatalf("unexpected restore: %+v", restored)
	}
	if _, err = s.Invoke(ctx, restored.ID, read("inbox.all")); !errors.Is(err, ErrDenied) {
		t.Fatalf("restored without new grants: %v", err)
	}
	again, err := s.Export(ctx, restored.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(source, again) {
		t.Fatal("restored records or release metadata differ")
	}
}

func TestRestoreRejectsIncompatibleOrMalformedDataAtomically(t *testing.T) {
	db, s := storeAt(t, ":memory:")
	defer db.Close()
	ctx := t.Context()
	_, i := setup(t, s)
	for name, mutation := range map[string]func(*Backup){
		"unknown version":    func(b *Backup) { b.Version = "2.0.0" },
		"digest mismatch":    func(b *Backup) { b.Digest = string(make([]byte, 64)) },
		"wrong type":         func(b *Backup) { b.Collections["items"][0].Fields["title"] = false },
		"extra field":        func(b *Backup) { b.Collections["items"][0].Fields["extra"] = "value" },
		"duplicate ID":       func(b *Backup) { b.Collections["items"] = append(b.Collections["items"], b.Collections["items"][0]) },
		"missing collection": func(b *Backup) { delete(b.Collections, "items") },
	} {
		t.Run(name, func(t *testing.T) {
			snapshot, err := s.Export(ctx, i.ID)
			if err != nil {
				t.Fatal(err)
			}
			mutation(&snapshot)
			raw, err := json.Marshal(snapshot)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = s.Restore(ctx, raw); err == nil {
				t.Fatal("restored invalid data")
			}
			instances, err := s.Instances(ctx)
			if err != nil || len(instances) != 1 {
				t.Fatalf("partial instance persisted: %v, %v", instances, err)
			}
		})
	}
}
