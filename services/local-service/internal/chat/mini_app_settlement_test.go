package chat

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type failingAppSettlementStore struct {
	*persistence.SQLiteStore
	attempts       atomic.Int32
	failures       atomic.Int32
	alwaysFail     atomic.Bool
	loseBrowserAck atomic.Bool
}

type pausedAppReplayReadStore struct {
	*failingAppSettlementStore
	block   atomic.Bool
	read    chan struct{}
	release chan struct{}
}

func (store *pausedAppReplayReadStore) FindAppTask(ctx context.Context, instance, id string) (persistence.AppTask, bool, error) {
	task, found, err := store.failingAppSettlementStore.FindAppTask(ctx, instance, id)
	if store.block.Swap(false) {
		close(store.read)
		<-store.release
	}
	return task, found, err
}

func TestAppTaskReplayReadSerializesWithPendingSave(t *testing.T) {
	service, fault, upstream, input := settlementFixture(t)
	fault.alwaysFail.Store(true)
	if _, err := service.StartAppTask(t.Context(), input, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	waitForAppWorker(t, service)
	fault.alwaysFail.Store(false)
	store := &pausedAppReplayReadStore{failingAppSettlementStore: fault, read: make(chan struct{}), release: make(chan struct{})}
	service.store = store
	store.block.Store(true)
	var release sync.Once
	defer release.Do(func() { close(store.release) })
	type response struct {
		task persistence.AppTask
		err  error
	}
	replayed := make(chan response, 1)
	go func() {
		task, err := service.StartAppTask(t.Context(), input, func() error { return nil })
		replayed <- response{task: task, err: err}
	}()
	<-store.read
	saveStarted, saved := make(chan struct{}), make(chan error, 1)
	go func() {
		close(saveStarted)
		saved <- service.RetryAppTaskSave(t.Context(), input.Instance, input.ID)
	}()
	<-saveStarted
	select {
	case err := <-saved:
		t.Fatal("save overtook a replay that had already read the running row", err)
	case <-time.After(50 * time.Millisecond):
	}
	release.Do(func() { close(store.release) })
	result := <-replayed
	if result.err != nil || result.task.State != "save_failed" || !result.task.PendingSave || result.task.Result != "Frozen candidate" {
		t.Fatal("replay did not return its consistent pending-state view", result)
	}
	if err := <-saved; err != nil {
		t.Fatal(err)
	}
	result.task, result.err = service.StartAppTask(t.Context(), input, func() error { return nil })
	if result.err != nil || result.task.State != "completed" || result.task.PendingSave || upstream.streamCalls() != 1 {
		t.Fatal("replay after saving returned an obsolete running result", result)
	}
}

func (store *failingAppSettlementStore) FinishAppTask(ctx context.Context, instance, id, state, result, detail string) error {
	if store.failFinish() {
		return errors.New("fixture local storage unavailable")
	}
	return store.SQLiteStore.FinishAppTask(ctx, instance, id, state, result, detail)
}

func (store *failingAppSettlementStore) FinishBrowserAppTask(ctx context.Context, instance, id, state, result, detail string, verification persistence.GenerationVerification, receipt string) error {
	if store.failFinish() {
		return errors.New("fixture local storage unavailable")
	}
	if err := store.SQLiteStore.FinishBrowserAppTask(ctx, instance, id, state, result, detail, verification, receipt); err != nil {
		return err
	}
	if store.loseBrowserAck.CompareAndSwap(true, false) {
		return errors.New("fixture ambiguous commit acknowledgment")
	}
	return nil
}

func (store *failingAppSettlementStore) failFinish() bool {
	store.attempts.Add(1)
	if store.alwaysFail.Load() {
		return true
	}
	for failures := store.failures.Load(); failures > 0; failures = store.failures.Load() {
		if store.failures.CompareAndSwap(failures, failures-1) {
			return true
		}
	}
	return false
}

func settlementFixture(t *testing.T) (*Service, *failingAppSettlementStore, *fakeProvider, AppTaskInput) {
	t.Helper()
	store := &failingAppSettlementStore{SQLiteStore: appTaskStore(t)}
	profile := testProfile()
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{
		{Type: provider.EventDelta, Delta: "Frozen candidate"}, {Type: provider.EventCompleted},
	}}}
	service := NewServiceWithTimeout(store, fakeProviderSource{profile: profile}, upstream, time.Minute)
	t.Cleanup(func() {
		store.alwaysFail.Store(false)
		service.StopAppTask("", "")
	})
	input := AppTaskInput{Instance: "book", ID: "task", Fingerprint: "frozen", Request: "{}", Prompt: "Source",
		ProviderID: profile.ID, ModelID: profile.Model, Destination: profile.Endpoint}
	return service, store, upstream, input
}

