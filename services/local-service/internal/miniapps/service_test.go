package miniapps

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func example(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile("../appcatalog/packages/reading-inbox.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func storeAt(t *testing.T, path string) (*persistence.SQLiteStore, *Service) {
	t.Helper()
	db, err := persistence.OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	s := New(db)
	s.now = func() time.Time { return time.Date(2026, 2, 28, 23, 30, 0, 0, time.FixedZone("Local", 8*3600)) }
	return db, s
}
func setup(t *testing.T, s *Service) (Release, Instance) {
	t.Helper()
	ctx := t.Context()
	r, err := s.Install(ctx, example(t), "local")
	if err != nil {
		t.Fatal(err)
	}
	i, err := s.Create(ctx, CreateRequest{ReleaseID: r.ID, Name: "My reading", Grants: r.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	return r, i
}
func call(t *testing.T, s *Service, id string, req Invocation) Result {
	t.Helper()
	result, err := s.Invoke(t.Context(), id, req)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func read(action string) Invocation {
	return Invocation{Action: action, Surface: "page", OperationID: "inspect"}
}

func TestTwoInstancesPreviewReplayAndStaleWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cove.sqlite")
	db, s := storeAt(t, path)
	_, a := setup(t, s)
	_, b := setup(t, s)
	row := call(t, s, a.ID, read("inbox.queue")).Records[0]
	write := Invocation{Action: "inbox.defer", OperationID: "defer-1", Surface: "chat", Records: []RecordRef{{ID: row.ID, Revision: row.Revision}}}
	preview := call(t, s, a.ID, write)
	if preview.Confirmation == "" || preview.Records[0].Fields["revisit"] != "2026-03-03" {
		t.Fatal(preview)
	}
	if len(call(t, s, a.ID, read("inbox.queue")).Records) != 1 {
		t.Fatal("preview changed storage")
	}
	write.Confirm = preview.Confirmation
	wrong := write
	wrong.Surface = "panel"
	if _, err := s.Invoke(t.Context(), a.ID, wrong); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if _, err := s.Invoke(t.Context(), b.ID, write); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			result, err := s.Invoke(t.Context(), a.ID, write)
			if err != nil || result.Records[0].Revision != 2 {
				t.Errorf("duplicate commit: %v", err)
			}
		})
	}
	wg.Wait()
	if len(call(t, s, a.ID, read("inbox.queue")).Records) != 0 || len(call(t, s, b.ID, read("inbox.queue")).Records) != 1 {
		t.Fatal("query or isolation failed")
	}
	db.Close()
	db, s = storeAt(t, path)
	defer db.Close()
	call(t, s, a.ID, write) // accepted operations replay across restarts
	stale := write
	stale.Confirm = ""
	stale.OperationID = "another-operation"
	if _, err := s.Invoke(t.Context(), a.ID, stale); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if err := db.ClearChatData(t.Context()); err != nil {
		t.Fatal(err)
	}
	if len(call(t, s, b.ID, read("inbox.queue")).Records) != 1 {
		t.Fatal("clearing chat removed independent records")
	}
}

