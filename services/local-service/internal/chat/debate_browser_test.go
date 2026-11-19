package chat

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type delayedDebateClaimStore struct {
	*persistence.SQLiteStore
	delay     atomic.Bool
	saveDelay atomic.Bool
	deadline  time.Time
}

type canceledDebateClaimStore struct {
	*persistence.SQLiteStore
	cancel           context.CancelFunc
	cancelAfterWrite atomic.Bool
}

func (store *canceledDebateClaimStore) SaveDebateTurn(ctx context.Context, turn persistence.DebateTurn) error {
	err := store.SQLiteStore.SaveDebateTurn(ctx, turn)
	if err == nil && turn.UsageExpected && store.cancelAfterWrite.Swap(false) {
		store.cancel()
	}
	return err
}

func TestRejectedDebateBrowserClaimDoesNotInventUsageAfterRestart(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	t.Setenv("COVE_DATA_DIR", dataDir)
	databasePath := filepath.Join(dataDir, "debate.sqlite")
	sqlite, err := persistence.OpenSQLite(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlite.Close() })
	service, _, _ := browserDebateFixture(t, provider.PrivacyModePrivateTEE)
	claimCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	store := &canceledDebateClaimStore{SQLiteStore: sqlite, cancel: cancel}
	service.store = store
	session, err := service.StartDebate(ctx, debateInput())
	if err != nil {
		t.Fatal(err)
	}
	view := waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return len(view.Turns) == 2 })
	store.cancelAfterWrite.Store(true)
	if _, err := service.ClaimDebateBrowserTurn(claimCtx, session.ID, view.Turns[0].ID, "canceled-claim"); !errors.Is(err, context.Canceled) {
		t.Fatal("claim was not canceled after its durable usage write", err)
	}
	// Reopen the durable records before an old worker can normalize them.
	service.debateMu.Lock()
	reopened, err := persistence.OpenSQLite(databasePath)
	service.debateMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if err := reopened.RecoverInterruptedGenerations(ctx); err != nil {
		t.Fatal(err)
	}
	usage, err := reopened.ReadDebateUsage(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, seat := range usage {
		if seat.Calls != 0 || seat.MissingUsageCalls != 0 || seat.ActiveCalls != 0 {
			t.Fatal("restart counted a rejected claim as a model call", usage)
		}
	}
}

func TestUnclaimedDebateBrowserSummaryRemainsDueAfterResume(t *testing.T) {
	ctx := context.Background()
	service, _, _ := browserDebateFixture(t, provider.PrivacyModePrivateTEE)
	service.secureTimeout = 500 * time.Millisecond
	input := debateInput()
	input.Controls.SummaryEvery = 1
	session, err := service.StartDebate(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	view := waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return len(view.Turns) == 2 })
	for _, turn := range view.Turns {
		if _, err := service.ClaimDebateBrowserTurn(ctx, session.ID, turn.ID, "opening"); err != nil {
			t.Fatal(err)
		}
		if err := service.ProgressDebateBrowserTurn(ctx, session.ID, turn.ID, DebateBrowserProgress{ClaimID: "opening", Phase: "verifying_response"}); err != nil {
			t.Fatal(err)
		}
		if _, err := service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, DebateBrowserResult{ClaimID: "opening", Body: "A verified opening.", Verification: verifiedSettlement("").Verification}); err != nil {
			t.Fatal(err)
		}
	}
	view = waitDebate(t, service, session.ID, func(view persistence.DebateView) bool {
		return view.Session.Status == "paused" && !service.debateBusy()
	})
	if len(view.Turns) != 3 || view.Turns[2].Kind != "summary" || view.Turns[2].UsageExpected || view.Session.LastSummaryRound != 0 {
		t.Fatal("unclaimed summary advanced the attempted-summary cursor", view.Session.LastSummaryRound)
	}
	if _, err := service.ControlDebate(ctx, session.ID, "resume"); err != nil {
		t.Fatal(err)
	}
	view = waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return len(view.Turns) >= 4 })
	retry := view.Turns[3]
	if retry.Kind != "summary" || retry.Round != 1 {
		t.Fatal("Resume skipped the unclaimed stage summary")
	}
	if _, err := service.ClaimDebateBrowserTurn(ctx, session.ID, retry.ID, "summary-retry"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ControlDebate(ctx, session.ID, "pause"); err != nil {
		t.Fatal(err)
	}
	if err := service.ProgressDebateBrowserTurn(ctx, session.ID, retry.ID, DebateBrowserProgress{ClaimID: "summary-retry", Phase: "verifying_response"}); err != nil {
		t.Fatal(err)
	}
	body := `{"new_ideas":[{"text":"A shared boundary condition.","sources":[1,2]}],"position_changes":[],"open_questions":[]}`
	if _, err := service.SettleDebateBrowserTurn(ctx, session.ID, retry.ID, DebateBrowserResult{ClaimID: "summary-retry", Body: body, Verification: verifiedSettlement("").Verification}); err != nil {
		t.Fatal(err)
	}
	view = waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return !service.debateBusy() })
	if view.Session.LastSummaryRound != 1 || view.Session.Summary == nil || view.Usage.SummaryCalls != 1 {
		t.Fatal("the authorized summary retry did not settle independently", view.Usage)
	}
}

