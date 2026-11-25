package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func seedCard(t *testing.T, s *SQLiteStore, fixtureName ...string) (Conversation, GenerationBatch, interactive.Run) {
	t.Helper()
	ctx := context.Background()
	c, e := s.CreateConversation(ctx, "Interactive story")
	if e != nil {
		t.Fatal(e)
	}
	b, e := s.BeginGenerationBatch(ctx, BeginGenerationBatchInput{Interactive: true, ConversationID: c.ID, ClientRequestID: c.ID, Body: "Story", Targets: []GenerationTargetInput{{ProviderID: "fixture", ModelID: "fixture", Snapshot: ProviderSnapshot{ProviderID: "fixture", ModelID: "fixture"}}}})
	if e != nil {
		t.Fatal(e)
	}
	raw, e := os.ReadFile("../../../../packages/api-contract/fixtures/interactive-cards.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixtures struct {
		Valid []struct{ Name, Source string }
	}
	json.Unmarshal(raw, &fixtures)
	source := fixtures.Valid[0].Source
	if len(fixtureName) > 0 {
		for _, f := range fixtures.Valid {
			if f.Name == fixtureName[0] {
				source = f.Source
			}
		}
	}
	definition, err := interactive.Parse([]byte(source))
	if err != nil {
		t.Fatal(err)
	}
	if e = s.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: b.Targets[0].Generation.ID, Body: "Choose a path.\n```" + definition.Version + "\n" + source + "\n```"}); e != nil {
		t.Fatal(e)
	}
	r, e := s.MaterializeCard(ctx, b.Targets[0].Generation.ID)
	if e != nil || r.CanContinue != definition.HasContinuation() {
		t.Fatal("card unavailable", e)
	}
	return c, b, r
}
func TestInteractiveRunPersistsAndConsumesOnce(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "card.sqlite")
	s, e := OpenSQLite(path)
	if e != nil {
		t.Fatal(e)
	}
	c, _, r := seedCard(t, s)
	in := interactive.Submission{GenerationID: r.GenerationID, Revision: 0, Values: map[string]any{"next_action": "radio"}, Checks: map[string]string{}}
	saved, e := s.SaveCard(ctx, in)
	if e != nil || saved.Revision != 1 {
		t.Fatal(saved, e)
	}
	if _, e = s.SaveCard(ctx, in); !errors.Is(e, ErrCardConflict) {
		t.Fatal("stale save accepted", e)
	}
	s.Close()
	s, e = OpenSQLite(path)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	r, e = s.MaterializeCard(ctx, in.GenerationID)
	if e != nil || r.Values["next_action"] != "radio" || r.Revision != 1 {
		t.Fatal("restore", r, e)
	}
	in.Revision = 1
	summary, content, e := s.PrepareCard(ctx, in, "Explain the clue")
	if e != nil {
		t.Fatal(e)
	}
	input := BeginGenerationBatchInput{Interactive: true, ConversationID: c.ID, ClientRequestID: "continue", Body: summary, InputContent: content, Card: &in, CardFingerprint: interactive.Fingerprint(in, "Explain the clue"), Targets: []GenerationTargetInput{{ProviderID: "fixture", ModelID: "fixture", Snapshot: ProviderSnapshot{ProviderID: "fixture", ModelID: "fixture"}}}}
	b, e := s.BeginGenerationBatch(ctx, input)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(b.InputContent, "Examine the abandoned radio") || !strings.Contains(b.InputContent, "interaction-v1") {
		t.Fatal("missing snapshot")
	}
	replay, ok, e := s.CardReplay(ctx, in, interactive.Fingerprint(in, "Explain the clue"), "continue")
	if e != nil || !ok || replay.ID != b.ID {
		t.Fatal("replay", e)
	}
	in.Values = map[string]any{"next_action": "footprints"}
	if _, _, e = s.CardReplay(ctx, in, interactive.Fingerprint(in, "Explain the clue"), "continue"); !errors.Is(e, ErrCardConflict) {
		t.Fatal("request identity reused with changed values")
	}
	input.ClientRequestID = "second-window"
	if _, e = s.BeginGenerationBatch(ctx, input); !errors.Is(e, ErrCardConflict) {
		t.Fatal("run consumed twice", e)
	}
	r, e = s.MaterializeCard(ctx, in.GenerationID)
	if e != nil || r.CanContinue || r.SubmittedBatchID != b.ID || r.Values["next_action"] != "radio" {
		t.Fatal("submitted card changed", r, e)
	}
	if _, e = s.SaveCard(ctx, interactive.Submission{GenerationID: r.GenerationID, Revision: r.Revision, Values: map[string]any{"next_action": "footprints"}}); !errors.Is(e, ErrCardConflict) {
		t.Fatal("changed consumed run")
	}
	if e = s.DeleteConversation(ctx, c.ID); e != nil {
		t.Fatal(e)
	}
	var count int
	s.db.QueryRow(`SELECT count(*) FROM interactive_runs`).Scan(&count)
	if count != 0 {
		t.Fatal("orphan card records")
	}
}
func TestInteractiveAdmissionRejectsObsoleteSourcesAndRollsBack(t *testing.T) {
	ctx := context.Background()
	s, e := OpenSQLite(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	c, _, r := seedCard(t, s)
	in := interactive.Submission{GenerationID: r.GenerationID, Values: map[string]any{"next_action": "radio"}}
	summary, content, e := s.PrepareCard(ctx, in, "")
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.BeginGenerationBatch(ctx, BeginGenerationBatchInput{ConversationID: c.ID, ClientRequestID: "other-turn", Body: "Another question", Targets: []GenerationTargetInput{{ProviderID: "fixture", ModelID: "fixture", Snapshot: ProviderSnapshot{ProviderID: "fixture", ModelID: "fixture"}}}})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.BeginGenerationBatch(ctx, BeginGenerationBatchInput{ConversationID: c.ID, ClientRequestID: "racing-card", Body: summary, InputContent: content, Card: &in, Targets: []GenerationTargetInput{{ProviderID: "fixture", ModelID: "fixture", Snapshot: ProviderSnapshot{ProviderID: "fixture", ModelID: "fixture"}}}}); !errors.Is(e, ErrCardConflict) {
		t.Fatal("stale source admitted", e)
	}
	r, e = s.MaterializeCard(ctx, r.GenerationID)
	if e != nil || r.CanContinue || r.SubmittedBatchID != "" {
		t.Fatal("failed admission consumed card")
	}
	if _, e = s.GetGenerationBatchByClientRequestID(ctx, "racing-card"); !errors.Is(e, sql.ErrNoRows) {
		t.Fatal("failed admission left a batch")
	}
}

func TestInteractiveBranchCopiesValuesAndDropsEditedSnapshot(t *testing.T) {
	ctx := context.Background()
	s, e := OpenSQLite(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	c, _, r := seedCard(t, s)
	in := interactive.Submission{GenerationID: r.GenerationID, Values: map[string]any{"next_action": "radio"}, Checks: map[string]string{}}
	body, content, e := s.PrepareCard(ctx, in, "")
	if e != nil {
		t.Fatal(e)
	}
	targets := []GenerationTargetInput{{ProviderID: "fixture", ModelID: "fixture", Snapshot: ProviderSnapshot{ProviderID: "fixture", ModelID: "fixture"}}}
	second, e := s.BeginGenerationBatch(ctx, BeginGenerationBatchInput{ConversationID: c.ID, ClientRequestID: "choice", Body: body, InputContent: content, Targets: targets, Card: &in, CardFingerprint: interactive.Fingerprint(in, "")})
	if e != nil {
		t.Fatal(e)
	}
	if e = s.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: second.Targets[0].Generation.ID, Body: "A new scene"}); e != nil {
		t.Fatal(e)
	}
	branch, e := s.BeginGenerationBatch(ctx, BeginGenerationBatchInput{ConversationID: c.ID, EditOfBatchID: second.ID, ClientRequestID: "branch", Body: "I choose the footprints instead.", Targets: targets})
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(branch.InputContent, "radio") {
		t.Fatal("plain-text edit retained contradictory structured values")
	}
	copied, e := s.MaterializeCard(ctx, branch.ContextItems[0].SelectedGenerationID)
	if e != nil || copied.Values["next_action"] != "radio" || copied.SubmittedBatchID == "" {
		t.Fatal("branch lost historical card state", e)
	}
	if e = s.DeleteConversation(ctx, c.ID); e != nil {
		t.Fatal(e)
	}
	copied, e = s.MaterializeCard(ctx, copied.GenerationID)
	if e != nil || copied.Values["next_action"] != "radio" {
		t.Fatal("deleting source removed independent card state", e)
	}
}

