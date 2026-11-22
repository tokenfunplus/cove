package chat

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/speech"
)

func TestSpeechDiscoveryDoesNotRequireChatInference(t *testing.T) {
	root := t.TempDir()
	store, err := persistence.OpenSQLite(filepath.Join(root, "cove.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store, nil, nil)
	manager := speech.New(root, "", store)
	defer manager.Close()
	service.SetSpeech(manager)
	statuses, err := service.LocalModels()
	if err != nil || len(statuses) != 5 {
		t.Fatal("speech depends on chat inference", err)
	}
	for _, status := range statuses {
		if status.Role != "tts" {
			t.Fatal("speech exposed as a chat target")
		}
	}
}

func TestDebateReadingResolvesOnlySettledParticipantBodies(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store, err := persistence.OpenSQLite(filepath.Join(root, "cove.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store, nil, nil)
	manager := speech.New(root, "", store)
	defer manager.Close()
	service.SetSpeech(manager)
	input := debateInput()
	session, err := store.CreateDebate(ctx, persistence.DebateSession{ClientRequestID: "speech-debate", Topic: input.Topic, Seats: input.Seats, Rules: input.Rules, Status: "paused", Round: 1})
	if err != nil {
		t.Fatal(err)
	}
	for _, state := range []string{"completed", "streaming", "failed", "stopped", "summary"} {
		turn := persistence.DebateTurn{DebateID: session.ID, State: state, Body: "A public English position.", Reasoning: "\u4e0d\u8981\u6717\u8bfb\u63a8\u7406"}
		if state == "summary" {
			turn.State = "completed"
			turn.Kind = "summary"
		}
		saved, err := store.BeginDebateTurn(ctx, turn)
		if err != nil {
			t.Fatal(err)
		}
		_, err = service.ReadDebateAloud(ctx, "owner", DebateSpeechInput{DebateID: session.ID, TurnID: saved.ID})
		var required *speech.ModelRequiredError
		if state == "completed" {
			if !errors.As(err, &required) || required.Language != "en" {
				t.Fatal("did not synthesize the public body only", err)
			}
		} else if err == nil || errors.As(err, &required) {
			t.Fatalf("read non-participant or unsettled %s: %v", state, err)
		}
		if _, err = service.ReadDebateAloud(ctx, "owner", DebateSpeechInput{DebateID: "another-debate", TurnID: saved.ID}); !errors.Is(err, sql.ErrNoRows) {
			t.Fatal("turn escaped its owning debate", err)
		}
	}
}
