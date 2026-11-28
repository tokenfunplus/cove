package miniapps

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func followupPackage() Package {
	return Package{Format: 1, MinHostVersion: RuntimeVersion, Publisher: "followup-author", App: "entries", Name: "Entries", Description: "Review fixtures", Version: "1.0.0", SchemaVersion: 1,
		Capabilities: []string{"records.query", "records.commit", "ai.generate"},
		Collections:  map[string]Collection{"entries": {Fields: map[string]string{"title": "text", "when": "date", "quantity": "number"}}},
		Actions: map[string]Action{
			"create":   {Title: "Create", Op: "create", Collection: "entries", Inputs: map[string]string{"title": "text", "when": "date", "quantity": "number"}, Defaults: map[string]any{"when": "$today", "quantity": 2.0}, Values: map[string]any{"title": "$input.title", "when": "$input.when", "quantity": "$input.quantity"}, Surfaces: []string{"page"}},
			"query":    {Title: "Query", Op: "query", Collection: "entries", Inputs: map[string]string{"quantity": "number"}, Where: []Predicate{{Field: "quantity", Op: "eq", Value: "$input.quantity"}}, Surfaces: []string{"page"}},
			"generate": {Title: "Generate", Op: "generate", Inputs: map[string]string{"passage": "text", "when": "date", "count": "number"}, Defaults: map[string]any{"when": "$today", "count": 2.0}, Prompt: "Draft entries.", TextInput: "passage", CandidateAction: "create", CandidateBindings: map[string]string{"when": "when", "quantity": "count"}, CountInput: "count", Surfaces: []string{"page"}},
		}, Pages: []Page{{ID: "main", Title: "Entries", Actions: []string{"create", "query", "generate"}}},
	}
}

func followupBook(t *testing.T, service *Service, pkg Package) (Release, Instance) {
	t.Helper()
	release := newRelease(t, service, pkg, "local")
	book, err := service.Create(t.Context(), CreateRequest{ReleaseID: release.ID, Name: "Entries", Grants: release.Package.Capabilities})
	if err != nil {
		t.Fatal(err)
	}
	return release, book
}

func TestModelTaskFreezesResolvedDefaultsWithClockIndependentRetryIdentity(t *testing.T) {
	db, service := storeAt(t, ":memory:")
	defer db.Close()
	_, book := followupBook(t, service, followupPackage())
	now := time.Date(2026, 11, 28, 23, 59, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	executor := &captureProposal{}
	req := ModelRequest{ExpectedRevision: book.Revision, Action: "generate", Surface: "page", OperationID: uuid.NewString(), ProviderID: "fixture", ModelID: "fixture", Destination: "http://localhost.:8080/v1", Input: map[string]any{"passage": "Original passage"}}
	if _, err := service.StartModel(t.Context(), executor, book.ID, req); err != nil {
		t.Fatal(err)
	}
	var frozen struct{ Target ModelRequest }
	if err := json.Unmarshal([]byte(executor.in.Request), &frozen); err != nil {
		t.Fatal(err)
	}
	if frozen.Target.Input["when"] != "2026-11-28" || frozen.Target.Input["count"] != 2.0 {
		t.Fatal("defaults were not frozen", frozen)
	}
	if !strings.Contains(executor.in.Prompt, `"count":2`) || strings.Contains(executor.in.Prompt, `"when"`) {
		t.Fatal("count binding hid the requested count or leaked a local binding", executor.in.Prompt)
	}
	fingerprint := executor.in.Fingerprint
	now = now.Add(24 * time.Hour)
	if _, err := service.StartModel(t.Context(), executor, book.ID, req); err != nil {
		t.Fatal(err)
	}
	if executor.in.Fingerprint != fingerprint {
		t.Fatal("clock-dependent defaults changed retry identity")
	}
	req.Input["when"] = "2026-10-01"
	req.OperationID = uuid.NewString()
	if _, err := service.StartModel(t.Context(), executor, book.ID, req); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(executor.in.Request), &frozen); err != nil || frozen.Target.Input["when"] != "2026-10-01" {
		t.Fatal("explicit input did not override the default", frozen, err)
	}
}

func TestCandidateBatchResolvesDefaultsAtOneTime(t *testing.T) {
	db, service := storeAt(t, ":memory:")
	defer db.Close()
	pkg := followupPackage()
	generator := pkg.Actions["generate"]
	delete(generator.CandidateBindings, "when")
	pkg.Actions["generate"] = generator
	_, book := followupBook(t, service, pkg)
	calls := 0
	service.now = func() time.Time { calls++; return time.Date(2026, 11, 28+calls-1, 23, 59, 0, 0, time.UTC) }
	result, err := service.CheckCandidates(t.Context(), book.ID, CandidateCheckRequest{ExpectedRevision: book.Revision, Action: "generate", Surface: "page", Items: []map[string]any{{"title": "Same"}, {"title": "Same"}}})
	if err != nil || !reflect.DeepEqual(result.Duplicates, []int{1}) || calls != 1 {
		t.Fatal("candidate defaults crossed dates within one batch", result, calls, err)
	}
}