func waitForAppWorker(t *testing.T, service *Service) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for service.appTaskBusy() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if service.appTaskBusy() {
		t.Fatal("task did not release its model slot")
	}
}

func TestAppTaskRetriesTransientSaveWithoutRepeatingInference(t *testing.T) {
	service, store, upstream, input := settlementFixture(t)
	store.failures.Store(1)
	if _, err := service.StartAppTask(t.Context(), input, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	waitForAppWorker(t, service)
	task, err := store.AppTask(t.Context(), input.Instance, input.ID)
	if err != nil || task.State != "completed" || task.Result != "Frozen candidate" || store.attempts.Load() != 2 || service.hasPendingAppTaskSave() {
		t.Fatal("transient save did not recover", task, store.attempts.Load(), err)
	}
	if err := service.RetryAppTaskSave(t.Context(), input.Instance, input.ID); err != nil {
		t.Fatal("saved result retry was not idempotent", err)
	}
	if upstream.streamCalls() != 1 {
		t.Fatal("persistence retry repeated inference")
	}
}

func TestAppTaskPersistentSaveFailureRemainsRecoverableWithoutBlockingChat(t *testing.T) {
	service, store, upstream, input := settlementFixture(t)
	store.alwaysFail.Store(true)
	allow := func() error { return nil }
	if _, err := service.StartAppTask(t.Context(), input, allow); err != nil {
		t.Fatal(err)
	}
	waitForAppWorker(t, service)
	persisted, err := store.AppTask(t.Context(), input.Instance, input.ID)
	projected := service.ProjectAppTask(input.Instance, persisted)
	if err != nil || persisted.State != "running" || projected.State != "save_failed" || !projected.PendingSave || projected.Result != "Frozen candidate" || projected.Error == "" || store.attempts.Load() != 3 {
		t.Fatal("failed persistence lost its live owner", persisted, projected, err)
	}
	replayed, err := service.StartAppTask(t.Context(), input, allow)
	if err != nil || replayed.State != "save_failed" || !replayed.PendingSave || upstream.streamCalls() != 1 {
		t.Fatal("same-ID retry lost its pending result", replayed, err)
	}
	input.ID = "second-task"
	if _, err := service.StartAppTask(t.Context(), input, allow); !errors.Is(err, ErrAppTaskSavePending) {
		t.Fatal("new app task could overwrite the unsaved result", err)
	}
	upstream.stream = &fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "Independent answer"}, {Type: provider.EventCompleted}}}
	conversation, err := store.CreateConversation(t.Context(), "Independent Chat")
	if err != nil {
		t.Fatal(err)
	}
	batch, err := service.StartGenerationBatch(t.Context(), SendInput{ConversationID: conversation.ID, ClientRequestID: "ordinary-chat", Body: "Question", ProviderID: input.ProviderID, ModelID: input.ModelID})
	if err != nil {
		t.Fatal("pending app storage blocked ordinary Chat", err)
	}
	waitForBatch(t, store.SQLiteStore, batch.Batch.ID, persistence.GenerationBatchCompleted)
	if err := service.RetryAppTaskSave(t.Context(), input.Instance, "task"); !errors.Is(err, ErrAppTaskSavePending) {
		t.Fatal("persistent failure was not reported to the owner", err)
	}
	store.alwaysFail.Store(false)
	if err := service.RetryAppTaskSave(t.Context(), "another-instance", "task"); !errors.Is(err, ErrAppTaskConflict) {
		t.Fatal("another instance could retry the save", err)
	}
	if err := service.RetryAppTaskSave(t.Context(), input.Instance, "task"); err != nil {
		t.Fatal(err)
	}
	task, err := store.AppTask(t.Context(), input.Instance, "task")
	if err != nil || task.State != "completed" || task.Result != "Frozen candidate" || service.hasPendingAppTaskSave() || upstream.streamCalls() != 2 {
		t.Fatal("save retry did not preserve exactly one model result", task, err)
	}
	if err := service.RetryAppTaskSave(t.Context(), input.Instance, "task"); err != nil || upstream.streamCalls() != 2 {
		t.Fatal("accepted save retry repeated work", err)
	}
	upstream.stream = &fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "Next candidate"}, {Type: provider.EventCompleted}}}
	if _, err := service.StartAppTask(t.Context(), input, allow); err != nil {
		t.Fatal("saved settlement did not unblock new app work", err)
	}
	waitForAppWorker(t, service)
	task, err = store.AppTask(t.Context(), input.Instance, input.ID)
	if err != nil || task.State != "completed" || task.Result != "Next candidate" || upstream.streamCalls() != 3 {
		t.Fatal("new app work failed after settlement recovery", task, err)
	}
}