func (store *delayedDebateClaimStore) GetDebate(ctx context.Context, id string) (persistence.DebateSession, error) {
	if store.delay.Swap(false) {
		time.Sleep(max(0, time.Until(store.deadline)) + time.Millisecond)
	}
	return store.SQLiteStore.GetDebate(ctx, id)
}

func (store *delayedDebateClaimStore) SaveDebateTurn(ctx context.Context, turn persistence.DebateTurn) error {
	if store.saveDelay.Swap(false) {
		time.Sleep(max(0, time.Until(store.deadline)) + time.Millisecond)
	}
	return store.SQLiteStore.SaveDebateTurn(ctx, turn)
}

func TestDebateBrowserClaimRechecksDeadlineAfterUsageWrite(t *testing.T) {
	ctx := context.Background()
	service, sqlite, _ := browserDebateFixture(t, provider.PrivacyModePrivateTEE)
	store := &delayedDebateClaimStore{SQLiteStore: sqlite}
	service.store = store
	service.secureTimeout = 500 * time.Millisecond
	session, err := service.StartDebate(ctx, debateInput())
	if err != nil {
		t.Fatal(err)
	}
	view := waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return len(view.Turns) == 2 })
	service.debateMu.Lock()
	store.deadline = service.debate.browser[view.Turns[0].ID].deadline
	service.debateMu.Unlock()
	store.saveDelay.Store(true)
	if _, err := service.ClaimDebateBrowserTurn(ctx, session.ID, view.Turns[0].ID, "late-claim"); !errors.Is(err, ErrDebateState) {
		t.Fatal("slow usage write admitted an expired claim", err)
	}
	if store.saveDelay.Load() {
		t.Fatal("claim did not exercise the delayed usage write")
	}
	view = waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return !service.debateBusy() })
	if view.Usage.Calls != 0 || view.Usage.MissingUsageCalls != 0 {
		t.Fatal("a rejected claim was recorded as chargeable work")
	}
}

func TestDebateBrowserClaimRechecksDeadlineAfterSessionRead(t *testing.T) {
	ctx := context.Background()
	service, sqlite, _ := browserDebateFixture(t, provider.PrivacyModePrivateTEE)
	store := &delayedDebateClaimStore{SQLiteStore: sqlite}
	service.store = store
	service.secureTimeout = 500 * time.Millisecond
	session, err := service.StartDebate(ctx, debateInput())
	if err != nil {
		t.Fatal(err)
	}
	view := waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return len(view.Turns) == 2 })
	service.debateMu.Lock()
	store.deadline = service.debate.browser[view.Turns[0].ID].deadline
	service.debateMu.Unlock()
	store.delay.Store(true)
	if _, err := service.ClaimDebateBrowserTurn(ctx, session.ID, view.Turns[0].ID, "late-claim"); !errors.Is(err, ErrDebateState) {
		t.Fatal("slow session read admitted an expired claim", err)
	}
	if store.delay.Load() {
		t.Fatal("claim did not exercise the delayed session read")
	}
	waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return !service.debateBusy() })
}

