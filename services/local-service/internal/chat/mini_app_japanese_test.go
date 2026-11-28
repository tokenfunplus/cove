package chat

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/speech"
)

func TestMiniAppUsesInstalledJapaneseVoiceWithScopedAudio(t *testing.T) {
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
	if !service.JapaneseSpeechAvailable(t.Context()) {
		t.Skip("This machine has no installed macOS Japanese voice.")
	}
	const kanji = "\u65e5\u672c\u8a9e"
	const kana = "\u304a\u306f\u3088\u3046"
	for _, test := range []struct{ text, language string }{{kana, ""}, {kanji, "ja"}} {
		job, err := service.ReadMiniAppText(t.Context(), "book", "browser", test.text, test.language)
		if err != nil {
			t.Fatal(err)
		}
		if job.Language != "ja" || job.VoiceName == "" || job.ModelID != "macos-ja" {
			t.Fatal("incorrect Japanese job metadata")
		}
		owner := AppSpeechOwner("book", "browser")
		deadline := time.Now().Add(10 * time.Second)
		for job.State != "completed" {
			if job.State == "failed" || time.Now().After(deadline) {
				t.Fatalf("voice failed: %s", job.Error)
			}
			time.Sleep(20 * time.Millisecond)
			job, err = service.SpeechStatus(owner, job.ID)
			if err != nil {
				t.Fatal(err)
			}
		}
		audio, err := service.SpeechAudio(owner, job.ID, -1)
		if err != nil {
			t.Fatal(err)
		}
		if len(audio) < 1000 || string(audio[:4]) != "RIFF" || string(audio[8:12]) != "WAVE" || bytes.Equal(audio[44:], make([]byte, len(audio)-44)) {
			t.Fatal("no playable PCM waveform")
		}
		if _, err := service.SpeechAudio(AppSpeechOwner("book", "other"), job.ID, -1); !errors.Is(err, speech.ErrNotFound) {
			t.Fatal("voice crossed session boundary")
		}
		if err := service.RevokeAppSpeech(t.Context(), "book"); err != nil {
			t.Fatal(err)
		}
		if _, err := service.SpeechAudio(owner, job.ID, -1); !errors.Is(err, speech.ErrNotFound) {
			t.Fatal("revoked audio was available")
		}
		entries, err := os.ReadDir(filepath.Join(root, "speech-audio"))
		if err != nil || len(entries) != 0 {
			t.Fatal("job audio was retained", err)
		}
	}
}