func TestPendingAppSaveSurvivesGrantChangesAndIsClearedByDeletion(t *testing.T) {
	for _, remove := range []bool{false, true} {
		name := "grant-revocation"
		if remove {
			name = "instance-deletion"
		}
		t.Run(name, func(t *testing.T) {
			service, store, _, input := settlementFixture(t)
			store.alwaysFail.Store(true)
			if _, err := service.StartAppTask(t.Context(), input, func() error { return nil }); err != nil {
				t.Fatal(err)
			}
			waitForAppWorker(t, service)
			err := store.MiniAppTransaction(t.Context(), func(tx *persistence.MiniAppStore) error {
				if remove {
					return tx.DeleteInstance(input.Instance)
				}
				return tx.SaveInstance(persistence.AppInstance{ID: input.Instance, ReleaseID: "release", Revision: 2, Enabled: false, Grants: []byte("[]")})
			})
			if err != nil {
				t.Fatal(err)
			}
			service.StopAppTask(input.Instance, "")
			if remove {
				if service.hasPendingAppTaskSave() {
					t.Fatal("deleted owner left a pending admission blocker")
				}
			} else {
				if !service.hasPendingAppTaskSave() {
					t.Fatal("grant revocation silently discarded a completed result")
				}
				store.alwaysFail.Store(false)
				if err := service.RetryAppTaskSave(t.Context(), input.Instance, input.ID); err != nil {
					t.Fatal("owner could not save after disabling the app", err)
				}
			}
		})
	}
}

func TestBrowserTaskCleanupSaveFailureRetainsItsTerminalState(t *testing.T) {
	for _, timeout := range []bool{false, true} {
		name := "cancel"
		if timeout {
			name = "timeout"
		}
		t.Run(name, func(t *testing.T) {
			service, sqlite, upstream, input := appBrowserFixture(t, provider.PrivacyModePrivateTEE)
			store := &failingAppSettlementStore{SQLiteStore: sqlite}
			store.alwaysFail.Store(true)
			service.store = store
			if timeout {
				service.secureTimeout = 10 * time.Millisecond
			}
			if _, err := service.StartAppTask(t.Context(), input, func() error { return nil }); err != nil {
				t.Fatal(err)
			}
			if timeout {
				waitForAppWorker(t, service)
			} else {
				service.StopAppTask(input.Instance, input.ID)
			}
			task, err := store.AppTask(t.Context(), input.Instance, input.ID)
			if err != nil || !service.ProjectAppTask(input.Instance, task).PendingSave || service.appTaskBusy() {
				t.Fatal("browser cleanup lost its pending final state", err)
			}
			store.alwaysFail.Store(false)
			if err := service.RetryAppTaskSave(t.Context(), input.Instance, input.ID); err != nil {
				t.Fatal(err)
			}
			task, err = store.AppTask(t.Context(), input.Instance, input.ID)
			expected := "cancelled"
			if timeout {
				expected = "failed"
			}
			if err != nil || task.State != expected || task.Result != "" || upstream.calls() != 0 {
				t.Fatal("cleanup retry did not retain its frozen terminal state", task, err)
			}
		})
	}
}

