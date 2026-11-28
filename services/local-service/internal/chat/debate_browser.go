package chat

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

// A browser executes only a turn already scheduled by Chat. One claimant can
// start it; reloads and additional tabs cannot repeat a chargeable call.
type debateBrowserTurn struct {
	claimID   string
	submitted bool
	receipt   string
	err       error
	expired   bool
	deadline  time.Time
	paused    chan struct{}
	result    chan DebateBrowserResult
	done      chan struct{}
}

// Pending receipts outlive worker cancellation and never authorize another
// Provider call. Admission limits this map to one debate's active turns.
type pendingDebateBrowserResult struct {
	run   *debateRun
	turn  persistence.DebateTurn
	blind bool
}

type DebateBrowserContext struct {
	Turn     persistence.DebateTurn             `json:"turn"`
	Messages []persistence.DebateContextMessage `json:"messages"`
}

type DebateBrowserProgress struct {
	ClaimID   string `json:"claim_id"`
	Phase     string `json:"phase"`
	Body      string `json:"body"`
	Reasoning string `json:"reasoning,omitempty"`
}

type DebateBrowserResult struct {
	ClaimID      string                             `json:"claim_id"`
	Body         string                             `json:"body"`
	Reasoning    string                             `json:"reasoning,omitempty"`
	Metrics      *persistence.GenerationMetrics     `json:"metrics,omitempty"`
	Verification persistence.GenerationVerification `json:"verification"`
}

// Caller holds debateMu. The cancellation check rejects commands before the
// worker has finished unwinding Stop, shutdown, or data deletion.
func (service *Service) activeDebateBrowserTurn(id, turnID string) (*debateRun, *debateBrowserTurn, error) {
	run := service.debate
	if run == nil || run.id != id || run.ctx.Err() != nil {
		return nil, nil, ErrDebateState
	}
	task := run.browser[turnID]
	if task == nil {
		return nil, nil, ErrDebateState
	}
	return run, task, nil
}

func (service *Service) ClaimDebateBrowserTurn(ctx context.Context, id, turnID, claimID string) (DebateBrowserContext, error) {
	if strings.TrimSpace(claimID) == "" || len(claimID) > 128 {
		return DebateBrowserContext{}, ErrInvalidDebate
	}
	service.debateMu.Lock()
	defer service.debateMu.Unlock()
	if err := ctx.Err(); err != nil {
		return DebateBrowserContext{}, err
	}
	run, task, err := service.activeDebateBrowserTurn(id, turnID)
	if err != nil || task != nil && (task.submitted || task.claimID != "" && task.claimID != claimID) {
		return DebateBrowserContext{}, ErrDebateState
	}
	if task.claimID == "" {
		store, _ := service.debateStore()
		session, err := store.GetDebate(ctx, id)
		if err != nil {
			return DebateBrowserContext{}, err
		}
		if session.Status != "running" {
			return DebateBrowserContext{}, ErrDebateState
		}
	}
	if task.expired || !time.Now().Before(task.deadline) {
		return DebateBrowserContext{}, ErrDebateState
	}
	turn := run.turns[turnID]
	if task.claimID == "" {
		turn.UsageExpected = true
		store, _ := service.debateStore()
		if err := store.SaveDebateTurn(ctx, turn); err != nil {
			service.pauseDebateOnStorageErrorLocked(run)
			return DebateBrowserContext{}, err
		}
		reject := func(cause error) (DebateBrowserContext, error) {
			cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
			defer cancel()
			turn.UsageExpected = false
			if err := store.SaveDebateTurn(cleanupCtx, turn); err != nil {
				service.pauseDebateOnStorageErrorLocked(run)
				return DebateBrowserContext{}, errors.Join(cause, err)
			}
			return DebateBrowserContext{}, cause
		}
		if ctx.Err() != nil {
			return reject(ctx.Err())
		}
		if !time.Now().Before(task.deadline) {
			return reject(ErrDebateState)
		}
		run.turns[turnID] = turn
	}
	task.claimID = claimID
	return DebateBrowserContext{Turn: turn, Messages: turn.Context}, nil
}

// Caller holds debateMu. Automatic and explicit pauses share this admission boundary.
func pauseUnclaimedDebateBrowserTurns(run *debateRun) {
	for _, task := range run.browser {
		if task.claimID == "" && !task.expired {
			task.expired = true
			close(task.paused)
		}
	}
}