func TestRichCardStateRestoresAndFreezesSubmittedInput(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "rich.sqlite")
	s, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	c, _, r := seedCard(t, s, "playground")
	in := interactive.Submission{GenerationID: r.GenerationID, Values: map[string]any{"order": []any{"gallery", "walk", "lunch"}, "food": float64(0), "travel": float64(25), "draft": "An edited invitation"}, Checks: map[string]string{}}
	saved, err := s.SaveCard(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	in.Revision = saved.Revision
	s.Close()
	s, err = OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	restored, err := s.MaterializeCard(ctx, r.GenerationID)
	if err != nil || restored.Values["food"] != float64(0) || restored.Values["draft"] != "An edited invitation" {
		t.Fatal("rich state did not restore", err)
	}
	summary, content, err := s.PrepareCard(ctx, in, "")
	if err != nil || !strings.Contains(content, `"remaining":75`) || !strings.Contains(summary, "Explore a small gallery > Walk by the river > Lunch with a friend") {
		t.Fatal("rich snapshot lost meaning", err)
	}
	b, err := s.BeginGenerationBatch(ctx, BeginGenerationBatchInput{Interactive: true, ConversationID: c.ID, ClientRequestID: "rich-continue", Body: summary, InputContent: content, Card: &in, CardFingerprint: interactive.Fingerprint(in, ""), Targets: []GenerationTargetInput{{ProviderID: "fixture", ModelID: "fixture", Snapshot: ProviderSnapshot{ProviderID: "fixture", ModelID: "fixture"}}}})
	if err != nil {
		t.Fatal(err)
	}
	in.Values["draft"] = "A later edit"
	if _, err = s.SaveCard(ctx, in); !errors.Is(err, ErrCardConflict) {
		t.Fatal("submitted edit mutated", err)
	}
	savedBatch, err := s.GetGenerationBatch(ctx, b.ID)
	if err != nil || savedBatch.InputContent != content {
		t.Fatal("snapshot changed", err)
	}
}

