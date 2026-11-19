package chat

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type summarizingDebateProvider struct {
	debateTestProvider
	invalid      atomic.Bool
	missingUsage atomic.Bool
}

const invalidSummaryFixture = `{"new_ideas":[{"text":"Unsupported claim","sources":[999999]}],"position_changes":[],"open_questions":[]}`

func (p *summarizingDebateProvider) Stream(ctx context.Context, input provider.CompletionInput) (provider.CompletionStream, error) {
	stream, err := p.debateTestProvider.Stream(ctx, input)
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(input.Messages[0].Content, "Create a stage summary") {
		matches := regexp.MustCompile(`\[Turn (\d+),`).FindAllStringSubmatch(input.Messages[1].Content, -1)
		sequence, _ := strconv.ParseInt(matches[len(matches)-1][1], 10, 64)
		body, _ := json.Marshal(map[string]any{"new_ideas": []any{map[string]any{"text": "The participants introduced a measurable boundary condition.", "sources": []int64{sequence}}}, "position_changes": []any{}, "open_questions": []any{map[string]any{"text": "What evidence would separate these positions?", "sources": []int64{sequence}}}})
		stream.(*debateTestStream).body = string(body)
		if p.invalid.Load() {
			stream.(*debateTestStream).body = invalidSummaryFixture
		}
	}
	return &debateUsageTestStream{CompletionStream: stream, missing: p.missingUsage.Load()}, nil
}

type debateUsageTestStream struct {
	provider.CompletionStream
	missing bool
}

func (s *debateUsageTestStream) Recv(ctx context.Context) (provider.Event, error) {
	event, err := s.CompletionStream.Recv(ctx)
	if s.missing {
		event.Usage = nil
	}
	return event, err
}

