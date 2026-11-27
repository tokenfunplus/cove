package miniapps

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

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
