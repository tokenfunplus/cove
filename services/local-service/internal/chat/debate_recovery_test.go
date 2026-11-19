package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type debateFaultStore struct {
	*persistence.SQLiteStore
	get, finish, save atomic.Bool
}

func (store *debateFaultStore) GetDebate(ctx context.Context, id string) (persistence.DebateSession, error) {
	if store.get.Swap(false) {
		return persistence.DebateSession{}, errors.New("synthetic read failure")
	}
	return store.SQLiteStore.GetDebate(ctx, id)
}
func (store *debateFaultStore) FinishDebateTurn(ctx context.Context, turn persistence.DebateTurn, session persistence.DebateSession) error {
	if store.finish.Swap(false) {
		return errors.New("synthetic transaction rollback")
	}
	return store.SQLiteStore.FinishDebateTurn(ctx, turn, session)
}
func (store *debateFaultStore) SaveDebate(ctx context.Context, session persistence.DebateSession) error {
	if store.save.Swap(false) {
		return errors.New("synthetic pause failure")
	}
	return store.SQLiteStore.SaveDebate(ctx, session)
}

func TestDebateStorageFailuresCancelWithoutAdvancingOrRetrying(t *testing.T) {
	for _, failure := range []string{"read", "finish", "provider-pause", "stopped-finish"} {
		t.Run(failure, func(t *testing.T) {
			ctx := context.Background()
			gate := make(chan struct{})
			upstream := &debateTestProvider{gate: gate}
			service, sqlite := newDebateTest(t, upstream)
			fault := &debateFaultStore{SQLiteStore: sqlite}
			service.store = fault
			session, err := service.StartDebate(ctx, debateInput())
			if err != nil {
				t.Fatal(err)
			}
			waitDebate(t, service, session.ID, func(view persistence.DebateView) bool {
				return len(view.Turns) == 2 && view.Turns[0].Body != "" && view.Turns[1].Body != ""
			})
			switch failure {
			case "read":
				fault.get.Store(true)
			case "finish":
				fault.finish.Store(true)
			case "provider-pause":
				fault.save.Store(true)
				service.debateMu.Lock()
				run := service.debate
				service.debateMu.Unlock()
				service.pauseDebateForProvider(run, provider.ErrModelUnavailable)
			case "stopped-finish":
				fault.finish.Store(true)
				if _, err := service.ControlDebate(ctx, session.ID, "stop"); err != nil {
					t.Fatal(err)
				}
			}
			close(gate)
			waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return !service.debateBusy() })
			view, err := sqlite.ReadDebate(ctx, session.ID, 0)
			if err != nil {
				t.Fatal(err)
			}
			want := "paused"
			if failure == "stopped-finish" {
				want = "stopped"
			}
			if view.Session.Status != want || view.Session.TotalTurns != 0 || view.Session.Position != 0 || view.Session.OpeningDone[0] || view.Session.OpeningDone[1] {
				t.Fatalf("storage failure advanced the committed cursor: %+v", view.Session)
			}
			for _, turn := range view.Turns {
				if turn.State == "streaming" || turn.Body != "" {
					t.Fatal("abandoned turn was not reconciled")
				}
			}
			if upstream.calls() != 2 {
				t.Fatal("storage failure automatically retried a paid call")
			}
			if want == "stopped" {
				if _, err := service.ControlDebate(ctx, session.ID, "resume"); !errors.Is(err, ErrDebateState) {
					t.Fatal("Stop became resumable", err)
				}
			} else {
				if _, err := service.ControlDebate(ctx, session.ID, "step"); err != nil {
					t.Fatal(err)
				}
				resumed := waitDebate(t, service, session.ID, func(view persistence.DebateView) bool { return !service.debateBusy() })
				if resumed.Session.TotalTurns != 2 || upstream.calls() != 4 {
					t.Fatal("explicit recovery skipped or repeated a seat")
				}
			}
		})
	}
}

