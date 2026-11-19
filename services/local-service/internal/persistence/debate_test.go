package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func TestDebateFailedSettlementRollsBackAndReconcilesCommittedCursor(t *testing.T) {
	for _, stopped := range []bool{false, true} {
		t.Run(fmt.Sprint(stopped), func(t *testing.T) {
			ctx := context.Background()
			store, err := OpenSQLite(filepath.Join(t.TempDir(), "debate.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			session := storedDebateFixture(t, store)
			turn, err := store.BeginDebateTurn(ctx, DebateTurn{DebateID: session.ID, State: "streaming", Seat: 0})
			if err != nil {
				t.Fatal(err)
			}
			if stopped {
				session.Status = "stopped"
				if err := store.SaveDebate(ctx, session); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := store.db.ExecContext(ctx, `CREATE TRIGGER fail_debate_session BEFORE UPDATE ON debate_sessions BEGIN SELECT RAISE(FAIL, 'synthetic settlement rollback'); END`); err != nil {
				t.Fatal(err)
			}
			unsaved := session
			unsaved.OpeningDone = []bool{true, false}
			unsaved.TotalTurns = 1
			turn.State, turn.Body = "completed", "Unsaved public answer"
			if err := store.FinishDebateTurn(ctx, turn, unsaved); err == nil {
				t.Fatal("fixture did not roll back the transaction")
			}
			if _, err := store.db.ExecContext(ctx, `DROP TRIGGER fail_debate_session`); err != nil {
				t.Fatal(err)
			}
			if err := store.InterruptDebate(ctx, session.ID, "Resume to retry."); err != nil {
				t.Fatal(err)
			}
			view, err := store.ReadDebate(ctx, session.ID, 0)
			if err != nil {
				t.Fatal(err)
			}
			wantSession, wantTurn := "paused", "failed"
			if stopped {
				wantSession, wantTurn = "stopped", "stopped"
			}
			if view.Session.Status != wantSession || view.Session.TotalTurns != 0 || view.Session.Position != 0 || view.Session.OpeningDone[0] || view.Turns[0].State != wantTurn || view.Turns[0].Body != "" {
				t.Fatal("recovery retained unsaved progress or changed Stop state")
			}
		})
	}
}

func storedDebateFixture(t *testing.T, store *SQLiteStore) DebateSession {
	t.Helper()
	session, err := store.CreateDebate(context.Background(), DebateSession{ClientRequestID: "create-debate", Topic: "A synthetic debate", Status: "running", Round: 1, OpeningDone: []bool{false, false}, Seats: []DebateSeat{{ProviderID: "fixture", ModelID: "one", Role: "Advocate"}, {ProviderID: "fixture", ModelID: "two", Role: "Challenger"}}, Rules: DebateRules{Version: 1, Text: "Use evidence.", MaxTokens: 512, CheckpointEvery: 2}})
	if err != nil {
		t.Fatal(err)
	}
	return session
}

func TestDebateRecoveryAndDeletionPreserveOrdinaryHistory(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "debate.sqlite")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	ordinary, err := store.CreateConversation(ctx, "Ordinary")
	if err != nil {
		t.Fatal(err)
	}
	session := storedDebateFixture(t, store)
	turn, err := store.BeginDebateTurn(ctx, DebateTurn{DebateID: session.ID, Round: 1, Seat: 0, State: "streaming", Body: "Incomplete text", Reasoning: "Incomplete reasoning", Context: []DebateContextMessage{{Role: "user", Content: "Immutable context"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err = store.RecoverInterruptedGenerations(ctx); err != nil {
		t.Fatal(err)
	}
	view, err := store.ReadDebate(ctx, session.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if view.Session.Status != "paused" || len(view.Turns) != 1 || view.Turns[0].State != "failed" || view.Turns[0].Body != "" || view.Turns[0].Reasoning != "" {
		t.Fatal("recovery retained an incomplete answer or restarted the session")
	}
	saved, err := store.ReadDebateTurn(ctx, session.ID, turn.ID)
	if err != nil || len(saved.Context) != 1 || saved.Context[0].Content != "Immutable context" {
		t.Fatal("immutable context was not retained", err)
	}
	if err = store.DeleteConversation(ctx, session.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = store.GetDebate(ctx, session.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("session did not cascade", err)
	}
	if _, err = store.ReadDebateTurn(ctx, session.ID, turn.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("turn did not cascade", err)
	}
	if _, err = store.LoadConversation(ctx, ordinary.ID); err != nil {
		t.Fatal("ordinary history changed", err)
	}
}

func TestDebatePaginationAndBoundaryChangesAreDurable(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "debate.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	session := storedDebateFixture(t, store)
	for i := 0; i < 55; i++ {
		if _, err = store.BeginDebateTurn(ctx, DebateTurn{DebateID: session.ID, Round: 1, Seat: i % 2, State: "completed", Body: "Public answer"}); err != nil {
			t.Fatal(err)
		}
	}
	latest, err := store.ReadDebate(ctx, session.ID, 0)
	if err != nil || len(latest.Turns) != 50 || !latest.HasMore || latest.Turns[0].Sequence != 6 {
		t.Fatal("latest page is not bounded", err)
	}
	older, err := store.ReadDebate(ctx, session.ID, latest.Turns[0].Sequence)
	if err != nil || len(older.Turns) != 5 || older.HasMore {
		t.Fatal("older cursor did not reach first turn", err)
	}
	note, err := store.AddDebateIntervention(ctx, session.ID, DebateIntervention{ClientRequestID: "note", Body: "A user intervention"})
	if err != nil {
		t.Fatal(err)
	}
	session.PendingRules = &DebateRules{Version: 2, Text: "Test a counterexample.", MaxTokens: 1024, CheckpointEvery: 3}
	session, err = store.AdvanceDebateRound(ctx, session)
	if err != nil {
		t.Fatal(err)
	}
	view, err := store.ReadDebate(ctx, session.ID, 0)
	if err != nil || view.Session.Round != 2 || view.Session.Rules.Version != 2 || view.Session.PendingRules != nil || len(view.Interventions) != 1 || view.Interventions[0].AppliedRound != 2 || view.Interventions[0].ID != note.ID {
		t.Fatal("round rules and interventions did not apply together", err)
	}
	encoded, err := json.Marshal(view)
	if err != nil || strings.Contains(string(encoded), "\"messages\"") {
		t.Fatal("read view leaked full request contexts", err)
	}
}

func TestDebateMigrationFromVersion19PreservesExistingData(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "migration.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(ctx, "Keep history")
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.db.Exec(`DROP TABLE debate_turns;DROP TABLE debate_interventions;DROP TABLE debate_sessions;PRAGMA user_version=19;`)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.migrate(); err != nil {
		t.Fatal(err)
	}
	view, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil || view.DebateID != "" || view.Title != "Keep history" {
		t.Fatal("migration changed ordinary conversation data", err)
	}
	storedDebateFixture(t, store)
}

func TestDebateContextKeepsCompletedPositionsAcrossRepeatedFailedAttempts(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "context.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	session := storedDebateFixture(t, store)
	if _, err = store.BeginDebateTurn(ctx, DebateTurn{DebateID: session.ID, Round: 1, Seat: 0, State: "completed", Body: "Preserve this minority position.", Reasoning: "Never send this reasoning."}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 55; i++ {
		if _, err = store.BeginDebateTurn(ctx, DebateTurn{DebateID: session.ID, Round: 1, Seat: 1, State: "failed"}); err != nil {
			t.Fatal(err)
		}
	}
	turns, err := store.LoadDebateContext(ctx, session.ID)
	if err != nil || len(turns) != 1 || turns[0].Body != "Preserve this minority position." || turns[0].Reasoning != "" {
		t.Fatal("failed attempts erased completed public context", err)
	}
}

func TestDebateReadsKeepVerificationEvidenceOutOfListsAndModelContext(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "verification.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	session := storedDebateFixture(t, store)
	turn, err := store.BeginDebateTurn(ctx, DebateTurn{DebateID: session.ID, Round: 1, Seat: 0, State: "completed", Execution: "browser", Body: "Verified public answer", Verification: &GenerationVerification{Status: VerificationModel, Signature: "receipt-fixture", SignedMessage: "signed-bytes-fixture", Evidence: &VerificationEvidence{Kind: "model", Raw: map[string]interface{}{"large_quote": strings.Repeat("x", 4096)}}}})
	if err != nil {
		t.Fatal(err)
	}
	view, err := store.ReadDebate(ctx, session.ID, 0)
	if err != nil || len(view.Turns) != 1 || view.Turns[0].Verification.Status != VerificationModel || view.Turns[0].Verification.Evidence != nil || view.Turns[0].Verification.Signature != "" {
		t.Fatal("list projection repeated receipt evidence", err)
	}
	contextTurns, err := store.LoadDebateContext(ctx, session.ID)
	if err != nil || len(contextTurns) != 1 || contextTurns[0].Verification != nil {
		t.Fatal("model context included verification evidence", err)
	}
	full, err := store.ReadDebateTurn(ctx, session.ID, turn.ID)
	if err != nil || full.Verification.Evidence == nil || full.Verification.Signature != "receipt-fixture" {
		t.Fatal("individual turn lost immutable evidence", err)
	}
}