func TestDebateVerificationFailureReleasesOtherUnclaimedOpenings(t *testing.T) {
	ctx := context.Background()
	service, store, _ := browserDebateFixture(t, provider.PrivacyModePrivateTEE)
	session, err := service.StartDebate(ctx, debateInput())
	if err != nil {
		t.Fatal(err)
	}
	view := waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return len(view.Turns) == 2 })
	turn := view.Turns[0]
	if _, err := service.ClaimDebateBrowserTurn(ctx, session.ID, turn.ID, "failed-browser"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, DebateBrowserResult{ClaimID: "failed-browser", Verification: persistence.GenerationVerification{Status: persistence.VerificationFailed, FailureCode: "response_verification_failed"}}); err != nil {
		t.Fatal(err)
	}
	waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return !service.debateBusy() })
	paused, err := store.ReadDebate(ctx, session.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if paused.Session.Status != "paused" || paused.Session.TotalTurns != 0 {
		t.Fatal("automatic pause retained active browser work")
	}
	for _, other := range paused.Turns {
		if other.ID != turn.ID && other.ErrorCode != "paused" {
			t.Fatal("unclaimed work waited for expiry after automatic pause")
		}
	}
}

func browserDebateFixture(t *testing.T, mode string) (*Service, *persistence.SQLiteStore, *debateTestProvider) {
	t.Helper()
	upstream := &debateTestProvider{}
	service, store := newDebateTest(t, upstream)
	profile := provider.Profile{ID: "fixture", Kind: provider.KindNearAIPreset, Name: "NearAI fixture", Endpoint: "https://cloud-stg-api.near.ai", AuthMethod: provider.AuthBearer}
	service.profiles = classifiedProviderSource{profileProviderSource: profileProviderSource{profiles: map[string]provider.Profile{"fixture": profile}}, metadata: provider.ModelMetadata{PrivacyMode: mode, Verifiable: mode == provider.PrivacyModePrivateTEE}}
	return service, store, upstream
}

func TestDebateBrowserStageSummaryRequiresVerificationAndAccountsForUsage(t *testing.T) {
	for _, test := range []struct {
		name             string
		verified         bool
		invalidCitations bool
	}{{name: "verified", verified: true}, {name: "rejected receipt"}, {name: "verified with invalid citations", verified: true, invalidCitations: true}} {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			service, _, upstream := browserDebateFixture(t, provider.PrivacyModePrivateTEE)
			budget := int64(90)
			input := debateInput()
			input.Controls = persistence.DebateControls{SummaryEvery: 1, AutoPause: true, TokenBudget: &budget}
			session, err := service.StartDebate(ctx, input)
			if err != nil {
				t.Fatal(err)
			}
			view := waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return len(view.Turns) == 2 })
			in, out := int64(20), int64(10)
			metrics := &persistence.GenerationMetrics{Source: "browser", InputTokens: &in, OutputTokens: &out}
			for _, turn := range view.Turns {
				if _, err := service.ClaimDebateBrowserTurn(ctx, session.ID, turn.ID, "fixture-browser"); err != nil {
					t.Fatal(err)
				}
				if err := service.ProgressDebateBrowserTurn(ctx, session.ID, turn.ID, DebateBrowserProgress{ClaimID: "fixture-browser", Phase: "verifying_response"}); err != nil {
					t.Fatal(err)
				}
				if _, err := service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, DebateBrowserResult{ClaimID: "fixture-browser", Body: "A completed public position.", Metrics: metrics, Verification: verifiedSettlement("").Verification}); err != nil {
					t.Fatal(err)
				}
			}
			view = waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return len(view.Turns) == 3 })
			turn := view.Turns[2]
			if turn.Kind != "summary" || turn.Execution != "browser" {
				t.Fatal("summary bypassed browser execution")
			}
			if _, err := service.ClaimDebateBrowserTurn(ctx, session.ID, turn.ID, "summary-browser"); err != nil {
				t.Fatal(err)
			}
			if err := service.ProgressDebateBrowserTurn(ctx, session.ID, turn.ID, DebateBrowserProgress{ClaimID: "summary-browser", Phase: "verifying_response"}); err != nil {
				t.Fatal(err)
			}
			body := `{"new_ideas":[{"text":"The participants proposed different evaluation criteria.","sources":[1,2]}],"position_changes":[],"open_questions":[]}`
			if test.invalidCitations {
				body = strings.Replace(body, "[1,2]", "[999999]", 1)
			}
			verification := verifiedSettlement("").Verification
			if !test.verified {
				verification = persistence.GenerationVerification{Status: persistence.VerificationFailed, FailureCode: "response_verification_failed"}
			}
			if _, err := service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, DebateBrowserResult{ClaimID: "summary-browser", Body: body, Metrics: metrics, Verification: verification}); err != nil {
				t.Fatal(err)
			}
			waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return !service.debateBusy() })
			current, err := service.ReadDebate(ctx, session.ID, 0)
			if err != nil {
				t.Fatal(err)
			}
			if current.Usage.Calls != 3 || current.Usage.SummaryCalls != 1 || current.Usage.InputTokens+current.Usage.OutputTokens != 90 || current.Session.TotalTurns != 2 || upstream.calls() != 0 {
				t.Fatal("browser summary usage or execution changed", current.Usage)
			}
			if (current.Session.Summary != nil) != (test.verified && !test.invalidCitations) || current.Session.LastSummaryRound != 1 {
				t.Fatal("unverified interpretation reached the stage summary")
			}
			last := current.Turns[len(current.Turns)-1]
			if test.verified && last.Body != body || !test.verified && last.Body != "" {
				t.Fatal("summary diagnostics did not preserve the verification boundary")
			}
		})
	}
}

