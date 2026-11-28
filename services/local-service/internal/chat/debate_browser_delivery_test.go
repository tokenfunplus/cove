package chat

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func frozenDebateDeliveryFixture(t *testing.T, phase string) (*Service, *persistence.SQLiteStore, *debateTestProvider, *debateRun, persistence.DebateTurn, *debateBrowserTurn) {
	t.Helper()
	ctx := context.Background()
	service, store, upstream := browserDebateFixture(t, provider.PrivacyModeIncognito)
	input := debateInput()
	session, err := store.CreateDebate(ctx, persistence.DebateSession{ClientRequestID: input.ClientRequestID, Topic: input.Topic, Seats: input.Seats, Rules: input.Rules, Status: "running", Round: 1, OpeningDone: []bool{false, false}})
	if err != nil {
		t.Fatal(err)
	}
	turn, err := store.BeginDebateTurn(ctx, persistence.DebateTurn{DebateID: session.ID, Seat: 0, Round: 1, State: "streaming", Execution: "browser", Phase: phase})
	if err != nil {
		t.Fatal(err)
	}
	runContext, cancel := context.WithCancel(ctx)
	task := &debateBrowserTurn{claimID: "browser-one", deadline: time.Now().Add(time.Minute), paused: make(chan struct{}), result: make(chan DebateBrowserResult, 1), done: make(chan struct{})}
	run := &debateRun{id: session.ID, ctx: runContext, cancel: cancel, turns: map[string]persistence.DebateTurn{turn.ID: turn}, browser: map[string]*debateBrowserTurn{turn.ID: task}}
	service.debate = run
	t.Cleanup(func() {
		cancel()
		service.debateMu.Lock()
		service.debate = nil
		service.debateMu.Unlock()
	})
	return service, store, upstream, run, turn, task
}

// Hold the worker until its HTTP caller loses the response. The accepted
// receipt stays queued, matching an ambiguous delivery before persistence.
func queueDebateDeliveryWithoutAcknowledgement(t *testing.T, service *Service, turn persistence.DebateTurn, input DebateBrowserResult) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := service.SettleDebateBrowserTurn(ctx, turn.DebateID, turn.ID, input); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("expected an accepted result with its acknowledgement lost", err)
	}
}

func TestDebateDeliveryCleanupCannotReplaceAnAcceptedVerifiedReceipt(t *testing.T) {
	service, store, upstream, run, turn, task := frozenDebateDeliveryFixture(t, "verifying_response")
	verified := DebateBrowserResult{ClaimID: "browser-one", Body: "The accepted paid answer", Verification: verifiedSettlement("").Verification}
	queueDebateDeliveryWithoutAcknowledgement(t, service, turn, verified)
	failure := DebateBrowserResult{ClaimID: "browser-one", Verification: persistence.GenerationVerification{Status: persistence.VerificationFailed, FailureCode: "browser_delivery_failed"}}
	if _, err := service.SettleDebateBrowserTurn(context.Background(), turn.DebateID, turn.ID, failure); !errors.Is(err, ErrDebateState) {
		t.Fatal("altered receipt was accepted for the original claim", err)
	}
	if !task.submitted || len(task.result) != 1 {
		t.Fatal("delivery cleanup changed the single accepted result")
	}
	service.runDebateBrowserTurn(run, turn, task, true)
	saved, err := store.ReadDebateTurn(context.Background(), turn.DebateID, turn.ID)
	if err != nil || saved.State != "completed" || saved.Body != verified.Body || saved.Verification == nil || saved.Verification.Status != persistence.VerificationModel {
		t.Fatal("cleanup overwrote an accepted verified result", saved, err)
	}
	if _, err := service.SettleDebateBrowserTurn(context.Background(), turn.DebateID, turn.ID, failure); !errors.Is(err, ErrDebateState) {
		t.Fatal("cleanup after worker completion should leave the terminal result unchanged", err)
	}
	after, err := store.ReadDebateTurn(context.Background(), turn.DebateID, turn.ID)
	if err != nil || after.Body != verified.Body || after.State != "completed" || upstream.calls() != 0 {
		t.Fatal("late cleanup replaced the result or ran inference", after, err)
	}
}

type debateBrowserReceiptFaultStore struct {
	*persistence.SQLiteStore
	fail            atomic.Bool
	failDeletion    atomic.Bool
	commitThenFail  atomic.Bool
	terminalCommits atomic.Int64
}