func debateBrowserPhase(phase string) int {
	switch phase {
	case "verifying_environment":
		return 1
	case "streaming":
		return 2
	case "verifying_response":
		return 3
	}
	return 0
}

func (service *Service) ProgressDebateBrowserTurn(ctx context.Context, id, turnID string, input DebateBrowserProgress) error {
	if debateBrowserPhase(input.Phase) == 0 || len(input.Body)+len(input.Reasoning) > 256<<10 {
		return ErrInvalidDebate
	}
	service.debateMu.Lock()
	defer service.debateMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	run, task, err := service.activeDebateBrowserTurn(id, turnID)
	if err != nil || input.ClaimID == "" || task.claimID != input.ClaimID || task.submitted {
		return ErrDebateState
	}
	turn := run.turns[turnID]
	if debateBrowserPhase(input.Phase) < debateBrowserPhase(turn.Phase) {
		return ErrDebateState
	}
	turn.Phase, turn.Body, turn.Reasoning = input.Phase, input.Body, input.Reasoning
	run.turns[turnID] = turn
	service.notifyDebateLocked(id)
	return nil
}

func (service *Service) SettleDebateBrowserTurn(ctx context.Context, id, turnID string, input DebateBrowserResult) (persistence.DebateTurn, error) {
	if input.ClaimID == "" || len(input.ClaimID) > 128 || len(input.Body)+len(input.Reasoning) > 256<<10 || persistence.ValidateBrowserSettlement(persistence.SecureGenerationSettlementInput{Body: input.Body, Metrics: input.Metrics, Verification: input.Verification}) != nil {
		return persistence.DebateTurn{}, ErrInvalidDebate
	}
	// Freeze all nested evidence and measurements as well as the answer. The
	// digest binds a delivery replay to both its original claimant and result.
	payload, err := json.Marshal(input)
	if err != nil {
		return persistence.DebateTurn{}, ErrInvalidDebate
	}
	digest := sha256.Sum256(payload)
	receipt := hex.EncodeToString(digest[:])
	input = DebateBrowserResult{}
	if err := json.Unmarshal(payload, &input); err != nil {
		return persistence.DebateTurn{}, ErrInvalidDebate
	}
	service.debateMu.Lock()
	if err := ctx.Err(); err != nil {
		service.debateMu.Unlock()
		return persistence.DebateTurn{}, err
	}
	if pending := service.debatePending[turnID]; pending != nil && pending.run.id == id {
		if pending.turn.BrowserReceipt != receipt {
			service.debateMu.Unlock()
			return persistence.DebateTurn{}, ErrDebateState
		}
		turn, err := service.persistPendingDebateBrowserResultLocked(turnID)
		service.debateMu.Unlock()
		return turn, err
	}
	run, task, err := service.activeDebateBrowserTurn(id, turnID)
	if err != nil || input.ClaimID == "" || task.claimID != input.ClaimID {
		store, _ := service.debateStore()
		turn, readErr := store.ReadDebateTurn(ctx, id, turnID)
		service.debateMu.Unlock()
		if readErr != nil {
			return persistence.DebateTurn{}, readErr
		}
		if turn.BrowserReceipt == receipt {
			return turn, nil
		}
		return persistence.DebateTurn{}, ErrDebateState
	}
	if task.submitted && task.receipt != receipt {
		service.debateMu.Unlock()
		return persistence.DebateTurn{}, ErrDebateState
	}
	turn := run.turns[turnID]
	success := input.Verification.Status == persistence.VerificationModel || input.Verification.Status == persistence.VerificationGateway
	if success && (turn.Phase != "verifying_response" || turn.Snapshot.PrivacyMode == provider.PrivacyModePrivateTEE && input.Verification.Status != persistence.VerificationModel) {
		service.debateMu.Unlock()
		return persistence.DebateTurn{}, ErrInvalidDebate
	}
	if !task.submitted {
		if task.expired || !time.Now().Before(task.deadline) {
			service.debateMu.Unlock()
			return persistence.DebateTurn{}, ErrDebateState
		}
		task.submitted = true
		task.receipt = receipt
		task.result <- input
	}
	service.debateMu.Unlock()
	select {
	case <-task.done:
		service.debateMu.Lock()
		err := task.err
		service.debateMu.Unlock()
		if err != nil {
			return persistence.DebateTurn{}, err
		}
		store, _ := service.debateStore()
		return store.ReadDebateTurn(ctx, id, turnID)
	case <-ctx.Done():
		return persistence.DebateTurn{}, ctx.Err()
	}
}