func TestGrantRechecksAndReplayFingerprint(t *testing.T) {
	ctx := t.Context()
	db, s := storeAt(t, ":memory:")
	defer db.Close()
	r, i := setup(t, s)
	create := Invocation{Action: "inbox.add", Surface: "panel", OperationID: "create", Inputs: map[string]any{"title": "Second item", "note": "Body"}}
	preview := call(t, s, i.ID, create)
	create.Confirm = preview.Confirmation
	tampered := create
	tampered.Inputs = map[string]any{"title": "Different", "note": "Body"}
	if _, err := s.Invoke(ctx, i.ID, tampered); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	i, err := s.Configure(ctx, i.ID, ConfigRequest{Revision: i.Revision, Enabled: true, Grants: []string{"records.query"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Invoke(ctx, i.ID, create); !errors.Is(err, ErrDenied) {
		t.Fatal(err)
	}
	i, err = s.Configure(ctx, i.ID, ConfigRequest{Revision: i.Revision, Enabled: true, Grants: r.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Invoke(ctx, i.ID, create); !errors.Is(err, ErrConflict) {
		t.Fatal("regrant should invalidate pending approvals", err)
	}
	create.Confirm = ""
	create.Confirm = call(t, s, i.ID, create).Confirmation
	call(t, s, i.ID, create)
	create.Inputs["note"] = "Replacement"
	if _, err = s.Invoke(ctx, i.ID, create); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	i, err = s.Configure(ctx, i.ID, ConfigRequest{Revision: i.Revision, Enabled: false, Grants: r.Package.Capabilities})
	if err != nil || len(i.Grants) != 0 {
		t.Fatal(i, err)
	}
	if err = s.CheckCapability(ctx, i.ID, "chat.attach"); !errors.Is(err, ErrDenied) {
		t.Fatal(err)
	}
	if err = s.Delete(ctx, i.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Invoke(ctx, i.ID, read("inbox.all")); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}
func newRelease(t *testing.T, s *Service, p Package, origin string) Release {
	t.Helper()
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.Install(t.Context(), raw, origin)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestUpgradePreservesRecordsAndRejectsIncompatibleChanges(t *testing.T) {
	db, s := storeAt(t, ":memory:")
	defer db.Close()
	r, i := setup(t, s)
	// Personal edits to a bundled example retain their independent local origin.
	r.Package.Publisher = "personal-author"
	r.Package.Description += " Personal edition."
	r = newRelease(t, s, r.Package, "local")
	var err error
	i, err = s.Create(t.Context(), CreateRequest{ReleaseID: r.ID, Name: "Personal book", Grants: r.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	orig := call(t, s, i.ID, read("inbox.all")).Records[0]
	p := r.Package
	p.Version = "1.1.0"
	p.SchemaVersion++
	p.Collections["items"].Fields["priority"] = "number"
	add := p.Actions["inbox.add"]
	add.Values["priority"] = 2.0
	p.Seed["items"][0]["priority"] = 2.0
	p.Migrations = []Migration{{From: 1, To: 2, Defaults: map[string]map[string]any{"items": {"priority": 2.0}}}}
	next := newRelease(t, s, p, "local")
	request := UpgradeRequest{Revision: i.Revision, ReleaseID: next.ID, Grants: i.Grants}
	other := newRelease(t, s, p, "catalog")
	wrong := request
	wrong.ReleaseID = other.ID
	if _, err := s.Upgrade(t.Context(), i.ID, wrong); !errors.Is(err, ErrInvalid) {
		t.Fatal("origin changed", err)
	}
	updated, err := s.Upgrade(t.Context(), i.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	rows := call(t, s, i.ID, read("inbox.all")).Records
	if len(rows) != 1 || rows[0].ID != orig.ID || rows[0].Fields["priority"] != 2.0 || rows[0].Revision != 2 {
		t.Fatal(rows)
	}
	// A valid artifact lacking a migration for this particular installed version
	// must leave the old release, revision and values unchanged.
	p.Version = "2.0.0"
	p.SchemaVersion = 3
	p.Migrations = nil
	bad := newRelease(t, s, p, "local")
	request.Revision = updated.Revision
	request.ReleaseID = bad.ID
	if _, err = s.Upgrade(t.Context(), i.ID, request); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	current, err := s.Instance(t.Context(), i.ID)
	if err != nil || current.ReleaseID != next.ID || current.Revision != updated.Revision {
		t.Fatal(current, err)
	}
	if call(t, s, i.ID, read("inbox.all")).Records[0].ID != orig.ID {
		t.Fatal("record lost")
	}
}
func TestValidationAndOrigin(t *testing.T) {
	raw := example(t)
	base := string(raw)
	for _, broken := range []string{
		strings.Replace(base, `"format": 1`, `"format": 1,"format": 1`, 1),
		strings.Replace(base, `"format": 1`, `"format": 2`, 1),
		strings.Replace(base, `"op": "query"`, `"OP": "create", "op":"query"`, 1),
		strings.Replace(base, `"format": 1`, `"format": 1,"script":"example"`, 1),
		strings.Replace(base, `"op": "query"`, `"op": "script"`, 1),
		strings.Replace(base, `"$input.title"`, `"$input.missing"`, 1),
		strings.Replace(base, `"op": "lte"`, `"op": "arbitrary"`, 1),
		strings.Replace(base, `"op": "query"`, `"op": "query", "reveal_field": "missing_field"`, 1),
		strings.Replace(base, `"op": "create"`, `"op": "create", "reveal_field": "title"`, 1),
		base + "{}",
	} {
		if _, err := Validate([]byte(broken)); !errors.Is(err, ErrInvalid) {
			t.Fatal("invalid package accepted", err)
		}
	}
	if _, err := Preview([]byte(strings.Replace(base, `"bookshelf"`, `"cove"`, 1)), "local"); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	db, s := storeAt(t, ":memory:")
	defer db.Close()
	ctx := context.Background()
	r, err := s.Install(ctx, raw, "local")
	if err != nil {
		t.Fatal(err)
	}
	same, err := s.Install(ctx, raw, "local")
	if err != nil || same.ID != r.ID {
		t.Fatal(err)
	}
	if _, err = s.Install(ctx, append(raw, '\n'), "local"); !errors.Is(err, ErrConflict) {
		t.Fatal("release digest changed", err)
	}
}

func TestPerRecordRulesUseFrozenFieldsAndRejectInvalidTypes(t *testing.T) {
	db, s := storeAt(t, ":memory:")
	defer db.Close()
	p, err := Validate(example(t))
	if err != nil {
		t.Fatal(err)
	}
	fields := p.Collections["items"].Fields
	fields["attempts"] = "number"
	p.Seed["items"][0]["attempts"] = 0.0
	p.Actions["inbox.add"].Values["attempts"] = 0.0
	rules := p.Actions["inbox.defer"].Values
	rules["attempts"] = map[string]any{"add": []any{"$record.attempts", 1.0}}
	rules["revisit"] = map[string]any{"if": []any{map[string]any{"gte": []any{"$record.attempts", 1.0}}, "$today+1", "$today+3"}}
	r := newRelease(t, s, p, "local")
	i, err := s.Create(t.Context(), CreateRequest{ReleaseID: r.ID, Name: "Rule test", Grants: p.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	for index, want := range []string{"2026-03-03", "2026-03-01"} {
		row := call(t, s, i.ID, read("inbox.all")).Records[0]
		change := Invocation{Action: "inbox.defer", Surface: "chat", OperationID: []string{"first", "second"}[index], Records: []RecordRef{{ID: row.ID, Revision: row.Revision}}}
		change.Confirm = call(t, s, i.ID, change).Confirmation
		result := call(t, s, i.ID, change).Records[0]
		if result.Fields["attempts"] != float64(index+1) || result.Fields["revisit"] != want {
			t.Fatal(result)
		}
	}
	rules["attempts"] = map[string]any{"add": []any{"$record.title", 1.0}}
	raw, _ := json.Marshal(p)
	if _, err := Validate(raw); !errors.Is(err, ErrInvalid) {
		t.Fatal("text added to number", err)
	}
}

func TestCandidateBatchConfirmsAllOnce(t *testing.T) {
	db, s := storeAt(t, ":memory:")
	defer db.Close()
	_, instance := setup(t, s)
	items := []map[string]any{{"title": "First", "note": "One"}, {"title": "Second", "note": "Two"}}
	command := Invocation{Action: "inbox.add", Surface: "page", OperationID: "two-candidates", Inputs: map[string]any{}, Items: items}
	preview := call(t, s, instance.ID, command)
	if len(preview.Records) != 2 || preview.Records[0].ID == preview.Records[1].ID {
		t.Fatal("expected two proposed records")
	}
	command.Confirm = preview.Confirmation
	items[1]["note"] = false
	if _, err := s.Invoke(t.Context(), instance.ID, command); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	before := len(call(t, s, instance.ID, read("inbox.all")).Records)
	items[1]["note"] = "Two"
	call(t, s, instance.ID, command)
	call(t, s, instance.ID, command)
	if got := len(call(t, s, instance.ID, read("inbox.all")).Records); got != before+2 {
		t.Fatalf("unexpected batch result count %d", got)
	}
}

func TestSignedCatalogCanUpdateBundledIndependentPublisher(t *testing.T) {
	ctx := t.Context()
	db, s := storeAt(t, ":memory:")
	defer db.Close()
	r, err := s.Install(ctx, example(t), "builtin")
	if err != nil {
		t.Fatal(err)
	}
	i, err := s.Create(ctx, CreateRequest{ReleaseID: r.ID, Name: "My library", Grants: r.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	row := call(t, s, i.ID, read("inbox.queue")).Records[0]
	next := r.Package
	next.Version = "1.1.0"
	local := newRelease(t, s, next, "local")
	if _, err = s.Upgrade(ctx, i.ID, UpgradeRequest{Revision: i.Revision, ReleaseID: local.ID}); !errors.Is(err, ErrInvalid) {
		t.Fatal("personal package replaced a signed identity", err)
	}
	verified := newRelease(t, s, next, "catalog")
	if _, err = s.Upgrade(ctx, i.ID, UpgradeRequest{Revision: i.Revision, ReleaseID: verified.ID, Grants: i.Grants}); err != nil {
		t.Fatal(err)
	}
	after := call(t, s, i.ID, read("inbox.queue")).Records
	if len(after) != 1 || after[0].ID != row.ID {
		t.Fatal("record identity changed on catalog upgrade")
	}
}

func TestLegacyOfficialFileCanUpgradeButModifiedFilesCannotClaimItsOrigin(t *testing.T) {
	db, service := storeAt(t, ":memory:")
	defer db.Close()
	raw, err := os.ReadFile("../appcatalog/packages/reading-inbox.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	old, err := service.Install(t.Context(), raw, "local")
	if err != nil {
		t.Fatal(err)
	}
	book, err := service.Create(t.Context(), CreateRequest{ReleaseID: old.ID, Name: "Old file install", Grants: old.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	before := call(t, service, book.ID, read("inbox.all")).Records
	old, err = service.Release(t.Context(), old.ID)
	if err != nil || !old.LegacyVerified {
		t.Fatal("official old bytes were not recognized", err)
	}
	raw, err = os.ReadFile("../appcatalog/packages/reading-inbox-1.1.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	next, err := service.Install(t.Context(), raw, "builtin")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := service.Upgrade(t.Context(), book.ID, UpgradeRequest{Revision: book.Revision, ReleaseID: next.ID, Grants: book.Grants})
	if err != nil || updated.ID != book.ID {
		t.Fatal(updated, err)
	}
	after := call(t, service, book.ID, read("inbox.all")).Records
	if len(after) != len(before) || after[0].ID != before[0].ID || after[0].Fields["note"] != before[0].Fields["note"] {
		t.Fatal("old content changed")
	}
}