func TestDebateStageSummaryAndCostBudgetShareTheCallLifecycle(t *testing.T) {
	ctx := context.Background()
	upstream := &summarizingDebateProvider{}
	service, store := newDebateTest(t, &upstream.debateTestProvider)
	service.provider = upstream
	input := debateInput()
	inRate, outRate, budget := 2.0, 4.0, 0.0002
	input.Controls = persistence.DebateControls{SummaryEvery: 1, SummarySeat: 1, AutoPause: true, CostBudgetUSD: &budget, Rates: []persistence.DebateRate{{InputPerMillion: &inRate, OutputPerMillion: &outRate}, {InputPerMillion: &inRate, OutputPerMillion: &outRate}}}
	session, err := service.StartDebate(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	waitDebate(t, service, session.ID, func(view persistence.DebateView) bool {
		return view.Session.Status == "paused" && !service.debateBusy()
	})
	view, err := service.ReadDebate(ctx, session.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if upstream.calls() != 3 || view.Session.TotalTurns != 2 || view.Usage.Calls != 3 || view.Usage.SummaryCalls != 1 || view.Usage.BudgetStatus != "cost_budget" || !view.Usage.CostComplete || math.Abs(view.Usage.EstimatedCostUSD-0.00024) > 1e-10 {
		t.Fatalf("summary was not accounted independently: %+v", view)
	}
	if view.Session.Summary == nil || view.Session.Summary.FromRound != 1 || view.Session.Summary.ThroughRound != 1 || view.Session.Summary.Seat != 1 {
		t.Fatal("stage summary missing")
	}
	summaryTurn := view.Turns[2]
	if summaryTurn.Kind != "summary" || summaryTurn.Summary == nil || summaryTurn.Configuration.GenerationParameters.MaxTokens == nil || *summaryTurn.Configuration.GenerationParameters.MaxTokens != 2048 {
		t.Fatal("summary request lost its identity or bound")
	}
	for _, point := range summaryTurn.Summary.NewIdeas {
		for _, source := range point.Sources {
			turn, err := store.ReadDebateTurn(ctx, session.ID, source.TurnID)
			if err != nil || turn.Kind == "summary" || turn.Sequence != source.Sequence || turn.State != "completed" {
				t.Fatal("summary citation is not an original completed turn", err)
			}
		}
	}
	if _, err := service.ControlDebate(ctx, session.ID, "resume"); !errors.Is(err, ErrDebateBudget) {
		t.Fatal("Resume bypassed the cost limit", err)
	}
	next := view.Session.Controls
	next.AutoPause = false
	next.SummaryEvery = 0
	if _, err := service.UpdateDebateControls(ctx, session.ID, next); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ControlDebate(ctx, session.ID, "step"); err != nil {
		t.Fatal(err)
	}
	waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return !service.debateBusy() })
	contextTurns, err := store.LoadDebateContext(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, turn := range contextTurns {
		if turn.Kind == "summary" {
			t.Fatal("generated interpretation entered model discussion context")
		}
	}
	current, err := service.ReadDebate(ctx, session.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, turn := range current.Turns {
		if turn.Round > 1 && turn.Kind != "summary" {
			for _, id := range turn.ContextIDs {
				if id == summaryTurn.ID {
					t.Fatal("summary was passed as participant evidence")
				}
			}
		}
	}
}

func TestDebateInvalidSummaryPausesWithoutInventedCitationsOrAutomaticRetry(t *testing.T) {
	ctx := context.Background()
	upstream := &summarizingDebateProvider{}
	upstream.invalid.Store(true)
	service, _ := newDebateTest(t, &upstream.debateTestProvider)
	service.provider = upstream
	input := debateInput()
	input.Controls.SummaryEvery = 1
	session, err := service.StartDebate(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	waitDebate(t, service, session.ID, func(view persistence.DebateView) bool {
		return view.Session.Status == "paused" && !service.debateBusy()
	})
	view, err := service.ReadDebate(ctx, session.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	last := view.Turns[len(view.Turns)-1]
	if upstream.calls() != 3 || last.Kind != "summary" || last.State != "failed" || last.Body != invalidSummaryFixture || last.ErrorCode != "invalid_summary" || last.Summary != nil || view.Session.Summary != nil || view.Session.LastSummaryRound != 1 || view.Session.TotalTurns != 2 {
		t.Fatal("invalid summary was accepted or repeated")
	}
	if _, err := service.ControlDebate(ctx, session.ID, "step"); err != nil {
		t.Fatal(err)
	}
	waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return !service.debateBusy() })
	if upstream.calls() != 4 {
		t.Fatal("explicit recovery repeated a failed summary")
	}
}

func TestDebateTokenBudgetAndMissingUsageRequireExplicitRecovery(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(strconv.FormatBool(missing), func(t *testing.T) {
			ctx := context.Background()
			upstream := &summarizingDebateProvider{}
			upstream.missingUsage.Store(missing)
			service, _ := newDebateTest(t, &upstream.debateTestProvider)
			service.provider = upstream
			budget := int64(30)
			if missing {
				budget = 1_000_000
			}
			input := debateInput()
			input.Controls = persistence.DebateControls{AutoPause: true, TokenBudget: &budget}
			session, err := service.StartDebate(ctx, input)
			if err != nil {
				t.Fatal(err)
			}
			waitDebate(t, service, session.ID, func(view persistence.DebateView) bool {
				return view.Session.Status == "paused" && !service.debateBusy()
			})
			view, err := service.ReadDebate(ctx, session.ID, 0)
			if err != nil {
				t.Fatal(err)
			}
			want := "token_budget"
			if missing {
				want = "usage_missing"
			}
			if view.Usage.BudgetStatus != want || upstream.calls() > 2 || view.Usage.Calls < 1 {
				t.Fatal("budget did not close admission", view.Usage)
			}
			if _, err := service.ControlDebate(ctx, session.ID, "step"); !errors.Is(err, ErrDebateBudget) {
				t.Fatal("Step bypassed automatic pause", err)
			}
			next := view.Session.Controls
			next.AutoPause = false
			if _, err := service.UpdateDebateControls(ctx, session.ID, next); err != nil {
				t.Fatal(err)
			}
			if _, err := service.UpdateDebateControls(ctx, session.ID, next); !errors.Is(err, ErrDebateState) {
				t.Fatal("stale settings overwrote a newer budget", err)
			}
			if _, err := service.ControlDebate(ctx, session.ID, "step"); err != nil {
				t.Fatal(err)
			}
			waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return !service.debateBusy() })
		})
	}
}

