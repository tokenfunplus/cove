package persistence

import (
	"context"
	"errors"
	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
	"testing"
)

func TestCardAdmissionRejectsArchiveAndChangedTransactionReplay(t *testing.T) {
	ctx := context.Background()
	s, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	c, _, run := seedCard(t, s)
	in := interactive.Submission{GenerationID: run.GenerationID, Revision: run.Revision, Values: map[string]any{"next_action": "radio"}, Checks: map[string]string{}}
	input := BeginGenerationBatchInput{ConversationID: c.ID, ClientRequestID: "next", Body: "Continue", Card: &in, CardFingerprint: "original", Targets: []GenerationTargetInput{{ProviderID: "fixture", ModelID: "fixture", Snapshot: ProviderSnapshot{ProviderID: "fixture", ModelID: "fixture"}}}}
	if err = s.SetConversationArchived(ctx, c.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.PrepareCard(ctx, in, ""); !errors.Is(err, ErrCardConflict) {
		t.Fatal("archived preview admitted", err)
	}
	if _, err = s.BeginGenerationBatch(ctx, input); !errors.Is(err, ErrCardConflict) {
		t.Fatal("archived transaction admitted", err)
	}
	r, err := s.MaterializeCard(ctx, run.GenerationID)
	if err != nil || r.CanContinue || r.SubmittedBatchID != "" {
		t.Fatal("archived run consumed or still eligible", err)
	}
	if err = s.SetConversationArchived(ctx, c.ID, false); err != nil {
		t.Fatal(err)
	}
	next, err := s.BeginGenerationBatch(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := s.BeginGenerationBatch(ctx, input)
	if err != nil || replay.ID != next.ID {
		t.Fatal("exact transaction replay failed", err)
	}
	input.CardFingerprint = "changed"
	if _, err = s.BeginGenerationBatch(ctx, input); !errors.Is(err, ErrCardConflict) {
		t.Fatal("changed transaction replay accepted", err)
	}
	input.CardFingerprint = "original"
	input.Card.GenerationID = "different"
	if _, err = s.BeginGenerationBatch(ctx, input); !errors.Is(err, ErrCardConflict) {
		t.Fatal("changed source replay accepted", err)
	}
	input.Card.GenerationID = run.GenerationID
	input.ConversationID = "different"
	if _, err = s.BeginGenerationBatch(ctx, input); !errors.Is(err, ErrCardConflict) {
		t.Fatal("cross-conversation replay accepted", err)
	}
}