func TestRestartDoesNotReplayAnUnsavedAppCompletion(t *testing.T) {
	service, store, upstream, input := settlementFixture(t)
	store.alwaysFail.Store(true)
	if _, err := service.StartAppTask(t.Context(), input, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	waitForAppWorker(t, service)
	// A restarted process has no pending memory. Its normal startup recovery
	// marks interrupted tasks failed instead of charging for another inference.
	if err := store.RecoverAppTasks(t.Context()); err != nil {
		t.Fatal(err)
	}
	restarted := NewServiceWithTimeout(store.SQLiteStore, fakeProviderSource{profile: testProfile()}, upstream, time.Minute)
	result, err := restarted.StartAppTask(t.Context(), input, func() error { return nil })
	if err != nil || result.State != "failed" || result.Result != "" || upstream.streamCalls() != 1 {
		t.Fatal("restart automatically repeated inference", result, err)
	}
}

func TestVerifiedAppSettlementRetriesOnlyItsFrozenReceipt(t *testing.T) {
	for _, scenario := range []struct {
		name                string
		persistent, loseAck bool
	}{
		{name: "transient"}, {name: "persistent", persistent: true}, {name: "ambiguous-commit", loseAck: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			service, sqlite, upstream, input := appBrowserFixture(t, provider.PrivacyModePrivateTEE)
			store := &failingAppSettlementStore{SQLiteStore: sqlite}
			store.alwaysFail.Store(scenario.persistent)
			store.loseBrowserAck.Store(scenario.loseAck)
			if !scenario.persistent && !scenario.loseAck {
				store.failures.Store(1)
			}
			service.store = store
			if _, err := service.StartAppTask(t.Context(), input, func() error { return nil }); err != nil {
				t.Fatal(err)
			}
			claim := uuid.NewString()
			if _, err := service.ClaimAppBrowser(input.Instance, input.ID, input.BrowserOwner, claim); err != nil {
				t.Fatal(err)
			}
			if err := service.ProgressAppBrowser(input.Instance, input.ID, input.BrowserOwner, claim, "verifying_response"); err != nil {
				t.Fatal(err)
			}
			result := DebateBrowserResult{ClaimID: claim, Body: "Verified frozen candidate", Verification: verifiedSettlement("").Verification}
			err := service.SettleAppBrowser(t.Context(), input.Instance, input.ID, input.BrowserOwner, result)
			if scenario.persistent {
				if !errors.Is(err, ErrAppTaskSavePending) || service.appTaskBusy() {
					t.Fatal("unwritten browser settlement was acknowledged or kept Chat busy", err)
				}
				task, err := store.AppTask(t.Context(), input.Instance, input.ID)
				projected := service.ProjectAppTask(input.Instance, task)
				if err != nil || !projected.PendingSave || projected.Result != result.Body || projected.Verification == nil || projected.Verification.Status != persistence.VerificationModel {
					t.Fatal("verified unsaved output was lost", projected, err)
				}
				if err := service.SettleAppBrowser(t.Context(), input.Instance, input.ID, "another-session", result); !errors.Is(err, ErrAppTaskConflict) {
					t.Fatal("another session could reuse the pending receipt", err)
				}
				if err := service.SettleAppBrowser(t.Context(), input.Instance, input.ID, input.BrowserOwner, result); !errors.Is(err, ErrAppTaskSavePending) {
					t.Fatal("identical pending delivery could not find its owner", err)
				}
				store.alwaysFail.Store(false)
				if err := service.RetryAppTaskSave(t.Context(), input.Instance, input.ID); err != nil {
					t.Fatal(err)
				}
			} else {
				attempts := int32(2)
				if scenario.loseAck {
					attempts = 1
				}
				if err != nil || store.attempts.Load() != attempts {
					t.Fatal("browser save did not recover", err, store.attempts.Load())
				}
			}
			task, err := store.AppTask(t.Context(), input.Instance, input.ID)
			if err != nil || task.State != "completed" || task.Result != result.Body || task.Verification == nil || service.hasPendingAppTaskSave() || service.appTaskBusy() {
				t.Fatal("browser receipt retry did not commit its exact result", task, err)
			}
			if err := service.SettleAppBrowser(t.Context(), input.Instance, input.ID, input.BrowserOwner, result); err != nil {
				t.Fatal("accepted receipt lost its idempotency", err)
			}
			result.Body = "Different candidate"
			if err := service.SettleAppBrowser(t.Context(), input.Instance, input.ID, input.BrowserOwner, result); !errors.Is(err, ErrAppTaskConflict) {
				t.Fatal("saved receipt accepted altered content", err)
			}
			if upstream.calls() != 0 {
				t.Fatal("verified save retried plaintext inference")
			}
		})
	}
}

