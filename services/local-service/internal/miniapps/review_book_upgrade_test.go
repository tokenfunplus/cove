package miniapps

import (
	"encoding/json"
	"errors"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestReviewBookUpgradeAndPractice(t *testing.T) {
	db, s := storeAt(t, filepath.Join(t.TempDir(), "review.sqlite"))
	defer db.Close()
	install := func(file string) Release {
		raw, err := os.ReadFile("../appcatalog/packages/" + file + ".coveapp")
		if err != nil {
			t.Fatal(err)
		}
		r, err := s.Install(t.Context(), raw, "builtin")
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	old := install("japanese-review-book")
	book, err := s.Create(t.Context(), CreateRequest{ReleaseID: old.ID, Name: "Learning", Grants: old.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	write := func(action, key string, inputs map[string]any, r *Record) Record {
		t.Helper()
		req := Invocation{Action: action, OperationID: key, Surface: "chat", Inputs: inputs}
		if r != nil {
			req.Records = []RecordRef{{ID: r.ID, Revision: r.Revision}}
		}
		preview := call(t, s, book.ID, req)
		if preview.Confirmation == "" {
			t.Fatal("missing preview")
		}
		req.Confirm = preview.Confirmation
		committed := call(t, s, book.ID, req)
		replayed := call(t, s, book.ID, req)
		if replayed.Records[0].ID != committed.Records[0].ID {
			t.Fatal("receipt mismatch")
		}
		return committed.Records[0]
	}
	find := func(action string, inputs map[string]any) []Record {
		t.Helper()
		return call(t, s, book.ID, Invocation{Action: action, OperationID: "query", Surface: "chat", Inputs: inputs}).Records
	}
	original := write("review.addQuestions", "first", map[string]any{"question": "Original?", "answer": "Old"}, nil)
	latest := install("japanese-review-book-1.1")
	upgraded, err := s.Upgrade(t.Context(), book.ID, UpgradeRequest{ReleaseID: latest.ID, Grants: book.Grants, Revision: book.Revision})
	if err != nil || upgraded.ID != book.ID {
		t.Fatalf("upgrade: %v", err)
	}
	rows := find("review.listDue", nil)
	var row Record
	for _, r := range rows {
		if r.ID == original.ID {
			row = r
		}
	}
	if row.Fields["question"] != "Original?" || row.Fields["answer"] != "Old" || row.Fields["archived"] != false {
		t.Fatal("missing original card", row)
	}
	if n := len(find("review.listDue", map[string]any{"date": "2026-02-27", "limit": float64(2)})); n != 0 {
		t.Fatal(n)
	}
	if n := len(find("review.listDue", map[string]any{"date": "2026-02-28", "limit": float64(2)})); n != 2 {
		t.Fatal(n)
	}
	beforeDelete := Invocation{Action: "review.delete", Surface: "chat", OperationID: "bad-delete", Records: []RecordRef{{row.ID, row.Revision}}}
	if _, err = s.Invoke(t.Context(), book.ID, beforeDelete); !errors.Is(err, ErrConflict) {
		t.Fatalf("active delete: %v", err)
	}
	row = write("review.edit", "fix", map[string]any{"question": "Correct?", "answer": "Yes"}, &row)
	row = write("review.archive", "archive", nil, &row)
	if n := len(find("review.listDue", nil)); n != 3 {
		t.Fatal(n)
	}
	if archived := find("review.listArchived", nil); len(archived) != 1 || !maps.Equal(archived[0].Fields, row.Fields) {
		t.Fatal(archived)
	}
	row = write("review.restore", "restore", nil, &row)
	if n := len(find("review.listArchived", nil)); n != 0 {
		t.Fatal(n)
	}
	row = write("review.archive", "archive-again", nil, &row)
	stale := beforeDelete
	stale.Records = []RecordRef{{row.ID, row.Revision - 1}}
	if _, err = s.Invoke(t.Context(), book.ID, stale); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	deleted := write("review.delete", "delete", nil, &row)
	if len(deleted.Fields) != 0 || deleted.ID != row.ID {
		t.Fatal("deleted record payload retained")
	}
	if err := db.MiniAppTransaction(t.Context(), func(tx *persistence.MiniAppStore) error {
		for _, key := range []string{"first", "fix", "archive", "restore", "archive-again"} {
			fingerprint, data, err := tx.Invocation(book.ID, key)
			if err != nil || fingerprint == "" || len(data) != 0 {
				t.Fatalf("deleted data retained in %s receipt", key)
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if n := len(find("review.listArchived", nil)); n != 0 {
		t.Fatal(n)
	}
	gen := Invocation{Action: "review.suggestQuestions", OperationID: "generate", Surface: "page", Inputs: map[string]any{"passage": "Some text", "source": "private-record-id", "count": float64(2)}}
	out := call(t, s, book.ID, gen)
	if strings.Contains(out.Prompt, "private-record-id") || !strings.Contains(out.Prompt, `"count":2`) {
		t.Fatal("wrong model context")
	}
	gen.Inputs["count"] = float64(9)
	if _, err := s.Invoke(t.Context(), book.ID, gen); !errors.Is(err, ErrInvalid) {
		t.Fatal("out-of-range count")
	}
	source := write("material.save", "save-material", map[string]any{"title": "Lesson", "passage": "First."}, nil)
	source = write("material.edit", "edit-material", map[string]any{"title": "Lesson", "passage": "Revised."}, &source)
	if got := find("material.byId", map[string]any{"id": source.ID}); len(got) != 1 || got[0].Fields["passage"] != "Revised." {
		t.Fatal(got)
	}
	other, err := s.Create(t.Context(), CreateRequest{Name: "Second book", ReleaseID: latest.ID, Grants: latest.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	lookup := Invocation{Action: "material.byId", OperationID: "source", Surface: "page", Inputs: map[string]any{"id": source.ID}}
	if got := call(t, s, other.ID, lookup); len(got.Records) != 0 {
		t.Fatal("source lookup crossed instance boundary")
	}

}

func TestConfirmedWriteUsesReviewedDayAndCanRetryAfterConflict(t *testing.T) {
	db, s := storeAt(t, filepath.Join(t.TempDir(), "review.sqlite"))
	defer db.Close()
	_, i := setup(t, s)
	row := call(t, s, i.ID, read("inbox.queue")).Records[0]
	req := Invocation{Action: "inbox.defer", OperationID: "day-boundary", Surface: "chat", Records: []RecordRef{{row.ID, row.Revision}}}
	preview := call(t, s, i.ID, req)
	tomorrow := s.now().AddDate(0, 0, 1)
	s.now = func() time.Time { return tomorrow }
	req.Confirm = tomorrow.Format(time.DateOnly) + preview.Confirmation[len(time.DateOnly):]
	if _, err := s.Invoke(t.Context(), i.ID, req); !errors.Is(err, ErrConflict) {
		t.Fatal("tampered day accepted")
	}
	req.Confirm = preview.Confirmation
	committed := call(t, s, i.ID, req)
	if !maps.Equal(committed.Records[0].Fields, preview.Records[0].Fields) {
		t.Fatal("confirmation recalculated relative dates after midnight")
	}
	if replay := call(t, s, i.ID, req); replay.Records[0].Revision != committed.Records[0].Revision {
		t.Fatal("duplicate commit")
	}
	current := committed.Records[0]
	req = Invocation{Action: "inbox.defer", OperationID: "conflict-retry", Surface: "chat", Records: []RecordRef{{current.ID, current.Revision}}}
	stale := call(t, s, i.ID, req)
	concurrent := req
	concurrent.OperationID = "concurrent"
	concurrent.Confirm = call(t, s, i.ID, concurrent).Confirmation
	latest := call(t, s, i.ID, concurrent).Records[0]
	req.Confirm = stale.Confirmation
	if _, err := s.Invoke(t.Context(), i.ID, req); !errors.Is(err, ErrConflict) {
		t.Fatal("stale commit accepted")
	}
	req.Confirm = ""
	req.Records = []RecordRef{{latest.ID, latest.Revision}}
	req.Confirm = call(t, s, i.ID, req).Confirmation
	if got := call(t, s, i.ID, req); got.Records[0].Revision != latest.Revision+1 {
		t.Fatal("conflict poisoned operation ID")
	}
}

func TestReviewBookRequiresDeclaredRuntimeAndConsistentOutput(t *testing.T) {
	source, err := os.ReadFile("../appcatalog/packages/japanese-review-book-1.1.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		change func(*Package)
	}{
		{"no minimum runtime", func(p *Package) { p.MinHostVersion = "" }},
		{"older minimum runtime", func(p *Package) { p.MinHostVersion = "1.0.9" }},
		{"unsupported runtime", func(p *Package) { p.MinHostVersion = "2.0.0" }},
		{"invented result field", func(p *Package) { p.Actions["review.listDue"].OutputSchema.Fields["unexpected"] = "text" }},
		{"unknown source query", func(p *Package) {
			links := p.Collections["questions"].Links
			link := links["source"]
			link.Query = "material.save"
			links["source"] = link
		}},
		{"wrong bound field type", func(p *Package) { p.Actions["review.suggestQuestions"].CandidateBindings["source"] = "count" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, err := Validate(source)
			if err != nil {
				t.Fatal(err)
			}
			tc.change(&p)
			raw, err := json.Marshal(p)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := Validate(raw); !errors.Is(err, ErrInvalid) {
				t.Fatal("invalid feature declaration accepted", err)
			}
		})
	}
}