func TestDebateBrowserClaimsVerificationAndPartialOpeningRecovery(t *testing.T) {
	for _, mode := range []string{provider.PrivacyModePrivateTEE, provider.PrivacyModeIncognito, provider.PrivacyModeChutes} {
		t.Run(mode, func(t *testing.T) {
			ctx := context.Background()
			service, store, upstream := browserDebateFixture(t, mode)
			session, err := service.StartDebate(ctx, debateInput())
			if err != nil || !session.BrowserRequired {
				t.Fatal("NearAI debate was not available", err)
			}
			view := waitDebate(t, service, session.ID, func(v persistence.DebateView) bool { return len(v.Turns) == 2 })
			if upstream.calls() != 0 {
				t.Fatal("NearAI was downgraded to ordinary HTTP inference")
			}
			for _, turn := range view.Turns {
				if _, err := service.ClaimDebateBrowserTurn(ctx, session.ID, turn.ID, "browser-one"); err != nil {
					t.Fatal(err)
				}
			}
			if _, err = service.ControlDebate(ctx, session.ID, "pause"); err != nil {
				t.Fatal(err)
			}
			for i, turn := range view.Turns {
				claimID := "browser-one"
				claimed, err := service.ClaimDebateBrowserTurn(ctx, session.ID, turn.ID, claimID)
				if err != nil || len(claimed.Messages) < 2 || turn.Execution != "browser" {
					t.Fatal("immutable browser request unavailable", err)
				}
				if _, err = service.ClaimDebateBrowserTurn(ctx, session.ID, turn.ID, "other-tab"); !errors.Is(err, ErrDebateState) {
					t.Fatal("another tab claimed the same turn", err)
				}
				if _, err = service.ClaimDebateBrowserTurn(ctx, session.ID, turn.ID, claimID); err != nil {
					t.Fatal("claim replay changed ownership", err)
				}
				if err = service.ProgressDebateBrowserTurn(ctx, session.ID, turn.ID, DebateBrowserProgress{ClaimID: claimID, Phase: "streaming", Body: "Unverified partial"}); err != nil {
					t.Fatal(err)
				}
				stored, err := store.ReadDebateTurn(ctx, session.ID, turn.ID)
				if err != nil || stored.Body != "" {
					t.Fatal("partial text reached storage", err)
				}
				verification := verifiedSettlement("").Verification
				if mode != provider.PrivacyModePrivateTEE {
					verification.Status, verification.SignatureKind = persistence.VerificationGateway, "gateway"
				}
				input := DebateBrowserResult{ClaimID: claimID, Body: "A verified public position", Verification: verification}
				if _, err = service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, input); !errors.Is(err, ErrInvalidDebate) {
					t.Fatal("settled before response verification", err)
				}
				if err = service.ProgressDebateBrowserTurn(ctx, session.ID, turn.ID, DebateBrowserProgress{ClaimID: claimID, Phase: "verifying_response", Body: input.Body}); err != nil {
					t.Fatal(err)
				}
				if mode == provider.PrivacyModePrivateTEE {
					gateway := input
					gateway.Verification.Status, gateway.Verification.SignatureKind = persistence.VerificationGateway, "gateway"
					if _, err = service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, gateway); !errors.Is(err, ErrInvalidDebate) {
						t.Fatal("Private TEE accepted gateway-only evidence", err)
					}
				}
				if i == 1 {
					input.Verification = persistence.GenerationVerification{Status: persistence.VerificationFailed, FailureCode: "response_verification_failed"}
				}
				settled, err := service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, input)
				if err != nil || settled.Verification == nil {
					t.Fatal("browser result was not saved", err)
				}
				if i == 1 && (settled.Body != "" || settled.State != "failed") {
					t.Fatal("unverified answer entered debate history")
				}
			}
			paused := waitDebate(t, service, session.ID, func(v persistence.DebateView) bool { return v.Session.Status == "paused" && !service.debateBusy() })
			if paused.Session.TotalTurns != 1 {
				t.Fatal("failed verification counted as a completed turn")
			}
			if _, err = service.ControlDebate(ctx, session.ID, "resume"); err != nil {
				t.Fatal(err)
			}
			resumed := waitDebate(t, service, session.ID, func(v persistence.DebateView) bool { return len(v.Turns) == 3 })
			last := resumed.Turns[2]
			if last.Seat != view.Turns[1].Seat {
				t.Fatal("resume repeated a verified opening")
			}
			if _, err = service.ClaimDebateBrowserTurn(ctx, session.ID, last.ID, "browser-one"); err != nil {
				t.Fatal(err)
			}
			if _, err = service.ControlDebate(ctx, session.ID, "stop"); err != nil {
				t.Fatal(err)
			}
			if _, err = service.SettleDebateBrowserTurn(ctx, session.ID, last.ID, DebateBrowserResult{ClaimID: "browser-one", Body: "late answer", Verification: verifiedSettlement("").Verification}); !errors.Is(err, ErrDebateState) {
				t.Fatal("stopped turn accepted a late browser result", err)
			}
			stored, err := store.ReadDebateTurn(ctx, session.ID, last.ID)
			if err != nil || stored.State != "stopped" || stored.Body != "" || stored.Verification != nil {
				t.Fatal("Stop preserved incomplete browser content", err)
			}
			if upstream.calls() != 0 {
				t.Fatal("browser inference used the unverified fallback")
			}
		})
	}
}