func TestDiscardPendingAppOutputRequiresDurableCancellationAndPreservesRecords(t *testing.T) {
	service, store, upstream, input := settlementFixture(t)
	if err := store.MiniAppTransaction(t.Context(), func(tx *persistence.MiniAppStore) error {
		if err := tx.SaveRecord(input.Instance, "notes", persistence.AppRecord{ID: "saved", Revision: 3, Fields: []byte(`{"title":"Saved record"}`)}); err != nil {
			return err
		}
		return tx.SaveAppBlob(input.Instance, persistence.MiniAppBlob{ID: "attachment", Name: "notes.txt", Data: []byte("Saved attachment")})
	}); err != nil {
		t.Fatal(err)
	}
	store.alwaysFail.Store(true)
	if _, err := service.StartAppTask(t.Context(), input, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	waitForAppWorker(t, service)
	if err := service.DiscardAppTaskResult(t.Context(), "other", input.ID); !errors.Is(err, ErrAppTaskConflict) {
		t.Fatal("another owner discarded output", err)
	}
	if err := service.DiscardAppTaskResult(t.Context(), input.Instance, input.ID); !errors.Is(err, ErrAppTaskSavePending) {
		t.Fatal("failed cancellation was acknowledged", err)
	}
	task, _ := store.AppTask(t.Context(), input.Instance, input.ID)
	if projected := service.ProjectAppTask(input.Instance, task); !projected.PendingSave || projected.Result != "Frozen candidate" {
		t.Fatal("failed discard lost the result", projected)
	}
	store.alwaysFail.Store(false)
	for range 2 {
		if err := service.DiscardAppTaskResult(t.Context(), input.Instance, input.ID); err != nil {
			t.Fatal("discard was not idempotent", err)
		}
	}
	task, err := store.AppTask(t.Context(), input.Instance, input.ID)
	if err != nil || task.State != "cancelled" || task.Result != "" || service.hasPendingAppTaskSave() || upstream.streamCalls() != 1 {
		t.Fatal("discard did not release only its output", task, err)
	}
	if err := store.MiniAppTransaction(t.Context(), func(tx *persistence.MiniAppStore) error {
		instance, err := tx.Instance(input.Instance)
		if err != nil || instance.Revision != 1 || instance.Name != "Book" {
			t.Fatal("discard changed the instance", instance, err)
		}
		records, err := tx.Records(input.Instance, "notes")
		if err != nil || len(records) != 1 || records[0].Revision != 3 || string(records[0].Fields) != `{"title":"Saved record"}` {
			t.Fatal("discard changed saved records", records, err)
		}
		attachment, err := tx.AppBlob(input.Instance, "attachment")
		if err != nil || string(attachment.Data) != "Saved attachment" {
			t.Fatal("discard changed attachments", attachment, err)
		}
		return nil
	}); err != nil {
		t.Fatal("discard removed its instance", err)
	}
	input.ID = "after-discard"
	upstream.stream = &fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "Next result"}, {Type: provider.EventCompleted}}}
	if _, err := service.StartAppTask(t.Context(), input, func() error { return nil }); err != nil {
		t.Fatal("discard left admission blocked", err)
	}
	waitForAppWorker(t, service)
}

func TestDiscardPendingOutputNeverOverwritesAnAlreadyCommittedResult(t *testing.T) {
	service, store, _, input := settlementFixture(t)
	if _, err := service.StartAppTask(t.Context(), input, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	waitForAppWorker(t, service)
	// Reproduce an ambiguous commit whose acknowledgment and receipt check failed.
	service.appTask.Lock()
	service.appTask.pending = &appTaskSettlement{instance: input.Instance, id: input.ID, state: "completed", result: "Frozen candidate"}
	service.appTask.Unlock()
	if err := service.DiscardAppTaskResult(t.Context(), input.Instance, input.ID); err != nil {
		t.Fatal(err)
	}
	task, err := store.AppTask(t.Context(), input.Instance, input.ID)
	if err != nil || task.State != "completed" || task.Result != "Frozen candidate" || service.hasPendingAppTaskSave() {
		t.Fatal("discard replaced durable output", task, err)
	}
}
