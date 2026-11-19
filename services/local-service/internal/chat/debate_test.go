package chat

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type debateTestProvider struct {
	mu           sync.Mutex
	inputs       []provider.CompletionInput
	gate         <-chan struct{}
	failFirst    bool
	ignoreCancel bool
}

func (p *debateTestProvider) Validate(context.Context, provider.ValidateInput) (provider.ValidationResult, error) {
	return provider.ValidationResult{}, nil
}
func (p *debateTestProvider) Stream(_ context.Context, input provider.CompletionInput) (provider.CompletionStream, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.inputs = append(p.inputs, input)
	return &debateTestStream{body: "A public claim from " + input.Profile.Model + ". Agreement remains provisional.", gate: p.gate, fail: p.failFirst && len(p.inputs) == 1, ignoreCancel: p.ignoreCancel}, nil
}
func (p *debateTestProvider) calls() int { p.mu.Lock(); defer p.mu.Unlock(); return len(p.inputs) }

type debateTestStream struct {
	stage              int
	body               string
	gate               <-chan struct{}
	fail, ignoreCancel bool
}

func (s *debateTestStream) Close() error { return nil }
func (s *debateTestStream) Recv(ctx context.Context) (provider.Event, error) {
	s.stage++
	switch s.stage {
	case 1:
		return provider.Event{Type: provider.EventStarted}, nil
	case 2:
		return provider.Event{Type: provider.EventDelta, Delta: s.body, ReasoningDelta: "Private intermediate fixture."}, nil
	default:
		if s.gate != nil {
			if s.ignoreCancel {
				<-s.gate
			} else {
				select {
				case <-s.gate:
				case <-ctx.Done():
					return provider.Event{}, ctx.Err()
				}
			}
		}
		if s.fail {
			return provider.Event{Type: provider.EventFailed}, nil
		}
		input, output := int64(20), int64(10)
		return provider.Event{Type: provider.EventCompleted, Usage: &provider.TokenUsage{InputTokens: &input, OutputTokens: &output}}, nil
	}
}

func newDebateTest(t *testing.T, upstream *debateTestProvider) (*Service, *persistence.SQLiteStore) {
	t.Helper()
	store, err := persistence.OpenSQLite(filepath.Join(t.TempDir(), "debate.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store, fakeProviderSource{profile: provider.Profile{ID: "fixture", Kind: provider.KindOpenAICompatible, Name: "Fixture", Model: "model-a", Endpoint: "https://provider.example/v1", AuthMethod: provider.AuthBearer}, secret: credentials.Secret{Value: "fixture-only"}}, upstream)
	service.debateDelay = time.Millisecond
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		service.startMu.Lock()
		_ = service.stopDebateForDataChange(ctx, "")
		service.startMu.Unlock()
		_ = store.Close()
	})
	return service, store
}

func debateInput() StartDebateInput {
	return StartDebateInput{ClientRequestID: "debate-request", Topic: "Should a small team remain small?", Seats: []persistence.DebateSeat{{ProviderID: "fixture", ModelID: "model-a", Role: "Advocate"}, {ProviderID: "fixture", ModelID: "model-b", Role: "Challenger"}}, Rules: persistence.DebateRules{Text: "Challenge specific claims and name evidence gaps.", MaxTokens: 512, CheckpointEvery: 2, Rotate: true}}
}