func TestDebateBrowserAbsenceExpiresAndReleasesActiveWork(t *testing.T) {
	service, store, upstream := browserDebateFixture(t, provider.PrivacyModePrivateTEE)
	service.secureTimeout = 30 * time.Millisecond
	session, err := service.StartDebate(context.Background(), debateInput())
	if err != nil {
		t.Fatal(err)
	}
	waitDebate(t, service, session.ID, func(v persistence.DebateView) bool { return v.Session.Status == "paused" && !service.debateBusy() })
	view, err := store.ReadDebate(context.Background(), session.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Turns) != 2 || view.Session.TotalTurns != 0 || upstream.calls() != 0 {
		t.Fatal("abandoned browser retained active work or performed inference")
	}
	expired := 0
	for _, turn := range view.Turns {
		if turn.ErrorCode == "browser_unavailable" {
			expired++
		}
		if (turn.ErrorCode != "browser_unavailable" && turn.ErrorCode != "paused") || !strings.Contains(strings.ToLower(turn.ErrorMessage), "resume") {
			t.Fatal("expiry did not explain recovery")
		}
	}
	if expired == 0 {
		t.Fatal("fixture did not observe browser expiry")
	}
}

func TestDebatePauseRejectsUnclaimedBrowserWorkAndReleasesReservation(t *testing.T) {
	ctx := context.Background()
	service, _, upstream := browserDebateFixture(t, provider.PrivacyModePrivateTEE)
	session, err := service.StartDebate(ctx, debateInput())
	if err != nil {
		t.Fatal(err)
	}
	view := waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return len(view.Turns) == 2 })
	if _, err := service.ControlDebate(ctx, session.ID, "pause"); err != nil {
		t.Fatal(err)
	}
	for _, turn := range view.Turns {
		if _, err := service.ClaimDebateBrowserTurn(ctx, session.ID, turn.ID, "late-browser"); !errors.Is(err, ErrDebateState) {
			t.Fatal("Pause admitted a new browser call", err)
		}
	}
	paused := waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return !service.debateBusy() })
	if paused.Session.Status != "paused" || paused.Session.TotalTurns != 0 || upstream.calls() != 0 {
		t.Fatal("unclaimed tasks retained the work reservation")
	}
}