func TestNumericQueryMatchesTheStoredFloatRepresentation(t *testing.T) {
	db, service := storeAt(t, ":memory:")
	defer db.Close()
	_, book := followupBook(t, service, followupPackage())
	value := float64(1000000000000000100)
	request := Invocation{OperationID: "large-number", Action: "create", Surface: "page", Inputs: map[string]any{"title": "Large number", "quantity": value}}
	request.Confirm = call(t, service, book.ID, request).Confirmation
	saved := call(t, service, book.ID, request).Records[0]
	rows := call(t, service, book.ID, Invocation{OperationID: "query-number", Action: "query", Surface: "page", Inputs: map[string]any{"quantity": value}}).Records
	if len(rows) != 1 || rows[0].ID != saved.ID {
		t.Fatal("SQLite rejected a value equal in the interpreter", rows, value)
	}
}

func TestAssetsRejectHeadersWithoutPixelData(t *testing.T) {
	pkg := followupPackage()
	pkg.MinHostVersion = RuntimeVersion
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	pkg.Assets = map[string]ImageAsset{"cover": {MIME: "image/png", Alt: "Cover", Data: base64.StdEncoding.EncodeToString(encoded.Bytes())}}
	if err := validateAssets(pkg); err != nil {
		t.Fatal("complete image rejected", err)
	}
	header := encoded.Bytes()[:33]
	if _, _, err := image.DecodeConfig(bytes.NewReader(header)); err != nil {
		t.Fatal("fixture must pass the header check", err)
	}
	pkg.Assets["cover"] = ImageAsset{MIME: "image/png", Alt: "Cover", Data: base64.StdEncoding.EncodeToString(header)}
	if err := validateAssets(pkg); !errors.Is(err, ErrInvalid) {
		t.Fatal("accepted missing pixel data", err)
	}
}

func TestBackupRejectsStructCaseAliasesButPreservesMapKeys(t *testing.T) {
	db, service := storeAt(t, ":memory:")
	defer db.Close()
	_, book := followupBook(t, service, followupPackage())
	request := Invocation{OperationID: "backup-row", Action: "create", Surface: "page", Inputs: map[string]any{"title": "Note"}}
	request.Confirm = call(t, service, book.ID, request).Confirmation
	call(t, service, book.ID, request)
	backup, err := service.Export(t.Context(), book.ID)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(backup)
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{strings.Replace(string(raw), `"name":`, `"NAME":"Alias","name":`, 1), strings.Replace(string(raw), `"revision":`, `"REVISION":1,"revision":`, 1)} {
		if _, err := decodeBackup([]byte(bad)); !errors.Is(err, ErrInvalid) {
			t.Fatal("accepted an ambiguous struct key", err)
		}
	}
	backup.Collections["entries"][0].Fields = map[string]any{"key": "lower", "KEY": "upper"}
	raw, err = json.Marshal(backup)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeBackup(raw)
	if err != nil || decoded.Collections["entries"][0].Fields["KEY"] != "upper" || decoded.Collections["entries"][0].Fields["key"] != "lower" {
		t.Fatal("map key case was folded", decoded, err)
	}
}

func TestMigrationStopsBeforeWritingPastTheInstanceQuota(t *testing.T) {
	path := filepath.Join(t.TempDir(), "quota.sqlite")
	db, service := storeAt(t, path)
	defer db.Close()
	pkg := followupPackage()
	release, book := followupBook(t, service, pkg)
	err := db.MiniAppTransaction(t.Context(), func(tx *persistence.MiniAppStore) error {
		for range 350 {
			if err := saveRecord(tx, book.ID, "entries", Record{ID: uuid.NewString(), Revision: 1, Fields: map[string]any{"title": strings.Repeat("a", 40000), "when": "2026-11-28", "quantity": 1.0}}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	rawDB, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer rawDB.Close()
	_, err = rawDB.Exec(`CREATE TRIGGER reject_oversized_migration BEFORE UPDATE OF fields ON mini_app_records WHEN (SELECT sum(length(fields)) FROM mini_app_records WHERE instance_id=NEW.instance_id)-length(OLD.fields)+length(NEW.fields)>16777216 BEGIN SELECT RAISE(FAIL,'oversized write reached SQLite'); END`)
	if err != nil {
		t.Fatal(err)
	}
	pkg.Version = "1.1.0"
	pkg.SchemaVersion = 2
	pkg.Collections["entries"].Fields["extra"] = "text"
	pkg.Actions["create"].Values["extra"] = ""
	pkg.Migrations = []Migration{{From: 1, To: 2, Defaults: map[string]map[string]any{"entries": {"extra": strings.Repeat("b", 10000)}}}}
	next := newRelease(t, service, pkg, "local")
	if _, err := service.Upgrade(t.Context(), book.ID, UpgradeRequest{Revision: book.Revision, ReleaseID: next.ID, Grants: book.Grants}); !errors.Is(err, ErrInvalid) {
		t.Fatal("quota was checked only after writing oversized storage", err)
	}
	current, err := service.Instance(t.Context(), book.ID)
	if err != nil || current.ReleaseID != release.ID {
		t.Fatal("failed upgrade changed the active release", current, err)
	}
}