var errDebateBrowserReceiptStorage = errors.New("synthetic browser receipt storage failure")

func (store *debateBrowserReceiptFaultStore) DeleteConversation(ctx context.Context, id string) error {
	if store.failDeletion.Load() {
		return errDebateBrowserReceiptStorage
	}
	return store.SQLiteStore.DeleteConversation(ctx, id)
}

func (store *debateBrowserReceiptFaultStore) ClearChatData(ctx context.Context) error {
	if store.failDeletion.Load() {
		return errDebateBrowserReceiptStorage
	}
	return store.SQLiteStore.ClearChatData(ctx)
}

func (store *debateBrowserReceiptFaultStore) FinishDebateTurn(ctx context.Context, turn persistence.DebateTurn, session persistence.DebateSession) error {
	if turn.BrowserReceipt != "" && store.fail.Load() {
		return errDebateBrowserReceiptStorage
	}
	if err := store.SQLiteStore.FinishDebateTurn(ctx, turn, session); err != nil {
		return err
	}
	if turn.BrowserReceipt != "" {
		store.terminalCommits.Add(1)
		if store.commitThenFail.Swap(false) {
			return errDebateBrowserReceiptStorage
		}
	}
	return nil
}

func TestDebateAcceptedBrowserReceiptRecoversStorageFailureWithoutRepeatingInference(t *testing.T) {
	for _, recovery := range []string{"delivery retry", "resume"} {
		t.Run(recovery, func(t *testing.T) {
			ctx := context.Background()
			service, sqlite, upstream := browserDebateFixture(t, provider.PrivacyModePrivateTEE)
			store := &debateBrowserReceiptFaultStore{SQLiteStore: sqlite}
			service.store = store
			session, err := service.StartDebate(ctx, debateInput())
			if err != nil {
				t.Fatal(err)
			}
			view := waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return len(view.Turns) == 2 })
			turn := view.Turns[0]
			if _, err := service.ClaimDebateBrowserTurn(ctx, session.ID, turn.ID, "retained-browser"); err != nil {
				t.Fatal(err)
			}
			if err := service.ProgressDebateBrowserTurn(ctx, session.ID, turn.ID, DebateBrowserProgress{ClaimID: "retained-browser", Phase: "verifying_response"}); err != nil {
				t.Fatal(err)
			}
			// Finish the other unclaimed opening and prevent later scheduling.
			if _, err := service.ControlDebate(ctx, session.ID, "pause"); err != nil {
				t.Fatal(err)
			}
			input := DebateBrowserResult{ClaimID: "retained-browser", Body: "A paid verified answer retained through storage failure", Verification: verifiedSettlement("").Verification}
			store.fail.Store(true)
			if _, err := service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, input); !errors.Is(err, errDebateBrowserReceiptStorage) {
				t.Fatal("terminal write failure was acknowledged as saved", err)
			}
			waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return !service.debateBusy() })
			if _, err := service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, input); !errors.Is(err, errDebateBrowserReceiptStorage) {
				t.Fatal("persistent failure discarded the retryable receipt", err)
			}
			if _, err := service.ControlDebate(ctx, session.ID, "resume"); !errors.Is(err, errDebateBrowserReceiptStorage) {
				t.Fatal("Resume admitted a new inference before saving the accepted receipt", err)
			}
			another := debateInput()
			another.ClientRequestID = "another-debate-while-unsaved"
			if _, err := service.StartDebate(ctx, another); !errors.Is(err, ErrDebateState) {
				t.Fatal("another debate bypassed the bounded pending-result owner", err)
			}
			changed := input
			changed.Body = "A different answer using the same claim"
			if _, err := service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, changed); !errors.Is(err, ErrDebateState) {
				t.Fatal("an altered receipt replaced the retained answer", err)
			}
			before, err := sqlite.ReadDebate(ctx, session.ID, 0)
			if err != nil || len(before.Turns) != 2 || before.Session.TotalTurns != 0 || upstream.calls() != 0 {
				t.Fatal("failed delivery scheduled or counted new inference", err)
			}
			store.fail.Store(false)
			if recovery == "delivery retry" {
				if result, err := service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, input); err != nil || result.Body != input.Body || result.State != "completed" {
					t.Fatal("the original paid receipt did not recover", result, err)
				}
			}
			if _, err := service.ControlDebate(ctx, session.ID, "resume"); err != nil {
				t.Fatal("Resume did not recover the original accepted receipt", err)
			}
			view = waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return len(view.Turns) == 3 })
			if view.Session.TotalTurns != 1 || !view.Session.OpeningDone[turn.Seat] || view.Turns[2].Seat == turn.Seat || store.terminalCommits.Load() != 1 || upstream.calls() != 0 {
				t.Fatal("recovery repeated the accepted seat or advanced its cursor twice")
			}
			service.debateMu.Lock()
			pending := len(service.debatePending)
			service.debateMu.Unlock()
			if pending != 0 {
				t.Fatal("durable recovery retained its in-memory output")
			}
			for i := 0; i < 2; i++ {
				if result, err := service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, input); err != nil || result.Body != input.Body || result.State != "completed" {
					t.Fatal("lost acknowledgement could not read the committed result", err)
				}
			}
			if _, err := service.ControlDebate(ctx, session.ID, "stop"); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDebateBrowserAmbiguousCommitAndCanceledDeliveryPreserveReceipt(t *testing.T) {
	for _, ambiguous := range []bool{false, true} {
		t.Run(map[bool]string{false: "expired and canceled worker", true: "commit acknowledgement lost"}[ambiguous], func(t *testing.T) {
			service, sqlite, upstream, run, turn, task := frozenDebateDeliveryFixture(t, "verifying_response")
			store := &debateBrowserReceiptFaultStore{SQLiteStore: sqlite}
			service.store = store
			input := DebateBrowserResult{ClaimID: "browser-one", Body: "The original accepted answer", Verification: verifiedSettlement("").Verification}
			queueDebateDeliveryWithoutAcknowledgement(t, service, turn, input)
			if ambiguous {
				store.commitThenFail.Store(true)
			} else {
				service.debateMu.Lock()
				task.deadline = time.Now().Add(-time.Second)
				run.cancel()
				service.debateMu.Unlock()
				store.fail.Store(true)
			}
			service.runDebateBrowserTurn(run, turn, task, true)
			store.fail.Store(false)
			for i := 0; i < 2; i++ {
				result, err := service.SettleDebateBrowserTurn(context.Background(), turn.DebateID, turn.ID, input)
				if err != nil || result.State != "completed" || result.Body != input.Body || result.Verification == nil {
					t.Fatal("receipt was downgraded or lost after acceptance", result, err)
				}
			}
			// A fresh Chat facade has no worker or pending memory. The durable
			// receipt still binds the replay to the original result and claim.
			reopened := NewService(sqlite, nil, nil)
			if result, err := reopened.SettleDebateBrowserTurn(context.Background(), turn.DebateID, turn.ID, input); err != nil || result.Body != input.Body {
				t.Fatal("the receipt depended on the old worker's memory", result, err)
			}
			altered := input
			altered.ClaimID = "another-browser"
			if _, err := service.SettleDebateBrowserTurn(context.Background(), turn.DebateID, turn.ID, altered); !errors.Is(err, ErrDebateState) {
				t.Fatal("another claim replayed the accepted receipt", err)
			}
			altered = input
			altered.Body = ""
			altered.Verification = persistence.GenerationVerification{Status: persistence.VerificationFailed, FailureCode: "browser_delivery_failed"}
			if _, err := service.SettleDebateBrowserTurn(context.Background(), turn.DebateID, turn.ID, altered); !errors.Is(err, ErrDebateState) {
				t.Fatal("empty cleanup replaced the original receipt", err)
			}
			view, err := sqlite.ReadDebate(context.Background(), turn.DebateID, 0)
			if err != nil || view.Session.TotalTurns != 1 || store.terminalCommits.Load() != 1 || upstream.calls() != 0 {
				t.Fatal("recovery repeated inference or terminal cursor advancement", err)
			}
		})
	}
}

