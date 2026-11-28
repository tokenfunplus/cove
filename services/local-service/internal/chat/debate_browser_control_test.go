package chat

import (
	"errors"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestStopOtherDebateDoesNotRecoverAnUnrelatedPendingReceipt(t *testing.T) {
	for _, status := range []string{"paused", "stopped"} {
		t.Run(status, func(t *testing.T) {
			service, sqlite, upstream, run, turn, task := frozenDebateDeliveryFixture(t, "verifying_response")
			store := &debateBrowserReceiptFaultStore{SQLiteStore: sqlite}
			service.store = store
			input := DebateBrowserResult{ClaimID: "browser-one", Body: "Debate A's paid answer", Verification: verifiedSettlement("").Verification}
			queueDebateDeliveryWithoutAcknowledgement(t, service, turn, input)
			store.fail.Store(true)
			service.runDebateBrowserTurn(run, turn, task, true)
			service.debateMu.Lock()
			pending := service.debatePending[turn.ID]
			service.debate = nil // The completed scheduler has released admission.
			service.debateMu.Unlock()
			if pending == nil {
				t.Fatal("failed storage did not retain the first debate's result")
			}
			otherInput := debateInput()
			other, err := sqlite.CreateDebate(t.Context(), persistence.DebateSession{ClientRequestID: "unrelated-debate", Topic: otherInput.Topic, Seats: otherInput.Seats, Rules: otherInput.Rules, Status: status, Round: 1, OpeningDone: []bool{false, false}})
			if err != nil {
				t.Fatal(err)
			}
			if status == "paused" {
				if _, err := service.ControlDebate(t.Context(), other.ID, "resume"); !errors.Is(err, ErrDebateState) {
					t.Fatal("another debate resumed while the accepted receipt remained unsaved", err)
				}
			}
			stopped, err := service.ControlDebate(t.Context(), other.ID, "stop")
			if err != nil || stopped.Status != "stopped" {
				t.Fatal("an unrelated paid receipt blocked Stop", stopped, err)
			}
			service.debateMu.Lock()
			retained := service.debatePending[turn.ID]
			service.debateMu.Unlock()
			if retained != pending || retained.turn.Body != input.Body || store.terminalCommits.Load() != 0 {
				t.Fatal("stopping another debate changed the original pending receipt")
			}
			another := debateInput()
			another.ClientRequestID = "new-debate-while-unsaved"
			if _, err := service.StartDebate(t.Context(), another); !errors.Is(err, ErrDebateState) {
				t.Fatal("Stop released global admission while another debate had unsaved output", err)
			}
			if _, err := service.ControlDebate(t.Context(), turn.DebateID, "stop"); !errors.Is(err, errDebateBrowserReceiptStorage) {
				t.Fatal("Stop skipped recovery of its own accepted result", err)
			}
			store.fail.Store(false)
			if stopped, err := service.ControlDebate(t.Context(), turn.DebateID, "stop"); err != nil || stopped.Status != "stopped" {
				t.Fatal("the original debate could not save its receipt before Stop", stopped, err)
			}
			original, err := sqlite.ReadDebateTurn(t.Context(), turn.DebateID, turn.ID)
			if err != nil || original.Body != input.Body || original.State != "completed" || store.terminalCommits.Load() != 1 || upstream.calls() != 0 {
				t.Fatal("recovery lost the original result or repeated inference", original, err)
			}
		})
	}
}