// Caller holds debateMu. A failed transaction retains exactly the original
// receipt; replay never replaces it with cleanup or advances a cursor twice.
func (service *Service) persistPendingDebateBrowserResultLocked(turnID string) (persistence.DebateTurn, error) {
	pending := service.debatePending[turnID]
	status, code, message := "completed", "", ""
	if verification := pending.turn.Verification; verification.Status != persistence.VerificationModel && verification.Status != persistence.VerificationGateway {
		status, code, message = "failed", "verification_failed", "Browser verification did not complete. Check the connection and resume to retry."
	}
	turn, err := service.finishDebateTurnLocked(pending.run, pending.turn, status, code, message, pending.blind)
	if err != nil {
		service.pauseDebateOnStorageErrorLocked(pending.run)
		return persistence.DebateTurn{}, err
	}
	delete(service.debatePending, turnID)
	return turn, nil
}

// Resume and Stop recover an accepted result before changing its session.
// Starting a different debate remains blocked while any result is unsaved.
// Caller holds debateMu.
func (service *Service) recoverDebateBrowserResultsLocked(id string) error {
	for turnID, pending := range service.debatePending {
		if pending.run.id != id {
			return ErrDebateState
		}
		if _, err := service.persistPendingDebateBrowserResultLocked(turnID); err != nil {
			return err
		}
	}
	return nil
}

// Explicit history deletion abandons only matching unsaved output, after the
// durable deletion succeeds. A failed deletion retains its recovery owner.
func (service *Service) forgetPendingDebateBrowserResults(id string) {
	service.debateMu.Lock()
	defer service.debateMu.Unlock()
	for turnID, pending := range service.debatePending {
		if id == "" || pending.run.id == id {
			delete(service.debatePending, turnID)
		}
	}
}

func (service *Service) runDebateBrowserTurn(run *debateRun, turn persistence.DebateTurn, task *debateBrowserTurn, blind bool) {
	defer func() {
		service.debateMu.Lock()
		delete(run.browser, turn.ID)
		close(task.done)
		service.debateMu.Unlock()
	}()
	service.debateMu.Lock()
	deadline := task.deadline
	service.debateMu.Unlock()
	ctx, cancel := context.WithDeadline(run.ctx, deadline)
	defer cancel()
	var accepted *DebateBrowserResult
	select {
	case input := <-task.result:
		accepted = &input
	case <-ctx.Done():
	case <-task.paused:
	}
	// Acceptance and expiry share debateMu. A receipt accepted before the
	// deadline wins even when the worker observes the timer at the same time.
	service.debateMu.Lock()
	if accepted == nil && task.submitted {
		input := <-task.result
		accepted = &input
	}
	task.expired = true
	turn.Phase = run.turns[turn.ID].Phase
	paused := false
	select {
	case <-task.paused:
		paused = true
	default:
	}
	service.debateMu.Unlock()
	if accepted != nil {
		input := *accepted
		turn.Body, turn.Reasoning, turn.Metrics = input.Body, input.Reasoning, input.Metrics
		verification := input.Verification
		turn.Verification = &verification
		turn.BrowserReceipt = task.receipt
		if verification.Status == persistence.VerificationModel || verification.Status == persistence.VerificationGateway {
			if verification.VerifiedAt == nil {
				now := time.Now().UTC()
				verification.VerifiedAt = &now
			}
		}
		service.debateMu.Lock()
		if service.debatePending == nil {
			service.debatePending = map[string]*pendingDebateBrowserResult{}
		}
		service.debatePending[turn.ID] = &pendingDebateBrowserResult{run: run, turn: turn, blind: blind}
		_, task.err = service.persistPendingDebateBrowserResultLocked(turn.ID)
		service.debateMu.Unlock()
	} else if paused {
		service.finishDebateTurn(run, turn, "failed", "paused", "Paused before browser inference started. Resume to retry.", blind)
	} else {
		service.finishDebateTurn(run, turn, "failed", "browser_unavailable", "Keep this debate open for NearAI verification, then resume to retry.", blind)
	}
}
