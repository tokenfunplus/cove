package miniapps

import (
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
)

func TestCloudPermissionCanBeRevokedWithoutDisablingLocalTasks(t *testing.T) {
	store, service := storeAt(t, ":memory:")
	defer store.Close()
	raw, err := os.ReadFile("../appcatalog/testdata/legacy-releases/japanese-review-book-1.1.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	release, err := service.Install(t.Context(), raw, "builtin")
	if err != nil {
		t.Fatal(err)
	}
	book, err := service.Create(t.Context(), CreateRequest{ReleaseID: release.ID, Name: "Policy fixture", Grants: release.Package.Capabilities})
	if err != nil || book.CloudEnabled {
		t.Fatal("cloud access must start off", err)
	}
	executor := &captureProposal{}
	request := ModelRequest{Action: "review.suggestQuestions", Surface: "page", OperationID: uuid.NewString(), ProviderID: "fixture", ModelID: "model", Destination: "https://model.example/v1", Input: map[string]any{"passage": "Synthetic lesson", "count": 1.0}}
	if _, err = service.StartModel(t.Context(), executor, book.ID, request); !errors.Is(err, ErrDenied) {
		t.Fatal("cloud request was not blocked", err)
	}
	if executor.in.ID != "" {
		t.Fatal("denied request reached the executor")
	}
	book, err = service.Configure(t.Context(), book.ID, ConfigRequest{Revision: book.Revision, Enabled: true, Grants: book.Grants, CloudEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.StartModel(t.Context(), executor, book.ID, request); err != nil {
		t.Fatal("explicit cloud permission was ignored", err)
	}
	book, err = service.Configure(t.Context(), book.ID, ConfigRequest{Revision: book.Revision, Enabled: true, Grants: book.Grants, CloudEnabled: false})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.StartModel(t.Context(), executor, book.ID, request); !errors.Is(err, ErrDenied) {
		t.Fatal("revoked cloud permission accepted", err)
	}
	request.Destination = "http://127.0.0.1:8080/v1"
	request.OperationID = uuid.NewString()
	if _, err = service.StartModel(t.Context(), executor, book.ID, request); err != nil {
		t.Fatal("local endpoint became unavailable", err)
	}
	for endpoint, want := range map[string]bool{"http://127.0.0.1/v1": false, "http://[::1]/v1": false, "http://localhost/v1": false, "https://model.example/v1": true, "http://localhost.example/v1": true} {
		if chat.AppDestinationRemote(endpoint) != want {
			t.Fatal("wrong destination class", endpoint)
		}
	}
}

func TestReleaseRemovalPreservesInstancesAndReadQueriesDoNotFloodActivity(t *testing.T) {
	store, service := storeAt(t, ":memory:")
	defer store.Close()
	release, book := setup(t, service)
	for range 110 {
		call(t, service, book.ID, read("inbox.queue"))
	}
	entries, err := store.AppActivity(t.Context(), book.ID)
	if err != nil || len(entries) != 0 {
		t.Fatal("reads generated activity", len(entries), err)
	}
	cmd := Invocation{OperationID: uuid.NewString(), Action: "inbox.add", Surface: "page", Inputs: map[string]any{"title": "User note", "note": "Saved content"}}
	cmd.Confirm = call(t, service, book.ID, cmd).Confirmation
	call(t, service, book.ID, cmd)
	if err := service.RemoveRelease(t.Context(), release.ID); err == nil {
		t.Fatal("removed a referenced release")
	}
	entries, err = store.AppActivity(t.Context(), book.ID)
	if err != nil || len(entries) != 1 || entries[0].Status != "completed" {
		t.Fatal("write activity missing", entries, err)
	}
	global, err := store.GlobalAppActivity(t.Context(), book.ID)
	if err != nil || len(global) != 1 || global[0].InstanceName != book.Name {
		t.Fatal("global activity missing", global, err)
	}
	if err := service.Delete(t.Context(), book.ID); err != nil {
		t.Fatal(err)
	}
	if err := service.RemoveRelease(t.Context(), release.ID); err != nil {
		t.Fatal("unused release was not removable", err)
	}
}
