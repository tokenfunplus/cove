package speech

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestReadingProjectsLegacyReasoningAndPreservesRenderedSelections(t *testing.T) {
	for _, input := range []string{"<think>Hidden plan</think>Visible answer.", "<think>" + strings.Repeat("\u0130", 100) + "hidden</think>Visible answer.", "  <ANALYSIS>Hidden</ANALYSIS>\n<reasoning>More hidden</reasoning>Visible answer."} {
		value, err := PlainText(input, false)
		if err != nil || value != "Visible answer." {
			t.Fatal("reasoning entered the spoken/exported projection", value, err)
		}
	}
	if _, err := PlainText("<think>Unfinished reasoning", false); err == nil {
		t.Fatal("unclosed reasoning became speech")
	}
	value, err := PlainText("Use `values[0]` [S1].\n\n```go\nvalues[2]\n```", true)
	if err != nil || !strings.Contains(value, "values[0]") || !strings.Contains(value, "values[2]") || strings.Contains(value, "[S1]") {
		t.Fatal("citation cleanup changed literal code", value, err)
	}
	value, err = selectionText("> 5 values[0] &amp;")
	if err != nil || value != "> 5 values[0] &amp;" {
		t.Fatal("rendered selection was reparsed", value, err)
	}
}

func TestPocketPipeCopyCannotBypassItsOutputBound(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { defer close(done); defer writer.Close(); writer.Write(bytes.Repeat([]byte{1}, (12<<20)+1)) }()
	defer func() { reader.Close(); writer.Close(); <-done }()
	var output boundedAudio
	if _, err := io.Copy(&output, reader); err == nil {
		t.Fatal("pipe copy bypassed boundedAudio.Write")
	}
	if output.buffer.Len() > 12<<20 {
		t.Fatal("retained excessive audio")
	}
}

func fixtureWave() []byte {
	wave := make([]byte, 48)
	copy(wave, "RIFF")
	binary.LittleEndian.PutUint32(wave[4:], 40)
	copy(wave[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(wave[16:], 16)
	binary.LittleEndian.PutUint16(wave[20:], 1)
	binary.LittleEndian.PutUint16(wave[22:], 1)
	binary.LittleEndian.PutUint32(wave[24:], 24000)
	binary.LittleEndian.PutUint16(wave[34:], 16)
	copy(wave[36:], "data")
	binary.LittleEndian.PutUint32(wave[40:], 4)
	return wave
}
func TestOnlyPocketIngressRepairsItsExactStreamingWAVPlaceholder(t *testing.T) {
	wave := fixtureWave()
	binary.LittleEndian.PutUint32(wave[40:], 8)
	if _, err := normalizeWave(wave); err == nil {
		t.Fatal("truncated stored/framed WAV was accepted")
	}
	if _, err := normalizePocketWave(wave); err == nil {
		t.Fatal("ordinary truncated Pocket WAV was repaired")
	}
	binary.LittleEndian.PutUint32(wave[40:], 2000000000)
	if _, err := normalizeWave(wave); err == nil {
		t.Fatal("Pocket placeholder escaped ingress")
	}
	if _, err := normalizePocketWave(wave); err != nil {
		t.Fatal("pinned Pocket stdout format rejected", err)
	}
}

func TestFailedAudioCleanupRemainsPrivateAndRetryable(t *testing.T) {
	root := t.TempDir()
	store, err := persistence.OpenSQLite(filepath.Join(root, "state.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager := New(root, "", store)
	defer manager.Close()
	id := strings.Repeat("b", 32)
	done := make(chan struct{})
	close(done)
	if err := manager.audio.Create(id); err != nil {
		t.Fatal(err)
	}
	if err := manager.audio.Write(id, 0, fixtureWave()); err != nil {
		t.Fatal(err)
	}
	manager.mu.Lock()
	manager.jobs[id] = &Job{JobStatus: JobStatus{ID: id, State: "completed", ReadyChunks: 1}, owner: "owner", conversationID: "chat", done: done, cancel: func() {}, accessed: time.Now()}
	manager.mu.Unlock()
	original := manager.audio.Root
	blocker := filepath.Join(root, "file-instead-of-directory")
	if err := os.WriteFile(blocker, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	manager.audio.Root = blocker
	if err := manager.CancelConversation(context.Background(), "chat"); err == nil {
		t.Fatal("cleanup fixture did not fail")
	}
	if _, err := manager.Status("owner", id); !errors.Is(err, ErrNotFound) {
		t.Fatal("cleanup-pending job exposed status", err)
	}
	if _, err := manager.Audio("owner", id, 0); !errors.Is(err, ErrNotFound) {
		t.Fatal("cleanup-pending job exposed audio", err)
	}
	if _, err := manager.Download("owner", id); !errors.Is(err, ErrNotFound) {
		t.Fatal("cleanup-pending job exposed export", err)
	}
	manager.audio.Root = original
	if err := manager.Stop(context.Background(), "owner", id); err != nil {
		t.Fatal("cleanup could not be retried", err)
	}
	if _, err := os.Stat(filepath.Join(original, "job-"+id)); !os.IsNotExist(err) {
		t.Fatal("retry left temporary audio", err)
	}
}