func TestDebateInterventionReplayOutlivesReadWindowAndAdmissionLimits(t *testing.T) {
	ctx := context.Background()
	service, store := newDebateTest(t, &debateTestProvider{})
	input := debateInput()
	session, err := store.CreateDebate(ctx, persistence.DebateSession{ClientRequestID: input.ClientRequestID, Topic: input.Topic, Seats: input.Seats, Rules: input.Rules, Status: "paused", Round: 1})
	if err != nil {
		t.Fatal(err)
	}
	var first persistence.DebateIntervention
	for i := 0; i < 70; i++ {
		note, err := store.AddDebateIntervention(ctx, session.ID, persistence.DebateIntervention{ClientRequestID: fmt.Sprint(i), Body: "Original accepted note"})
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = note
		}
		session, err = store.AdvanceDebateRound(ctx, session)
		if err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 8; i++ {
		if _, err := service.AddDebateIntervention(ctx, session.ID, persistence.DebateIntervention{ClientRequestID: fmt.Sprintf("pending-%d", i), Body: "Pending"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, stopped := range []bool{false, true} {
		if stopped {
			session.Status = "stopped"
			if err := store.SaveDebate(ctx, session); err != nil {
				t.Fatal(err)
			}
		}
		replay, err := service.AddDebateIntervention(ctx, session.ID, persistence.DebateIntervention{ClientRequestID: first.ClientRequestID, Body: "Changed replay body"})
		if err != nil || replay.ID != first.ID || replay.Body != first.Body || replay.AppliedRound != 2 {
			t.Fatal("old accepted command lost idempotency", err)
		}
		if _, err := service.AddDebateIntervention(ctx, session.ID, persistence.DebateIntervention{ClientRequestID: "new-note", Body: "New"}); !errors.Is(err, ErrDebateState) {
			t.Fatal("new command bypassed admission limits", err)
		}
	}
}

func TestDebateContextReservesEveryCurrentRoundIntervention(t *testing.T) {
	session := persistence.DebateSession{Topic: "Synthetic question", Round: 8, Seats: make([]persistence.DebateSeat, 4), Rules: debateInput().Rules, Checkpoint: &persistence.DebateCheckpoint{}}
	view := persistence.DebateView{}
	for i := 0; i < 4; i++ {
		session.Seats[i] = persistence.DebateSeat{ProviderID: strings.Repeat("p", 256), ModelID: strings.Repeat("m", 512), Role: "Challenger"}
		session.Checkpoint.Positions = append(session.Checkpoint.Positions, persistence.DebatePosition{TurnID: fmt.Sprint(i), Body: strings.Repeat("p", 1800)})
	}
	for i := 0; i < 12; i++ {
		view.Turns = append(view.Turns, persistence.DebateTurn{ID: fmt.Sprintf("turn-%d", i), State: "completed", Body: strings.Repeat("a", 3000)})
	}
	for i := 0; i < 8; i++ {
		view.Interventions = append(view.Interventions, persistence.DebateIntervention{ID: fmt.Sprintf("current-%d", i), AppliedRound: session.Round, Body: fmt.Sprintf("Required note %d: ", i) + strings.Repeat("\u4e2d", 4000)})
	}
	for i := 0; i < 56; i++ {
		view.Interventions = append(view.Interventions, persistence.DebateIntervention{ID: fmt.Sprintf("old-%d", i), AppliedRound: 2, Body: strings.Repeat("z", 4000)})
	}
	messages, ids := debateMessages(session, view, 0, false)
	context := messages[2].Content
	if len(context) > 56000 || !utf8.ValidString(context) {
		t.Fatal("context exceeded its byte budget or split Unicode")
	}
	if !strings.Contains(strings.Join(ids, ","), "turn-11") {
		t.Fatal("older context displaced the latest public answer")
	}
	for i := 0; i < 8; i++ {
		if !strings.Contains(context, fmt.Sprintf("Required note %d:", i)) || !strings.Contains(strings.Join(ids, ","), fmt.Sprintf("current-%d", i)) {
			t.Fatalf("current intervention %d was dropped", i)
		}
	}
}

type blockedDebateSource struct {
	ProviderSource
	entered chan struct{}
	release chan struct{}
}

func (source blockedDebateSource) Resolve(ctx context.Context, id string) (provider.Profile, credentials.Secret, error) {
	select {
	case source.entered <- struct{}{}:
	default:
	}
	<-source.release
	return source.ProviderSource.Resolve(ctx, id)
}

func TestDebateShutdownClosesAdmissionBeforeCatalogResolutionCompletes(t *testing.T) {
	ctx := context.Background()
	upstream := &debateTestProvider{}
	service, store := newDebateTest(t, upstream)
	source := blockedDebateSource{ProviderSource: service.profiles, entered: make(chan struct{}, 1), release: make(chan struct{})}
	service.profiles = source
	finished := make(chan error, 1)
	go func() { _, err := service.StartDebate(ctx, debateInput()); finished <- err }()
	<-source.entered
	if err := service.PauseDebatesForShutdown(ctx); err != nil {
		t.Fatal(err)
	}
	close(source.release)
	if err := <-finished; !errors.Is(err, ErrDebateState) {
		t.Fatal("late request started after shutdown", err)
	}
	if _, err := store.FindDebateRequest(ctx, debateInput().ClientRequestID); err == nil || upstream.calls() != 0 {
		t.Fatal("shutdown admitted a debate")
	}
}