func TestDebateAcceptedBrowserReceiptWinsWhenWorkerObservesExpiry(t *testing.T) {
	ctx := context.Background()
	service, store, _ := browserDebateFixture(t, provider.PrivacyModeIncognito)
	input := debateInput()
	session, err := store.CreateDebate(ctx, persistence.DebateSession{ClientRequestID: input.ClientRequestID, Topic: input.Topic, Seats: input.Seats, Rules: input.Rules, Status: "running", Round: 1, OpeningDone: []bool{false, false}})
	if err != nil {
		t.Fatal(err)
	}
	turn, err := store.BeginDebateTurn(ctx, persistence.DebateTurn{DebateID: session.ID, Seat: 0, Round: 1, State: "streaming", Execution: "browser", Phase: "verifying_response"})
	if err != nil {
		t.Fatal(err)
	}
	runContext, cancel := context.WithCancel(ctx)
	defer cancel()
	task := &debateBrowserTurn{claimID: "browser-one", deadline: time.Now().Add(time.Minute), paused: make(chan struct{}), result: make(chan DebateBrowserResult, 1), done: make(chan struct{})}
	run := &debateRun{id: session.ID, ctx: runContext, cancel: cancel, turns: map[string]persistence.DebateTurn{turn.ID: turn}, browser: map[string]*debateBrowserTurn{turn.ID: task}}
	service.debate = run
	defer func() { service.debateMu.Lock(); service.debate = nil; service.debateMu.Unlock() }()
	settled := make(chan error, 1)
	go func() {
		_, err := service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, DebateBrowserResult{ClaimID: "browser-one", Body: "Accepted verified answer", Verification: verifiedSettlement("").Verification})
		settled <- err
	}()
	deadline := time.Now().Add(time.Second)
	for {
		service.debateMu.Lock()
		accepted := task.submitted
		if accepted {
			task.deadline = time.Now().Add(-time.Second)
		}
		service.debateMu.Unlock()
		if accepted {
			break
		}
		select {
		case err := <-settled:
			t.Fatal("receipt was rejected", err)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("receipt was not accepted")
		}
		time.Sleep(time.Millisecond)
	}
	// Both the queued receipt and the worker's deadline are ready now.
	service.runDebateBrowserTurn(run, turn, task, true)
	if err := <-settled; err != nil {
		t.Fatal(err)
	}
	saved, err := store.ReadDebateTurn(ctx, session.ID, turn.ID)
	if err != nil || saved.State != "completed" || saved.Body != "Accepted verified answer" {
		t.Fatal("accepted receipt lost to expiry", err)
	}
}

func TestDebateBrowserSettlementAfterDeadlineIsRejected(t *testing.T) {
	ctx := context.Background()
	service, _, _ := browserDebateFixture(t, provider.PrivacyModePrivateTEE)
	session, err := service.StartDebate(ctx, debateInput())
	if err != nil {
		t.Fatal(err)
	}
	view := waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return len(view.Turns) == 2 })
	turn := view.Turns[0]
	if _, err := service.ClaimDebateBrowserTurn(ctx, session.ID, turn.ID, "browser-one"); err != nil {
		t.Fatal(err)
	}
	if err := service.ProgressDebateBrowserTurn(ctx, session.ID, turn.ID, DebateBrowserProgress{ClaimID: "browser-one", Phase: "verifying_response"}); err != nil {
		t.Fatal(err)
	}
	service.debateMu.Lock()
	service.debate.browser[turn.ID].deadline = time.Now().Add(-time.Second)
	service.debateMu.Unlock()
	if _, err := service.SettleDebateBrowserTurn(ctx, session.ID, turn.ID, DebateBrowserResult{ClaimID: "browser-one", Body: "Too late", Verification: verifiedSettlement("").Verification}); !errors.Is(err, ErrDebateState) {
		t.Fatal("late receipt was accepted", err)
	}
}

func TestDebateUnknownNearAIModeCannotFallBackToOrdinaryCompletion(t *testing.T) {
	service, _, upstream := browserDebateFixture(t, "unsupported-mode")
	if _, err := service.StartDebate(context.Background(), debateInput()); !errors.Is(err, provider.ErrModelUnavailable) {
		t.Fatal("unknown NearAI mode was accepted", err)
	}
	if upstream.calls() != 0 {
		t.Fatal("unknown NearAI mode used ordinary HTTP inference")
	}
}
