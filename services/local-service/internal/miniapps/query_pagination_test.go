package miniapps

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"os"
	"reflect"
	"testing"
	"time"
)

func TestQueryContinuationAndAttachmentAcrossPages(t *testing.T) {
	db, service := storeAt(t, ":memory:")
	defer db.Close()
	raw, err := os.ReadFile("../appcatalog/packages/japanese-review-book.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := Validate(raw)
	if err != nil {
		t.Fatal(err)
	}
	capped := pkg.Actions["review.listAll"]
	capped.Limit = 2
	pkg.Actions["review.firstTwo"] = capped
	raw, err = json.Marshal(pkg)
	if err != nil {
		t.Fatal(err)
	}
	release, err := service.Install(t.Context(), raw, "builtin")
	if err != nil {
		t.Fatal(err)
	}
	book, err := service.Create(t.Context(), CreateRequest{ReleaseID: release.ID, Name: "Large book", Grants: pkg.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	write := Invocation{Action: "review.addQuestions", Surface: "page", OperationID: "more-questions"}
	for i := range 48 {
		write.Items = append(write.Items, map[string]any{"question": fmt.Sprintf("Card %d", i), "answer": "Answer"})
	}
	write.Confirm = call(t, service, book.ID, write).Confirmation
	added := call(t, service, book.ID, write).Records

	readAll := read("review.listAll")
	first := call(t, service, book.ID, readAll)
	if len(first.Records) != 50 || first.NextCursor == "" {
		t.Fatalf("first page: %d records, cursor %q", len(first.Records), first.NextCursor)
	}
	readAll.Cursor = first.NextCursor
	var refs []RecordRef
	for _, surface := range []string{"page", "chat", "panel"} {
		readAll.Surface = surface
		last := call(t, service, book.ID, readAll)
		// All cards have the same sort value. The 51st card was created last.
		if len(last.Records) != 1 || last.Records[0].ID != added[47].ID || last.NextCursor != "" {
			t.Fatalf("wrong final page on %s: %+v", surface, last)
		}
		refs = []RecordRef{{ID: first.Records[0].ID, Revision: first.Records[0].Revision}, {ID: added[47].ID, Revision: added[47].Revision}}
		attached, err := service.Attach(t.Context(), book.ID, AttachmentRequest{Action: readAll.Action, Surface: surface, Records: refs})
		if err != nil || len(attached.Records) != 2 || attached.Records[1].ID != added[47].ID {
			t.Fatalf("cross-page selection on %s: %+v, %v", surface, attached, err)
		}
	}
	capResult := call(t, service, book.ID, read("review.firstTwo"))
	if len(capResult.Records) != 2 || capResult.NextCursor != "" {
		t.Fatalf("explicit limit no longer caps the complete result: %+v", capResult)
	}
	if _, err := service.Attach(t.Context(), book.ID, AttachmentRequest{Action: "review.firstTwo", Surface: "chat", Records: refs}); !errors.Is(err, ErrConflict) {
		t.Fatalf("attachment exceeded the query limit: %v", err)
	}
	study := Invocation{Action: "review.markLearned", Surface: "chat", OperationID: "learned", Records: refs[:1]}
	study.Confirm = call(t, service, book.ID, study).Confirmation
	call(t, service, book.ID, study)
	if _, err := service.Invoke(t.Context(), book.ID, readAll); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed order should invalidate old continuation: %v", err)
	}
}

func TestSQLiteQueryMatchesTypedOrderingPredicatesAndLimits(t *testing.T) {
	db, _ := storeAt(t, ":memory:")
	defer db.Close()
	now := time.Now()
	err := db.MiniAppTransaction(t.Context(), func(tx *persistence.MiniAppStore) error {
		if err := tx.AddRelease(persistence.AppRelease{ID: "r", Manifest: []byte("{}")}); err != nil {
			return err
		}
		if err := tx.SaveInstance(persistence.AppInstance{ID: "i", ReleaseID: "r", Grants: []byte("[]")}); err != nil {
			return err
		}
		rows := []Record{
			{ID: "a", Revision: 1, Fields: map[string]any{"text": "a", "number": 1.0, "bool": false, "date": "2026-11-26"}},
			{ID: "b", Revision: 2, Fields: map[string]any{"text": "\u65e5", "number": 2.0, "bool": true, "date": "2026-11-27"}},
			{ID: "c", Revision: 3, Fields: map[string]any{"text": "\u65e5", "number": 2.0, "bool": true, "date": "2026-11-28"}},
		}
		for _, row := range rows {
			if err := saveRecord(tx, "i", "items", row); err != nil {
				return err
			}
		}
		for field, value := range map[string]any{"text": "\u65e5", "number": 2.0, "bool": true, "date": "2026-11-27", "$id": "b"} {
			for _, op := range []string{"eq", "ne", "lt", "lte", "gt", "gte"} {
				for _, order := range []string{"", "number", "text", "bool", "date"} {
					for _, limit := range []int{0, 1, 3} {
						action := Action{Op: "query", Collection: "items", Where: []Predicate{{Field: field, Op: op, Value: value}}, OrderBy: order, Limit: limit}
						got, err := actionRecords(tx, "i", action, nil, now)
						if err != nil {
							return err
						}
						want := queryRecords(rows, action, nil, now)
						if !reflect.DeepEqual(got, want) {
							t.Fatalf("%s %s order=%s limit=%d got=%v want=%v", field, op, order, limit, got, want)
						}
					}
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