func TestDebateRejectedVerifiedDeliveryCanEndBeforeItsInferenceDeadline(t *testing.T) {
	service, store, upstream, run, turn, task := frozenDebateDeliveryFixture(t, "streaming")
	verified := DebateBrowserResult{ClaimID: "browser-one", Body: "A result rejected before response verification", Verification: verifiedSettlement("").Verification}
	if _, err := service.SettleDebateBrowserTurn(context.Background(), turn.DebateID, turn.ID, verified); !errors.Is(err, ErrInvalidDebate) {
		t.Fatal("verified delivery should reject a missing verification phase", err)
	}
	failure := DebateBrowserResult{ClaimID: "browser-one", Verification: persistence.GenerationVerification{Status: persistence.VerificationFailed, FailureCode: "browser_delivery_failed"}}
	queueDebateDeliveryWithoutAcknowledgement(t, service, turn, failure)
	service.runDebateBrowserTurn(run, turn, task, true)
	saved, err := store.ReadDebateTurn(context.Background(), turn.DebateID, turn.ID)
	if err != nil || saved.State != "failed" || saved.Body != "" || saved.ErrorCode != "verification_failed" || saved.Verification == nil || saved.Verification.FailureCode != "browser_delivery_failed" {
		t.Fatal("reachable service waited for expiry instead of accepting terminal cleanup", saved, err)
	}
	if upstream.calls() != 0 {
		t.Fatal("terminal cleanup ran another chargeable request")
	}
}

