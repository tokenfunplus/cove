package chat

import (
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
