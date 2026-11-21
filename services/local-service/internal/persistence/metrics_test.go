package persistence

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"
)

func TestGenerationMetricsSurviveRestartWithoutInventingLegacyUsage(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "metrics.sqlite")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, "Metrics fixture")
	if err != nil {
		t.Fatal(err)
	}
	generation, err := store.BeginGeneration(ctx, BeginGenerationInput{ConversationID: conversation.ID, ClientRequestID: "metrics", Body: "Question", Snapshot: ProviderSnapshot{ProviderID: "fixture", ProviderName: "Fixture", ModelID: "fixture", TransportSecurity: "tls"}})
	if err != nil {
		t.Fatal(err)
	}
	first, output, inputTokens, outputTokens := int64(0), int64(500), int64(0), int64(42)
	metrics := &GenerationMetrics{Source: "service", DurationMS: 1000, TimeToFirstTokenMS: &first, OutputDurationMS: &output, InputTokens: &inputTokens, OutputTokens: &outputTokens}
	if err := store.CompleteGeneration(ctx, CompleteGenerationInput{GenerationID: generation.ID, Body: "Answer", Metrics: metrics}); err != nil {
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
	got, err := store.GetGeneration(ctx, generation.ID)
	if err != nil || !reflect.DeepEqual(got.Metrics, metrics) {
		t.Fatalf("saved metrics = %#v, err = %v", got.Metrics, err)
	}
	dropWebSearchSchema(t, store)
	if _, err := store.db.Exec(`DROP TABLE debate_turns; DROP TABLE debate_interventions; DROP TABLE debate_sessions; DROP TABLE conversation_branches; ALTER TABLE messages DROP COLUMN reasoning; ALTER TABLE generations DROP COLUMN metrics; PRAGMA user_version = 16;`); err != nil {
		t.Fatal(err)
	}
	if err := store.migrate(); err != nil {
		t.Fatal(err)
	}
	legacy, err := store.GetGeneration(ctx, generation.ID)
	if err != nil || legacy.Metrics != nil {
		t.Fatalf("legacy metrics = %#v, err = %v", legacy.Metrics, err)
	}
}

func TestInvalidBrowserMeasurementsAreRejected(t *testing.T) {
	tooLate, negative := int64(101), int64(-1)
	for _, metrics := range []*GenerationMetrics{
		{Source: "browser", DurationMS: -1},
		{Source: "browser", DurationMS: 100, TimeToFirstTokenMS: &tooLate},
		{Source: "browser", DurationMS: 100, InputTokens: &negative},
		{Source: "unknown", DurationMS: 100},
	} {
		if validateGenerationMetrics(metrics) == nil {
			t.Fatalf("accepted invalid metrics: %#v", metrics)
		}
	}
}
