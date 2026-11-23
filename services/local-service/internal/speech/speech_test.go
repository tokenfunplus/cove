package speech

import (
	"context"
	"encoding/binary"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func TestReadingExtractsVisibleTextAndCodeOptIn(t *testing.T) {
	input := "# A **useful** answer\n\nRead [this label](https://example.com) [S1]. ![hidden picture](image.png)\n\n```go\nsecretCode()\n```\n\nUse `inlineCode` only when enabled.\n\n| Item | Value |\n| --- | --- |\n| Apples | Two |"
	result, err := PlainText(input, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, excluded := range []string{"https://", "S1", "secretCode", "inlineCode", "hidden picture", "**", "```"} {
		if strings.Contains(result, excluded) {
			t.Fatalf("reading included %q", excluded)
		}
	}
	for _, included := range []string{"A useful answer", "this label", "Apples Two"} {
		if !strings.Contains(result, included) {
			t.Fatalf("reading omitted %q: %s", included, result)
		}
	}
	result, err = PlainText(input, true)
	if err != nil || !strings.Contains(result, "secretCode()") || !strings.Contains(result, "inlineCode") {
		t.Fatal("code opt-in was not respected", err)
	}
	if _, err = PlainText("```go\ncode()\n```", false); err == nil {
		t.Fatal("accepted an empty reading")
	}
	if _, err = PlainText(strings.Repeat("x", 6001), false); err == nil {
		t.Fatal("accepted an unbounded reading")
	}
}
func TestReadingSplitsAtSentenceOrWordBoundaries(t *testing.T) {
	for _, input := range []string{strings.Repeat("Read this short English sentence. ", 40), strings.Repeat("\u8fd9\u662f\u4e00\u6bb5\u4e2d\u6587\u3002", 80)} {
		parts := splitText(input)
		if len(parts) < 2 {
			t.Fatal("reading was not segmented")
		}
		for _, part := range parts {
			if !utf8.ValidString(part) || utf8.RuneCountInString(part) > 240 || strings.TrimSpace(part) == "" {
				t.Fatal("invalid segment")
			}
		}
		if strings.ReplaceAll(strings.Join(parts, ""), " ", "") != strings.ReplaceAll(input, " ", "") {
			t.Fatal("segmentation lost text")
		}
	}
}
func TestSpeechPreferencesRejectUnsupportedChoices(t *testing.T) {
	value := DefaultSettings()
	value.ChineseModelID = "kitten-nano-en"
	if ValidateSettings(&value) == nil {
		t.Fatal("English model accepted for Chinese")
	}
	value = DefaultSettings()
	profile := value.Profiles["kokoro-en"]
	profile.VoiceID = "other-model-voice"
	value.Profiles["kokoro-en"] = profile
	if ValidateSettings(&value) == nil {
		t.Fatal("foreign voice accepted")
	}
	value = DefaultSettings()
	value.Volume = math.NaN()
	if ValidateSettings(&value) == nil {
		t.Fatal("NaN volume accepted")
	}
	value = DefaultSettings()
	value.Profiles = map[string]persistence.SpeechProfile{}
	if err := ValidateSettings(&value); err != nil || len(value.Profiles) != 5 {
		t.Fatal("default profiles were not restored", err)
	}
}
func TestSpeechRequiresInstalledModelAndOwnsTemporaryAudio(t *testing.T) {
	root := t.TempDir()
	store, err := persistence.OpenSQLite(filepath.Join(root, "cove.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager := New(root, "", store)
	defer manager.Close()
	_, err = manager.Start(context.Background(), "owner", Request{Text: "Read an answer."})
	var required *ModelRequiredError
	if !errors.As(err, &required) || required.Language != "en" {
		t.Fatal("missing voice did not offer installation", err)
	}
	id := strings.Repeat("a", 32)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	if err = manager.audio.Create(id); err != nil {
		t.Fatal(err)
	}
	if err = manager.audio.Write(id, 0, []byte("private audio")); err != nil {
		t.Fatal(err)
	}
	go func() { <-ctx.Done(); close(done) }()
	manager.mu.Lock()
	manager.jobs[id] = &Job{JobStatus: JobStatus{ID: id, State: "generating", ReadyChunks: 1}, owner: "owner", conversationID: "conversation", cancel: cancel, done: done, accessed: time.Now()}
	manager.mu.Unlock()
	if _, err = manager.Status("other", id); !errors.Is(err, ErrNotFound) {
		t.Fatal("job crossed session")
	}
	if _, err = manager.Audio("other", id, 0); !errors.Is(err, ErrNotFound) {
		t.Fatal("audio crossed session")
	}
	if err = manager.CancelConversation(context.Background(), "conversation"); err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Audio("owner", id, 0); !errors.Is(err, ErrNotFound) {
		t.Fatal("deleted chat retained audio")
	}
	entries, err := os.ReadDir(manager.audio.Root)
	if err != nil || len(entries) != 0 {
		t.Fatal("temporary audio remained", err)
	}
}
func TestWAVNormalizationAndExportRejectMalformedAudio(t *testing.T) {
	wave := make([]byte, 48)
	copy(wave, "RIFF")
	copy(wave[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(wave[16:], 16)
	binary.LittleEndian.PutUint16(wave[20:], 3)
	binary.LittleEndian.PutUint16(wave[22:], 1)
	binary.LittleEndian.PutUint32(wave[24:], 24000)
	binary.LittleEndian.PutUint16(wave[34:], 32)
	copy(wave[36:], "data")
	binary.LittleEndian.PutUint32(wave[40:], 4)
	binary.LittleEndian.PutUint32(wave[44:], math.Float32bits(.5))
	pcm, err := normalizeWave(wave)
	if err != nil || len(pcm) != 46 {
		t.Fatal("float WAV conversion failed", err)
	}
	joined, err := joinWaves([][]byte{pcm, pcm})
	if err != nil || len(joined) != 48 || binary.LittleEndian.Uint32(joined[40:]) != 4 {
		t.Fatal("invalid joined WAV", err)
	}
	if _, err = normalizeWave([]byte("invalid")); err == nil {
		t.Fatal("accepted invalid WAV")
	}
	binary.LittleEndian.PutUint32(pcm[24:], 48000)
	if _, err = joinWaves([][]byte{joined, pcm}); err == nil {
		t.Fatal("joined differing sample rates")
	}
}

func TestPreviewOverridesValidateWithoutSavingPreferences(t *testing.T) {
	root := t.TempDir()
	store, err := persistence.OpenSQLite(filepath.Join(root, "state.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager := New(root, "", store)
	defer manager.Close()
	for _, volume := range []float64{0, 1, -1, 1.1, math.NaN()} {
		threads := 1
		_, err = manager.Start(context.Background(), "owner", Request{Text: "A preview", RenderedText: true, Volume: &volume, Threads: &threads})
		var required *ModelRequiredError
		if volume >= 0 && volume <= 1 {
			if !errors.As(err, &required) {
				t.Fatal("valid override did not pass admission validation", err)
			}
		} else if err == nil || errors.As(err, &required) {
			t.Fatal("invalid volume reached model admission", err)
		}
	}
	invalidThreads := 5
	var required *ModelRequiredError
	if _, err = manager.Start(context.Background(), "owner", Request{Text: "Preview", Threads: &invalidThreads}); err == nil || errors.As(err, &required) {
		t.Fatal("invalid thread count accepted")
	}
	settings, err := manager.Settings(context.Background())
	if err != nil || settings.Volume != 0.9 || settings.Threads != 2 {
		t.Fatal("preview overrides changed saved preferences", err)
	}
}