func TestDiscussIncompleteCardKeepsQuestionAndFreezesSnapshot(t *testing.T) {
	ctx := context.Background()
	s, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	c, _, r := seedCard(t, s)
	input := interactive.Submission{GenerationID: r.GenerationID, Revision: r.Revision, Values: r.Values, Checks: r.Checks}
	if _, _, err = s.PrepareCard(ctx, input, "Explain these options"); err == nil {
		t.Fatal("Continue accepted incomplete required fields")
	}
	input.Intent = "discuss"
	body, content, err := s.PrepareCard(ctx, input, "Explain these options")
	if err != nil || body != "Explain these options" || !strings.Contains(content, `"intent":"discuss"`) || !strings.Contains(content, `"next_action":""`) {
		t.Fatal("discussion context", err)
	}
	b, err := s.BeginGenerationBatch(ctx, BeginGenerationBatchInput{Interactive: true, ConversationID: c.ID, ClientRequestID: "discuss", Body: body, InputContent: content, Card: &input, CardFingerprint: interactive.Fingerprint(input, body), Targets: []GenerationTargetInput{{ProviderID: "fixture", ModelID: "fixture", Snapshot: ProviderSnapshot{ProviderID: "fixture", ModelID: "fixture"}}}})
	if err != nil {
		t.Fatal(err)
	}
	frozen, err := s.MaterializeCard(ctx, r.GenerationID)
	if err != nil || frozen.SubmittedBatchID != b.ID || frozen.CanContinue {
		t.Fatal("discussion did not freeze source", err)
	}
}

func TestCapturedGuideBudgetDoesNotReduceWorkspacePromptLimit(t *testing.T) {
	ctx := context.Background()
	s, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	settings := Settings{Theme: "system", Locale: "en", SystemPrompt: strings.Repeat("x", 8192)}
	if err = s.UpdateSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	combined := GenerationConfigurationSnapshot{SystemPrompt: settings.SystemPrompt + interactive.Prompt()}
	if err = validateGenerationConfigurationSnapshot(combined); err != nil {
		t.Fatal("valid workspace prompt rejected after host guidance", err)
	}
	settings.SystemPrompt += "x"
	if s.UpdateSettings(ctx, settings) == nil {
		t.Fatal("workspace prompt limit changed")
	}
	if validateGenerationConfigurationSnapshot(GenerationConfigurationSnapshot{SystemPrompt: strings.Repeat("x", 32769)}) == nil {
		t.Fatal("unbounded captured prompt")
	}
}

func TestLocalOnlyCardCannotInitiateModelTurn(t *testing.T) {
	ctx := context.Background()
	s, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	_, _, run := seedCard(t, s, "local-reveal")
	if run.CanContinue {
		t.Fatal("local card was eligible for model continuation")
	}
	_, _, err = s.PrepareCard(ctx, interactive.Submission{GenerationID: run.GenerationID, Revision: run.Revision, Values: run.Values, Checks: run.Checks, Intent: "discuss"}, "Send this anyway")
	if !errors.Is(err, interactive.ErrInvalid) {
		t.Fatal("local-only source admitted", err)
	}
}

func TestUnreleasedPreviewSchema28RetainsCardsWhenMainMigrationIsAdded(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "preview.sqlite")
	s, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	_, _, run := seedCard(t, s)
	if _, err = s.db.Exec(`ALTER TABLE project_source_indexes DROP COLUMN source_snapshot; PRAGMA user_version=28`); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if pragmaInt(t, s.db, "user_version") != 29 {
		t.Fatal("preview not upgraded")
	}
	rows, err := s.db.Query(`SELECT source_snapshot FROM project_source_indexes LIMIT 0`)
	if err != nil {
		t.Fatal("main migration missing", err)
	}
	rows.Close()
	if _, err = s.MaterializeCard(ctx, run.GenerationID); err != nil {
		t.Fatal("preview run lost", err)
	}
}
