package chat

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

var ErrDebateBudget = errors.New("review the debate budget before resuming")

func validDebateControls(c persistence.DebateControls, seats int) bool {
	if c.Version < 0 || c.SummaryEvery < 0 || c.SummaryEvery > 10 || c.SummarySeat < 0 || c.SummarySeat >= seats {
		return false
	}
	if c.TurnDelayMS != nil && (*c.TurnDelayMS < 0 || *c.TurnDelayMS > 60000) ||
		c.TokenBudget != nil && (*c.TokenBudget < 1 || *c.TokenBudget > 1_000_000_000_000) ||
		c.CostBudgetUSD != nil && (!finiteDebateRate(*c.CostBudgetUSD) || *c.CostBudgetUSD <= 0) ||
		len(c.Rates) != 0 && len(c.Rates) != seats {
		return false
	}
	for _, rate := range c.Rates {
		for _, value := range []*float64{rate.InputPerMillion, rate.OutputPerMillion} {
			if value != nil && !finiteDebateRate(*value) {
				return false
			}
		}
	}
	if c.CostBudgetUSD != nil {
		if len(c.Rates) != seats {
			return false
		}
		for _, rate := range c.Rates {
			if rate.InputPerMillion == nil || rate.OutputPerMillion == nil {
				return false
			}
		}
	}
	return true
}

func finiteDebateRate(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 1_000_000
}

func (service *Service) readDebateUsage(ctx context.Context, session persistence.DebateSession) (*persistence.DebateUsage, error) {
	store, _ := service.debateStore()
	seats, err := store.ReadDebateUsage(ctx, session.ID)
	if err != nil {
		return nil, err
	}
	usage := &persistence.DebateUsage{CostComplete: true}
	for _, seat := range seats {
		usage.Calls += seat.Calls
		usage.SummaryCalls += seat.SummaryCalls
		usage.ActiveCalls += seat.ActiveCalls
		usage.InputTokens += seat.InputTokens
		usage.OutputTokens += seat.OutputTokens
		usage.MissingUsageCalls += seat.MissingUsageCalls
		if seat.Calls == 0 {
			continue
		}
		if seat.Seat < 0 || seat.Seat >= len(session.Controls.Rates) || session.Controls.Rates[seat.Seat].InputPerMillion == nil || session.Controls.Rates[seat.Seat].OutputPerMillion == nil {
			usage.UnpricedCalls += seat.Calls
			continue
		}
		rate := session.Controls.Rates[seat.Seat]
		usage.EstimatedCostUSD += (float64(seat.InputTokens)**rate.InputPerMillion + float64(seat.OutputTokens)**rate.OutputPerMillion) / 1_000_000
	}
	usage.CostComplete = usage.MissingUsageCalls == 0 && usage.UnpricedCalls == 0
	switch {
	case session.Controls.TokenBudget != nil && usage.InputTokens+usage.OutputTokens >= *session.Controls.TokenBudget:
		usage.BudgetStatus = "token_budget"
	case session.Controls.CostBudgetUSD != nil && usage.EstimatedCostUSD >= *session.Controls.CostBudgetUSD:
		usage.BudgetStatus = "cost_budget"
	case (session.Controls.TokenBudget != nil || session.Controls.CostBudgetUSD != nil) && usage.MissingUsageCalls > 0:
		usage.BudgetStatus = "usage_missing"
	case session.Controls.CostBudgetUSD != nil && usage.UnpricedCalls > 0:
		usage.BudgetStatus = "rates_missing"
	}
	return usage, nil
}

func debateBudgetNotice(status string) string {
	switch status {
	case "token_budget":
		return "Token budget reached. Raise the limit or disable automatic pause to continue."
	case "cost_budget":
		return "Estimated cost budget reached. Raise the limit or disable automatic pause to continue."
	case "usage_missing":
		return "Some calls have no reported token usage. Disable automatic pause to continue without a complete estimate."
	case "rates_missing":
		return "Cost rates are missing. Add rates or disable automatic pause to continue."
	}
	return ""
}

// Caller holds debateMu. Active requests drain; new requests cannot pass this gate.
func (service *Service) checkDebateBudgetLocked(run *debateRun, session *persistence.DebateSession) bool {
	if !session.Controls.AutoPause || session.Controls.TokenBudget == nil && session.Controls.CostBudgetUSD == nil {
		return true
	}
	usage, err := service.readDebateUsage(context.Background(), *session)
	if err != nil {
		service.pauseDebateOnStorageErrorLocked(run)
		return false
	}
	if usage.BudgetStatus == "" {
		return true
	}
	session.Status = "pausing"
	session.Notice = debateBudgetNotice(usage.BudgetStatus)
	store, _ := service.debateStore()
	if err := store.SaveDebate(context.Background(), *session); err != nil {
		service.pauseDebateOnStorageErrorLocked(run)
	}
	pauseUnclaimedDebateBrowserTurns(run)
	service.notifyDebateLocked(run.id)
	return false
}

func (service *Service) UpdateDebateControls(ctx context.Context, id string, input persistence.DebateControls) (persistence.DebateSession, error) {
	store, err := service.debateStore()
	if err != nil {
		return persistence.DebateSession{}, err
	}
	service.debateMu.Lock()
	defer service.debateMu.Unlock()
	session, err := store.GetDebate(ctx, id)
	if err != nil {
		return session, err
	}
	if session.Status == "stopped" || input.Version != session.Controls.Version {
		return session, ErrDebateState
	}
	if !validDebateControls(input, len(session.Seats)) {
		return session, ErrInvalidDebateControls
	}
	input.Version++
	previousDelay := service.debateTurnDelay(session)
	session.Controls = input
	if session.NextTurnAt != nil && service.debateTurnDelay(session) != previousDelay {
		at := time.Now().Add(service.debateTurnDelay(session))
		session.NextTurnAt = &at
	}
	usage, err := service.readDebateUsage(ctx, session)
	if err != nil {
		return session, err
	}
	if input.AutoPause && usage.BudgetStatus != "" {
		if service.debate != nil && service.debate.id == id {
			session.Status = "pausing"
		} else {
			session.Status = "paused"
		}
		session.Notice = debateBudgetNotice(usage.BudgetStatus)
	} else {
		for _, status := range []string{"token_budget", "cost_budget", "usage_missing", "rates_missing"} {
			if session.Notice == debateBudgetNotice(status) {
				session.Notice = ""
			}
		}
	}
	if err = store.SaveDebate(ctx, session); err != nil {
		if input.AutoPause && usage.BudgetStatus != "" && service.debate != nil && service.debate.id == id {
			service.pauseDebateOnStorageErrorLocked(service.debate)
		}
		return session, err
	}
	if run := service.debate; run != nil && run.id == id {
		if session.Status == "pausing" {
			pauseUnclaimedDebateBrowserTurns(run)
		}
		select {
		case run.wake <- struct{}{}:
		default:
		}
	}
	service.notifyDebateLocked(id)
	return session, nil
}

var ErrInvalidDebateControls = errors.New("invalid debate summary, budget, or pacing settings")

func (service *Service) debateTurnDelay(session persistence.DebateSession) time.Duration {
	if session.Controls.TurnDelayMS != nil {
		return time.Duration(*session.Controls.TurnDelayMS) * time.Millisecond
	}
	return service.debateDelay
}