func waitDebate(t *testing.T, service *Service, id string, predicate func(persistence.DebateView) bool) persistence.DebateView {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		view, err := service.ReadDebate(context.Background(), id, 0)
		if err != nil {
			t.Fatal(err)
		}
		if predicate(view) {
			return view
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("debate did not reach the expected state")
	return persistence.DebateView{}
}

func TestDebateContinuousSchedulingPauseStepAndRoundBoundaries(t *testing.T) {
	ctx := context.Background()
	upstream := &debateTestProvider{}
	service, store := newDebateTest(t, upstream)
	session, err := service.StartDebate(ctx, debateInput())
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := service.StartDebate(ctx, debateInput())
	if err != nil || duplicate.ID != session.ID {
		t.Fatal("creation must be idempotent", err)
	}
	waitDebate(t, service, session.ID, func(v persistence.DebateView) bool { return v.Session.Round >= 5 })
	if _, err = service.ControlDebate(ctx, session.ID, "pause"); err != nil {
		t.Fatal(err)
	}
	paused := waitDebate(t, service, session.ID, func(v persistence.DebateView) bool { return v.Session.Status == "paused" && !service.debateBusy() })
	count := upstream.calls()
	time.Sleep(15 * time.Millisecond)
	if upstream.calls() != count {
		t.Fatal("paused debate scheduled more calls")
	}
	if paused.Session.Checkpoint == nil {
		t.Fatal("continuous debate must retain checkpoints")
	}
	if _, err = service.ControlDebate(ctx, session.ID, "step"); err != nil {
		t.Fatal(err)
	}
	stepped := waitDebate(t, service, session.ID, func(v persistence.DebateView) bool { return v.Session.Status == "paused" && !service.debateBusy() })
	if stepped.Session.TotalTurns != paused.Session.TotalTurns+1 {
		t.Fatal("step must complete one turn")
	}
	note, err := service.AddDebateIntervention(ctx, session.ID, persistence.DebateIntervention{ClientRequestID: "note-one", Body: "Test the review bottleneck."})
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := service.AddDebateIntervention(ctx, session.ID, persistence.DebateIntervention{ClientRequestID: "note-one", Body: "Different replay body"})
	if err != nil || repeated.ID != note.ID || repeated.Body != note.Body {
		t.Fatal("intervention replay changed accepted input")
	}
	rules := stepped.Session.Rules
	rules.Text = "State a concrete counterexample."
	if _, err = service.UpdateDebateRules(ctx, session.ID, rules); err != nil {
		t.Fatal(err)
	}
	if _, err = service.ControlDebate(ctx, session.ID, "resume"); err != nil {
		t.Fatal(err)
	}
	waitDebate(t, service, session.ID, func(v persistence.DebateView) bool {
		return v.Session.Rules.Version == 2 && len(v.Interventions) > 0 && v.Interventions[0].AppliedRound > 0 && v.Session.Position > 0
	})
	if _, err = service.ControlDebate(ctx, session.ID, "stop"); err != nil {
		t.Fatal(err)
	}
	view, err := store.LoadConversation(ctx, session.ID)
	if err != nil || view.DebateID != session.ID || len(view.Messages) != 0 {
		t.Fatal("debate must not mutate ordinary selected-answer history", err)
	}
	upstream.mu.Lock()
	defer upstream.mu.Unlock()
	for _, input := range upstream.inputs[:2] {
		if len(input.Messages) != 2 {
			t.Fatal("blind opening saw another answer")
		}
	}
	foundNote := false
	for _, input := range upstream.inputs {
		for _, message := range input.Messages {
			if strings.Contains(message.Content, "Private intermediate fixture") {
				t.Fatal("reasoning leaked into debate context")
			}
			foundNote = foundNote || strings.Contains(message.Content, "Test the review bottleneck")
		}
	}
	if !foundNote {
		t.Fatal("applied intervention was absent from model context")
	}
}

func TestDebateStopRejectsLateCompletionAndRetainsNoPartialAnswer(t *testing.T) {
	gate := make(chan struct{})
	var release sync.Once
	upstream := &debateTestProvider{gate: gate, ignoreCancel: true}
	service, store := newDebateTest(t, upstream)
	t.Cleanup(func() { release.Do(func() { close(gate) }) })
	session, err := service.StartDebate(context.Background(), debateInput())
	if err != nil {
		t.Fatal(err)
	}
	waitDebate(t, service, session.ID, func(v persistence.DebateView) bool {
		return len(v.Turns) == 2 && v.Turns[0].Body != "" && v.Turns[1].Body != ""
	})
	persisted, err := store.ReadDebate(context.Background(), session.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, turn := range persisted.Turns {
		if turn.Body != "" {
			t.Fatal("partial text reached disk")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stopped := make(chan error, 1)
	go func() { _, err := service.ControlDebate(ctx, session.ID, "stop"); stopped <- err }()
	deadline := time.Now().Add(3 * time.Second)
	for {
		current, err := store.GetDebate(context.Background(), session.ID)
		if err != nil {
			t.Fatal(err)
		}
		if current.Status == "stopped" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Stop did not persist its terminal state")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	if err = <-stopped; !errors.Is(err, context.Canceled) {
		t.Fatal("fixture should hold cancellation cleanup", err)
	}
	release.Do(func() { close(gate) })
	view := waitDebate(t, service, session.ID, func(v persistence.DebateView) bool { return !service.debateBusy() })
	if view.Session.Status != "stopped" || view.Session.TotalTurns != 0 {
		t.Fatal("late completion changed stopped state")
	}
	for _, turn := range view.Turns {
		if turn.State != "stopped" || turn.Body != "" || turn.Reasoning != "" {
			t.Fatal("late result was persisted")
		}
	}
	if _, err = service.ControlDebate(context.Background(), session.ID, "resume"); !errors.Is(err, ErrDebateState) {
		t.Fatal("stopped debate resumed", err)
	}
}

func TestDebateReservesGlobalSlotAndDeletionWaitsForCancellation(t *testing.T) {
	gate := make(chan struct{})
	service, store := newDebateTest(t, &debateTestProvider{gate: gate})
	ordinary, err := store.CreateConversation(context.Background(), "Ordinary")
	if err != nil {
		t.Fatal(err)
	}
	session, err := service.StartDebate(context.Background(), debateInput())
	if err != nil {
		t.Fatal(err)
	}
	waitDebate(t, service, session.ID, func(v persistence.DebateView) bool { return len(v.Turns) == 2 })
	_, err = service.StartGenerationBatch(context.Background(), SendInput{ConversationID: ordinary.ID, ClientRequestID: "ordinary-request", Body: "Hello", ProviderID: "fixture", ModelID: "model-a"})
	if !errors.Is(err, ErrGenerationBatchInProgress) {
		t.Fatal("ordinary Batch bypassed debate reservation", err)
	}
	input := debateInput()
	input.ClientRequestID = "another-debate"
	if _, err = service.StartDebate(context.Background(), input); !errors.Is(err, ErrGenerationBatchInProgress) {
		t.Fatal("second debate started", err)
	}
	if _, err = service.StartGenerationBatch(context.Background(), SendInput{ConversationID: session.ID, ClientRequestID: "wrong-path", Body: "Hello"}); !errors.Is(err, ErrDebateConversation) {
		t.Fatal("ordinary context entered a debate", err)
	}
	if err = service.DeleteConversation(context.Background(), session.ID); err != nil {
		t.Fatal(err)
	}
	if service.debateBusy() {
		t.Fatal("deleted debate still owns active slot")
	}
	if _, err = store.GetDebate(context.Background(), session.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("debate did not cascade", err)
	}
}

func TestDebateFailurePausesAndResumeRetriesOnlyMissingOpening(t *testing.T) {
	gate := make(chan struct{})
	upstream := &debateTestProvider{failFirst: true, gate: gate}
	service, _ := newDebateTest(t, upstream)
	session, err := service.StartDebate(context.Background(), debateInput())
	if err != nil {
		t.Fatal(err)
	}
	waitDebate(t, service, session.ID, func(v persistence.DebateView) bool {
		return len(v.Turns) == 2 && v.Turns[0].Body != "" && v.Turns[1].Body != ""
	})
	close(gate)
	view := waitDebate(t, service, session.ID, func(v persistence.DebateView) bool { return v.Session.Status == "paused" && !service.debateBusy() })
	if view.Session.TotalTurns != 1 || len(view.Turns) != 2 {
		t.Fatal("failed seat was counted as a completed view")
	}
	if _, err = service.ControlDebate(context.Background(), session.ID, "step"); err != nil {
		t.Fatal(err)
	}
	view = waitDebate(t, service, session.ID, func(v persistence.DebateView) bool { return v.Session.Status == "paused" && !service.debateBusy() })
	if view.Session.TotalTurns != 2 || upstream.calls() != 3 {
		t.Fatal("resume replayed successful independent openings")
	}
}

func TestDebateBoundsContext(t *testing.T) {
	session := persistence.DebateSession{Topic: strings.Repeat("x", 2000), Seats: debateInput().Seats, Rules: debateInput().Rules, Round: 2}
	view := persistence.DebateView{}
	for i := 0; i < 50; i++ {
		view.Turns = append(view.Turns, persistence.DebateTurn{ID: "source", State: "completed", Body: strings.Repeat("\u754c", 10000), Reasoning: "never include", Sequence: int64(i)})
	}
	messages, _ := debateMessages(session, view, 0, false)
	size := 0
	for _, message := range messages {
		size += len(message.Content)
		if strings.Contains(message.Content, "never include") {
			t.Fatal("included provider reasoning")
		}
	}
	if size > 96<<10 {
		t.Fatal("context exceeded its byte budget", size)
	}
}

func TestDebateStepAfterRecoveredOpeningDoesNotRepeatTheOpening(t *testing.T) {
	ctx := context.Background()
	upstream := &debateTestProvider{}
	service, store := newDebateTest(t, upstream)
	input := debateInput()
	input.Rules.Version = 1
	session, err := store.CreateDebate(ctx, persistence.DebateSession{ClientRequestID: "recovered-opening", Topic: input.Topic, Seats: input.Seats, Rules: input.Rules, Status: "paused", Round: 1, Position: 0, OpeningDone: []bool{true, true}, TotalTurns: 2})
	if err != nil {
		t.Fatal(err)
	}
	for seat := 0; seat < 2; seat++ {
		if _, err = store.BeginDebateTurn(ctx, persistence.DebateTurn{DebateID: session.ID, Round: 1, Seat: seat, State: "completed", Body: "A completed independent position."}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = service.ControlDebate(ctx, session.ID, "step"); err != nil {
		t.Fatal(err)
	}
	view := waitDebate(t, service, session.ID, func(v persistence.DebateView) bool { return v.Session.Status == "paused" && !service.debateBusy() })
	if upstream.calls() != 1 || view.Session.Round != 2 || view.Session.TotalTurns != 3 {
		t.Fatal("recovered group cursor repeated or skipped a model turn")
	}
}

type debateSaveFailureStore struct {
	*persistence.SQLiteStore
	fail atomic.Bool
}

func (store *debateSaveFailureStore) SaveDebate(ctx context.Context, session persistence.DebateSession) error {
	if store.fail.Load() {
		return errors.New("synthetic write failure")
	}
	return store.SQLiteStore.SaveDebate(ctx, session)
}

func TestDebateStopCancelsWorkEvenWhenItsStateCannotBeSaved(t *testing.T) {
	gate := make(chan struct{})
	upstream := &debateTestProvider{gate: gate}
	service, store := newDebateTest(t, upstream)
	fault := &debateSaveFailureStore{SQLiteStore: store}
	service.store = fault
	session, err := service.StartDebate(context.Background(), debateInput())
	if err != nil {
		t.Fatal(err)
	}
	waitDebate(t, service, session.ID, func(v persistence.DebateView) bool {
		return len(v.Turns) == 2 && v.Turns[0].Body != "" && v.Turns[1].Body != ""
	})
	fault.fail.Store(true)
	defer fault.fail.Store(false)
	if _, err = service.ControlDebate(context.Background(), session.ID, "stop"); err == nil {
		t.Fatal("write failure should be reported")
	}
	view := waitDebate(t, service, session.ID, func(v persistence.DebateView) bool { return !service.debateBusy() })
	if view.Session.TotalTurns != 0 {
		t.Fatal("cancelled work was accepted after Stop")
	}
	calls := upstream.calls()
	time.Sleep(15 * time.Millisecond)
	if upstream.calls() != calls {
		t.Fatal("storage failure allowed another paid call")
	}
}
