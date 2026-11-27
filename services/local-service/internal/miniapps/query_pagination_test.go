package miniapps

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
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
