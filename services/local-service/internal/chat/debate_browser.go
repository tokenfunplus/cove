package chat

import (
	"context"
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
	result    chan DebateBrowserResult
	done      chan struct{}
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
	task.claimID = claimID
	turn := run.turns[turnID]
	return DebateBrowserContext{Turn: turn, Messages: turn.Context}, nil
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
	if len(input.Body)+len(input.Reasoning) > 256<<10 || persistence.ValidateBrowserSettlement(persistence.SecureGenerationSettlementInput{Body: input.Body, Metrics: input.Metrics, Verification: input.Verification}) != nil {
		return persistence.DebateTurn{}, ErrInvalidDebate
	}
	service.debateMu.Lock()
	run, task, err := service.activeDebateBrowserTurn(id, turnID)
	if err != nil || input.ClaimID == "" || task.claimID != input.ClaimID {
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
		task.submitted = true
		task.result <- input
	}
	service.debateMu.Unlock()
	select {
	case <-task.done:
		return service.ReadDebateTurn(ctx, id, turnID)
	case <-ctx.Done():
		return persistence.DebateTurn{}, ctx.Err()
	}
}

func (service *Service) runDebateBrowserTurn(run *debateRun, turn persistence.DebateTurn, task *debateBrowserTurn, blind bool) {
	defer func() {
		service.debateMu.Lock()
		delete(run.browser, turn.ID)
		close(task.done)
		service.debateMu.Unlock()
	}()
	ctx, cancel := context.WithTimeout(run.ctx, service.secureTimeout)
	defer cancel()
	select {
	case input := <-task.result:
		service.debateMu.Lock()
		turn.Phase = run.turns[turn.ID].Phase
		service.debateMu.Unlock()
		turn.Body, turn.Reasoning, turn.Metrics = input.Body, input.Reasoning, input.Metrics
		verification := input.Verification
		turn.Verification = &verification
		if verification.Status == persistence.VerificationModel || verification.Status == persistence.VerificationGateway {
			if verification.VerifiedAt == nil {
				now := time.Now().UTC()
				verification.VerifiedAt = &now
			}
			service.finishDebateTurn(run, turn, "completed", "", "", blind)
		} else {
			service.finishDebateTurn(run, turn, "failed", "verification_failed", "Browser verification did not complete. Check the connection and resume to retry.", blind)
		}
	case <-ctx.Done():
		service.finishDebateTurn(run, turn, "failed", "browser_unavailable", "Keep this debate open for NearAI verification, then resume to retry.", blind)
	}
}