func TestDebateAcceptedBrowserReceiptFreezesNestedMetricsAndEvidence(t *testing.T) {
	service, store, _, run, turn, task := frozenDebateDeliveryFixture(t, "verifying_response")
	tokens := int64(12)
	input := DebateBrowserResult{ClaimID: "browser-one", Body: "Frozen answer", Metrics: &persistence.GenerationMetrics{Source: "browser", DurationMS: 100, InputTokens: &tokens}, Verification: verifiedSettlement("").Verification}
	input.Verification.Evidence = &persistence.VerificationEvidence{Kind: "fixture", Raw: map[string]interface{}{"proof": "original"}}
	queueDebateDeliveryWithoutAcknowledgement(t, service, turn, input)
	tokens = 99
	input.Verification.Evidence.Raw["proof"] = "changed after acceptance"
	service.runDebateBrowserTurn(run, turn, task, true)
	saved, err := store.ReadDebateTurn(context.Background(), turn.DebateID, turn.ID)
	if err != nil || saved.Metrics == nil || *saved.Metrics.InputTokens != 12 || saved.Verification == nil || saved.Verification.Evidence.Raw["proof"] != "original" {
		t.Fatal("the accepted receipt retained caller-owned nested data", saved, err)
	}
}

func TestDebateHistoryDeletionReleasesPendingReceiptOnlyAfterCommit(t *testing.T) {
	for _, clearAll := range []bool{false, true} {
		t.Run(map[bool]string{false: "delete conversation", true: "clear history"}[clearAll], func(t *testing.T) {
			service, sqlite, upstream, run, turn, task := frozenDebateDeliveryFixture(t, "verifying_response")
			store := &debateBrowserReceiptFaultStore{SQLiteStore: sqlite}
			service.store = store
			input := DebateBrowserResult{ClaimID: "browser-one", Body: "The retained paid answer", Verification: verifiedSettlement("").Verification}
			queueDebateDeliveryWithoutAcknowledgement(t, service, turn, input)
			store.fail.Store(true)
			service.runDebateBrowserTurn(run, turn, task, true)
			// The scheduler releases its active-work slot after workers stop.
			service.debateMu.Lock()
			service.debate = nil
			service.debateMu.Unlock()
			remove := func() error {
				if clearAll {
					return service.ClearChatData(t.Context())
				}
				return service.DeleteConversation(t.Context(), turn.DebateID)
			}
			store.failDeletion.Store(true)
			if err := remove(); !errors.Is(err, errDebateBrowserReceiptStorage) {
				t.Fatal("deletion failure did not reach its caller", err)
			}
			service.debateMu.Lock()
			retained := len(service.debatePending)
			service.debateMu.Unlock()
			if retained != 1 {
				t.Fatal("failed history deletion abandoned the paid receipt")
			}
			store.failDeletion.Store(false)
			if err := remove(); err != nil {
				t.Fatal(err)
			}
			service.debateMu.Lock()
			retained = len(service.debatePending)
			service.debateMu.Unlock()
			if retained != 0 || upstream.calls() != 0 {
				t.Fatal("explicit history deletion retained output or repeated inference")
			}
		})
	}
}
