package persistence

import (
	"context"
	"path/filepath"
	"testing"
)

func TestDebateUsageIncludesAllPagesFailuresSummariesAndLegacyUnknowns(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "usage.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	session := storedDebateFixture(t, store)
	in, out := int64(20), int64(10)
	for i := 0; i < 70; i++ {
		turn := DebateTurn{DebateID: session.ID, Seat: 0, Round: i/2 + 1, State: "completed", UsageExpected: true, Metrics: &GenerationMetrics{Source: "service", InputTokens: &in, OutputTokens: &out}}
		if i%10 == 0 {
			turn.Kind = "summary"
		}
		if i == 69 {
			turn.State = "failed"
		}
		if _, err := store.BeginDebateTurn(ctx, turn); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.BeginDebateTurn(ctx, DebateTurn{DebateID: session.ID, Seat: 0, State: "failed", ErrorCode: "paused", UsageExpected: false}); err != nil {
		t.Fatal(err)
	}
	legacy, err := store.BeginDebateTurn(ctx, DebateTurn{DebateID: session.ID, Seat: 0, State: "failed"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE debate_turns SET record=json_remove(record,'$.usage_expected') WHERE id=?`, legacy.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.BeginDebateTurn(ctx, DebateTurn{DebateID: session.ID, Seat: 0, State: "streaming", UsageExpected: true}); err != nil {
		t.Fatal(err)
	}
	usage, err := store.ReadDebateUsage(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(usage) != 1 || usage[0].Calls != 71 || usage[0].SummaryCalls != 7 || usage[0].MissingUsageCalls != 1 || usage[0].ActiveCalls != 1 || usage[0].InputTokens != 1400 || usage[0].OutputTokens != 700 {
		t.Fatalf("incorrect cumulative usage: %+v", usage)
	}
	context, err := store.LoadDebateContext(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, turn := range context {
		if turn.Kind == "summary" || turn.State != "completed" {
			t.Fatal("rolling context retained a generated summary or failure")
		}
	}
	stage, err := store.LoadDebateSummaryContext(ctx, session.ID, 26, 35)
	if err != nil {
		t.Fatal(err)
	}
	for _, turn := range stage {
		if turn.Kind == "summary" || turn.State != "completed" || turn.Round < 25 || turn.Round > 35 {
			t.Fatal("stage input escaped its source window")
		}
	}
}

func TestSchemaTwentyMigrationPreservesDebatesAndProtectsNewControls(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "upgrade.sqlite")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	session := storedDebateFixture(t, store)
	dropWebSearchSchema(t, store)
	if _, err := store.db.Exec(removeMiniAppsSchema + `PRAGMA user_version=20`); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	version, err := readPragmaInt(store.db, "user_version")
	if err != nil || version != schemaVersion {
		t.Fatal("schema guard was not advanced", version, err)
	}
	loaded, err := store.GetDebate(ctx, session.ID)
	if err != nil || loaded.Topic != session.Topic || loaded.Controls.SummaryEvery != 0 || loaded.Controls.AutoPause {
		t.Fatal("migration changed an existing session", err)
	}
}
