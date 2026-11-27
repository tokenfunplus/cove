package chat

import (
	"context"
	"errors"
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
	queueDebateDeliveryWithoutAcknowledgement(t, service, turn, failure)
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