func TestDebatePacingChangesWakeTheCurrentWait(t *testing.T) {
	ctx := context.Background()
	upstream := &debateTestProvider{}
	service, _ := newDebateTest(t, upstream)
	delay := int64(60000)
	input := debateInput()
	input.Controls.TurnDelayMS = &delay
	session, err := service.StartDebate(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	view := waitDebate(t, service, session.ID, func(view persistence.DebateView) bool {
		return view.Session.TotalTurns == 2 && view.Session.NextTurnAt != nil
	})
	if upstream.calls() != 2 {
		t.Fatal("pacing admitted a new turn before the wait")
	}
	settings := view.Session.Controls
	settings.SummaryEvery = 3
	saved, err := service.UpdateDebateControls(ctx, session.ID, settings)
	if err != nil || saved.NextTurnAt == nil || !saved.NextTurnAt.Equal(*view.Session.NextTurnAt) {
		t.Fatal("an unrelated settings edit reset the pacing deadline", err)
	}
	zero := int64(0)
	next := saved.Controls
	next.TurnDelayMS = &zero
	if _, err := service.UpdateDebateControls(ctx, session.ID, next); err != nil {
		t.Fatal(err)
	}
	waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return view.Session.TotalTurns >= 3 })
	if _, err := service.ControlDebate(ctx, session.ID, "stop"); err != nil {
		t.Fatal(err)
	}
}

func TestDebateBudgetSaveFailureCancelsAdmission(t *testing.T) {
	ctx := context.Background()
	upstream := &debateTestProvider{}
	service, sqlite := newDebateTest(t, upstream)
	store := &debateSaveFailureStore{SQLiteStore: sqlite}
	service.store = store
	delay := int64(60000)
	input := debateInput()
	input.Controls.TurnDelayMS = &delay
	session, err := service.StartDebate(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	view := waitDebate(t, service, session.ID, func(view persistence.DebateView) bool {
		return view.Session.TotalTurns == 2 && view.Session.NextTurnAt != nil
	})
	budget := int64(1)
	controls := view.Session.Controls
	controls.AutoPause, controls.TokenBudget = true, &budget
	store.fail.Store(true)
	defer store.fail.Store(false)
	if _, err := service.UpdateDebateControls(ctx, session.ID, controls); err == nil {
		t.Fatal("budget write failure was not reported")
	}
	view = waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return !service.debateBusy() })
	if view.Session.Status != "paused" || upstream.calls() != 2 {
		t.Fatal("failed budget persistence left admission running")
	}
}

func TestDebateSummaryParserRejectsUnsupportedChanges(t *testing.T) {
	turn := persistence.DebateTurn{ID: "summary", Kind: "summary", Round: 2, SummaryFromRound: 2, ContextIDs: []string{"before", "after", "other"}}
	sources := []persistence.DebateTurn{{ID: "before", Sequence: 1, Round: 1, Seat: 0, State: "completed"}, {ID: "after", Sequence: 2, Round: 2, Seat: 0, State: "completed"}, {ID: "other", Sequence: 3, Round: 2, Seat: 1, State: "completed"}}
	for _, test := range []struct {
		body  string
		valid bool
	}{
		{`{"new_ideas":[],"position_changes":[{"text":"A stated revision","sources":[1,2]}],"open_questions":[]}`, true},
		{`{"new_ideas":[],"position_changes":[{"text":"An invented revision","sources":[2,3]}],"open_questions":[]}`, false},
		{`{"new_ideas":[{"text":"Old material","sources":[1]}],"position_changes":[],"open_questions":[]}`, false},
		{`{"new_ideas":[{"text":"Unknown source","sources":[999]}],"position_changes":[],"open_questions":[]}`, false},
		{`{"new_ideas":[],"position_changes":[],"open_questions":[]}`, false},
	} {
		turn.Body = test.body
		_, err := decodeDebateSummary(turn, sources)
		if (err == nil) != test.valid {
			t.Fatalf("unexpected parser result: %v", err)
		}
	}
}

func TestDebateControlsValidation(t *testing.T) {
	cost := 1.0
	negative := int64(-1)
	for _, controls := range []persistence.DebateControls{{CostBudgetUSD: &cost}, {TurnDelayMS: &negative}, {SummaryEvery: 11}, {SummarySeat: 2}} {
		service, _ := newDebateTest(t, &debateTestProvider{})
		input := debateInput()
		input.Controls = controls
		if _, err := service.StartDebate(context.Background(), input); !errors.Is(err, ErrInvalidDebateControls) {
			t.Fatal("invalid controls admitted model calls", err)
		}
	}
}
