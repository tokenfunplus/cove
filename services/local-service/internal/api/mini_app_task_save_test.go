package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

type pendingSaveRecorder struct {
	*chat.Service
	store    *persistence.SQLiteStore
	instance string
	id       string
	saved    bool
	calls    int
}

func (model *pendingSaveRecorder) ProjectAppTask(instance string, task persistence.AppTask) persistence.AppTask {
	if instance == model.instance && task.ID == model.id && !model.saved {
		task.State, task.Result, task.Error, task.PendingSave = "save_failed", "Frozen result", "Only in memory", true
	}
	return task
}

func (model *pendingSaveRecorder) RetryAppTaskSave(ctx context.Context, instance, id string) error {
	model.calls++
	if instance != model.instance || id != model.id {
		return chat.ErrAppTaskConflict
	}
	if model.saved {
		return nil
	}
	if err := model.store.FinishAppTask(ctx, instance, id, "completed", "Frozen result", ""); err != nil {
		return err
	}
	model.saved = true
	return nil
}

func (model *pendingSaveRecorder) DiscardAppTaskResult(ctx context.Context, instance, id string) error {
	model.calls++
	if instance != model.instance || id != model.id {
		return chat.ErrAppTaskConflict
	}
	if model.saved {
		return nil
	}
	if err := model.store.FinishAppTask(ctx, instance, id, "cancelled", "", "Discarded by the owner."); err != nil {
		return err
	}
	model.saved = true
	return nil
}

func TestAppTaskSaveRetryIsBoundToItsOwnerAndWorksAfterGrantRevocation(t *testing.T) {
	for _, mode := range []string{"save-generation", "save-proposal", "discard-generation", "discard-proposal"} {
		proposal := strings.HasSuffix(mode, "proposal")
		discard := strings.HasPrefix(mode, "discard")
		name := "generation"
		if proposal {
			name = "proposal"
		}
		t.Run(mode+"-"+name, func(t *testing.T) {
			store, err := persistence.OpenSQLite(":memory:")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = store.Close() })
			model := &pendingSaveRecorder{Service: chat.NewService(store, nil, nil), store: store, id: "pending-task"}
			server := NewServer(Config{Store: store, Chat: model, LaunchToken: "launch-token"})
			token, csrf := launchBrowserSession(t, server)
			raw, err := os.ReadFile("../appcatalog/testdata/legacy-releases/japanese-review-book.coveapp")
			if err != nil {
				t.Fatal(err)
			}
			release, err := server.apps.Install(t.Context(), raw, "builtin")
			if err != nil {
				t.Fatal(err)
			}
			book, err := server.apps.Create(t.Context(), miniapps.CreateRequest{ReleaseID: release.ID, Name: "Book", Grants: []string{"ai.generate", "records.commit"}})
			if err != nil {
				t.Fatal(err)
			}
			other, err := server.apps.Create(t.Context(), miniapps.CreateRequest{ReleaseID: release.ID, Name: "Another book"})
			if err != nil {
				t.Fatal(err)
			}
			model.instance = book.ID
			frozen := fmt.Sprintf(`{"Release":%q,"Target":{"action":"review.suggestQuestions","surface":"page"}}`, release.ID)
			if proposal {
				frozen = fmt.Sprintf(`{"Release":%q,"ProposalRevision":%d,"Target":{"surface":"chat"}}`, release.ID, book.Revision)
			}
			if err := store.BeginAppTask(t.Context(), book.ID, model.id, "frozen", frozen); err != nil {
				t.Fatal(err)
			}
			call := func(method, route, session, proof string, want int) *httptest.ResponseRecorder {
				t.Helper()
				request := httptest.NewRequest(method, "http://127.0.0.1:47123/api/mini-apps"+route, nil)
				request.Header.Set("Origin", "http://127.0.0.1:47123")
				request.Header.Set("X-Cove-Session-Token", session)
				request.Header.Set("X-Cove-CSRF-Token", proof)
				response := httptest.NewRecorder()
				server.Handler().ServeHTTP(response, request)
				if response.Code != want {
					t.Fatalf("%s %s returned %d; want %d: %s", method, route, response.Code, want, response.Body.String())
				}
				return response
			}
			prefix := "/instances/" + book.ID
			var task persistence.AppTask
			readPath := prefix + "/tasks/" + model.id
			if proposal {
				readPath = prefix + "/proposals/" + model.id
			}
			if err := json.Unmarshal(call("GET", readPath, token, csrf, 200).Body.Bytes(), &task); err != nil || task.State != "save_failed" || !task.PendingSave || task.Result != "Frozen result" {
				t.Fatal("task projection hid the unsaved result", task, err)
			}
			var activity struct {
				Activity []persistence.GlobalAppActivity
			}
			if err := json.Unmarshal(call("GET", "/activity", token, csrf, 200).Body.Bytes(), &activity); err != nil || len(activity.Activity) != 1 || activity.Activity[0].Status != "save_failed" {
				t.Fatal("global activity hid the unsaved task", activity, err)
			}
			endpoint := "/retry-save"
			if discard {
				endpoint = "/discard-result"
			}
			retry := prefix + "/tasks/" + model.id + endpoint
			call("POST", retry, "", "", 401)
			call("POST", retry, token, "", 403)
			call("POST", "/instances/"+other.ID+"/tasks/"+model.id+endpoint, token, csrf, 404)
			if model.calls != 0 {
				t.Fatal("unauthorized retry reached the save operation")
			}
			if _, err := server.apps.Configure(t.Context(), book.ID, miniapps.ConfigRequest{Revision: book.Revision, Enabled: false, Grants: []string{}}); err != nil {
				t.Fatal(err)
			}
			call("GET", prefix+"/tasks/"+model.id, token, csrf, 403)
			for range 2 {
				response := call("POST", retry, token, csrf, 204)
				if response.Body.Len() != 0 {
					t.Fatal("administrative save retry disclosed a revoked model result")
				}
			}
			task, found, err := store.FindAppTask(t.Context(), book.ID, model.id)
			wantState, wantResult := "completed", "Frozen result"
			if discard {
				wantState, wantResult = "cancelled", ""
			}
			if err != nil || !found || task.State != wantState || task.Result != wantResult || model.calls != 2 {
				t.Fatal("owner could not save its frozen result after revocation", task, err)
			}
		})
	}
}
