package miniapps

import (
	"errors"
	"os"
	"reflect"
	"testing"
)

func TestCandidatesDetectSavedAndRepeatedContentIncludingArchive(t *testing.T) {
	db, service := storeAt(t, ":memory:")
	defer db.Close()
	raw, err := os.ReadFile("../appcatalog/testdata/legacy-releases/japanese-review-book-1.1.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	release, err := service.Install(t.Context(), raw, "builtin")
	if err != nil {
		t.Fatal(err)
	}
	book, err := service.Create(t.Context(), CreateRequest{ReleaseID: release.ID, Name: "Duplicates", Grants: release.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	saved := call(t, service, book.ID, read("review.listAll")).Records[0]
	write := Invocation{Action: "review.archive", Surface: "page", OperationID: "archive", Inputs: map[string]any{}, Records: []RecordRef{{ID: saved.ID, Revision: saved.Revision}}}
	write.Confirm = call(t, service, book.ID, write).Confirmation
	call(t, service, book.ID, write)
	archived := call(t, service, book.ID, read("review.listArchived")).Records
	if len(archived) != 1 || archived[0].ID != saved.ID || archived[0].Fields["archived"] != true {
		t.Fatal("duplicate fixture was not archived", archived)
	}
	req := CandidateCheckRequest{ExpectedRevision: book.Revision, Action: "review.suggestQuestions", Surface: "page", Items: []map[string]any{
		{"question": saved.Fields["question"], "answer": saved.Fields["answer"]},
		{"question": "New question", "answer": "A new answer"},
		{"question": "New   question", "answer": "A new answer"},
	}}
	duplicates, err := service.CandidateDuplicates(t.Context(), book.ID, req)
	if err != nil || !reflect.DeepEqual(duplicates, []int{0, 2}) {
		t.Fatal(duplicates, err)
	}
	req.ExpectedRevision++
	if _, err := service.CandidateDuplicates(t.Context(), book.ID, req); !errors.Is(err, ErrConflict) {
		t.Fatal("accepted stale instance", err)
	}
	updated, err := service.Configure(t.Context(), book.ID, ConfigRequest{Revision: book.Revision, Enabled: true, Grants: []string{"records.commit"}})
	if err != nil {
		t.Fatal(err)
	}
	req.ExpectedRevision = updated.Revision
	if _, err := service.CandidateDuplicates(t.Context(), book.ID, req); !errors.Is(err, ErrDenied) {
		t.Fatal("inspected records after read access was revoked", err)
	}
}

func TestCandidateValidationIsPerItemAndDoesNotHideValidResults(t *testing.T) {
	db, service := storeAt(t, ":memory:")
	defer db.Close()
	raw, _ := os.ReadFile("../appcatalog/testdata/legacy-releases/japanese-review-book-1.1.coveapp")
	release, err := service.Install(t.Context(), raw, "builtin")
	if err != nil {
		t.Fatal(err)
	}
	book, err := service.Create(t.Context(), CreateRequest{ReleaseID: release.ID, Name: "Mixed candidates", Grants: release.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.CheckCandidates(t.Context(), book.ID, CandidateCheckRequest{ExpectedRevision: book.Revision, Action: "review.suggestQuestions", Surface: "page", Items: []map[string]any{
		{"question": "Valid question", "answer": "Valid answer"},
		{"question": "Missing answer"},
		{"question": "Valid question", "answer": "Valid answer"},
	}})
	if err != nil || !reflect.DeepEqual(result.Duplicates, []int{2}) || len(result.Invalid) != 1 || result.Invalid[0].Index != 1 || result.Invalid[0].Message == "" {
		t.Fatal(result, err)
	}
}
