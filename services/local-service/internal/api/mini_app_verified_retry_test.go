package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestAcceptedAppBrowserReceiptAcknowledgesAfterGrantRevocation(t *testing.T) {
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := NewServer(Config{Store: store, Chat: chat.NewService(store, nil, nil), LaunchToken: "launch-token"})
	token, csrf := launchBrowserSession(t, server)
	raw, err := os.ReadFile("../appcatalog/packages/japanese-review-book.coveapp")
	if err != nil {
		t.Fatal(err)
	}
	release, err := server.apps.Install(t.Context(), raw, "builtin")
	if err != nil {
		t.Fatal(err)
	}
	book, err := server.apps.Create(t.Context(), miniapps.CreateRequest{ReleaseID: release.ID, Name: "Book", Grants: []string{"ai.generate"}})
	if err != nil {
		t.Fatal(err)
	}
	const taskID = "saved-browser-task"
	input := chat.DebateBrowserResult{ClaimID: "original-claim", Body: "The saved verified result", Verification: persistence.GenerationVerification{Status: persistence.VerificationModel}}
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(append([]byte(book.ID+"/"+taskID+"/"+token+"/"), encoded...))
	receipt := hex.EncodeToString(sum[:])
	if err := store.BeginBrowserAppTask(t.Context(), book.ID, taskID, "frozen-request", "{}", persistence.ProviderSnapshot{}); err != nil {
		t.Fatal(err)
	}
	if err := store.FinishBrowserAppTask(t.Context(), book.ID, taskID, "completed", input.Body, "", input.Verification, receipt); err != nil {
		t.Fatal(err)
	}
	if _, err := server.apps.Configure(t.Context(), book.ID, miniapps.ConfigRequest{Enabled: true, Revision: book.Revision, Grants: []string{}}); err != nil {
		t.Fatal(err)
	}
	call := func(task, step, owner, proof string, result chat.DebateBrowserResult, want int) {
		t.Helper()
		body, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		if step != "settle" {
			body, err = json.Marshal(map[string]string{"claim_id": result.ClaimID, "phase": "streaming"})
			if err != nil {
				t.Fatal(err)
			}
		}
		request := httptest.NewRequest("POST", "http://127.0.0.1:47123/api/mini-apps/instances/"+book.ID+"/tasks/"+task+"/browser/"+step, bytes.NewReader(body))
		request.Header.Set("Origin", "http://127.0.0.1:47123")
		request.Header.Set("X-Cove-Session-Token", owner)
		request.Header.Set("X-Cove-CSRF-Token", proof)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s returned %d, want %d: %s", step, response.Code, want, response.Body.String())
		}
		if strings.Contains(response.Body.String(), input.Body) {
			t.Fatal("acknowledgement exposed the saved result")
		}
		if want == 200 && response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("acknowledgement was cacheable")
		}
	}
	call(taskID, "settle", token, csrf, input, 200)
	changed := input
	changed.Body = "A different result"
	call(taskID, "settle", token, csrf, changed, 403)
	changed = input
	changed.ClaimID = "a-different-claim"
	call(taskID, "settle", token, csrf, changed, 403)
	call("another-task", "settle", token, csrf, input, 403)
	call(taskID, "claim", token, csrf, chat.DebateBrowserResult{ClaimID: input.ClaimID}, 403)
	call(taskID, "progress", token, csrf, chat.DebateBrowserResult{ClaimID: input.ClaimID}, 403)
	server.security.RegisterLaunchToken("another-browser")
	other, err := server.security.ConsumeLaunchToken("another-browser")
	if err != nil {
		t.Fatal(err)
	}
	call(taskID, "settle", other.ID, other.CSRFToken, input, 403)
	call(taskID, "settle", "invalid-session", csrf, input, 401)
	task, err := store.AppTask(t.Context(), book.ID, taskID)
	if err != nil || task.State != "completed" || task.Result != input.Body {
		t.Fatal("receipt replay changed the committed task", task, err)
	}
}
