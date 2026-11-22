package speech

import (
	"context"
	"encoding/binary"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

type acceptanceTransport struct{ directory string }

func (source acceptanceTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	name := filepath.Base(request.URL.Path)
	file, err := os.Open(filepath.Join(source.directory, name))
	if err != nil {
		file, err = os.Open(filepath.Join(source.directory, "pocket-"+name))
	}
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: file, ContentLength: info.Size(), Request: request}, nil
}
func TestRealLocalSpeechAcceptance(t *testing.T) {
	if os.Getenv("COVE_TEST_LOCAL_SPEECH") != "1" {
		t.Skip("opt-in native speech acceptance")
	}
	assets := os.Getenv("COVE_TEST_SPEECH_ASSETS")
	runtime := os.Getenv("COVE_SPEECH_RUNTIME")
	if assets == "" || runtime == "" {
		t.Fatal("Set COVE_TEST_SPEECH_ASSETS and COVE_SPEECH_RUNTIME")
	}
	root := t.TempDir()
	store, err := persistence.OpenSQLite(filepath.Join(root, "cove.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager := New(root, runtime, store)
	defer manager.Close()
	manager.client.Transport = acceptanceTransport{directory: assets}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	for _, model := range Registry {
		t.Run(model.ID, func(t *testing.T) {
			if selected := os.Getenv("COVE_TEST_SPEECH_MODEL"); selected != "" && selected != model.ID {
				t.Skip("not selected")
			}
			if err := manager.Install(model.ID); err != nil {
				t.Fatal(err)
			}
			for {
				var state string
				for _, status := range manager.Statuses() {
					if status.ID == model.ID {
						state = status.State
						if state == "failed" {
							t.Fatal(status.Error)
						}
					}
				}
				if state == "installed" {
					break
				}
				select {
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-time.After(100 * time.Millisecond):
				}
			}
			settings := DefaultSettings()
			settings.Mode = "manual"
			settings.ModelID = model.ID
			if err := manager.SaveSettings(ctx, settings); err != nil {
				t.Fatal(err)
			}
			text := "Hello, Cove can read this answer on your Mac. Your text stays on this device."
			if model.Supports("zh") {
				text = "\u4f60\u597d\uff0c\u8fd9\u662f Cove \u7684\u672c\u5730\u6717\u8bfb\u6d4b\u8bd5\u3002\u4eca\u5929\u662f\u661f\u671f\u65e5\uff0c\u8bf7\u4fdd\u7559\u4e03\u5929\u7684\u5907\u4efd\u3002"
			}
			started := time.Now()
			job, err := manager.Start(ctx, "native-acceptance", Request{Text: text})
			if err != nil {
				t.Fatal(err)
			}
			var first time.Duration
			var final JobStatus
			for {
				final, err = manager.Status("native-acceptance", job.ID)
				if err != nil {
					t.Fatal(err)
				}
				if first == 0 && final.ReadyChunks > 0 {
					first = time.Since(started)
				}
				if final.State == "failed" || final.State == "stopped" {
					t.Fatalf("%s: %s", final.State, final.Error)
				}
				if final.State == "completed" {
					break
				}
				select {
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-time.After(50 * time.Millisecond):
				}
			}
			wave, err := manager.Download("native-acceptance", job.ID)
			if err != nil {
				t.Fatal(err)
			}
			if len(wave) < 2000 || string(wave[:4]) != "RIFF" {
				t.Fatal("No playable audio returned")
			}
			var energy float64
			for i := 44; i+1 < len(wave); i += 2 {
				sample := float64(int16(binary.LittleEndian.Uint16(wave[i:]))) / 32768
				energy += sample * sample
			}
			energy /= float64((len(wave) - 44) / 2)
			if energy < 0.00001 {
				t.Fatal("Speech is silent")
			}
			if _, err := manager.Audio("another-session", job.ID, 0); err == nil {
				t.Fatal("Speech audio crossed browser sessions")
			}
			if output := os.Getenv("COVE_TEST_SPEECH_OUTPUT"); output != "" {
				if err := os.MkdirAll(output, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(output, model.ID+".wav"), wave, 0600); err != nil {
					t.Fatal(err)
				}
			}
			t.Logf("model=%s first_audio_ms=%d elapsed_ms=%d chunks=%d audio_bytes=%d", model.ID, first.Milliseconds(), time.Since(started).Milliseconds(), final.ReadyChunks, len(wave))
			immediate, err := manager.Start(ctx, "native-acceptance", Request{Text: text})
			if err != nil {
				t.Fatal(err)
			}
			if err := manager.Stop(ctx, "native-acceptance", immediate.ID); err != nil {
				t.Fatal(err)
			}
			long, err := manager.Start(ctx, "native-acceptance", Request{Text: strings.Repeat(text+" ", 8)})
			if err != nil {
				t.Fatal(err)
			}
			// Observe output from a started worker while more passages remain.
			for {
				status, err := manager.Status("native-acceptance", long.ID)
				if err != nil {
					t.Fatal(err)
				}
				if status.ReadyChunks > 0 && status.ReadyChunks < status.TotalChunks {
					break
				}
				if status.State == "failed" || status.State == "completed" {
					t.Fatal("did not observe in-flight synthesis", status.State, status.Error)
				}
				select {
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-time.After(5 * time.Millisecond):
				}
			}
			stop := time.Now()
			if err := manager.Stop(ctx, "native-acceptance", long.ID); err != nil {
				t.Fatal(err)
			}
			if time.Since(stop) > 2*time.Second {
				t.Fatal("Stop did not promptly terminate synthesis")
			}
			if _, err := manager.Status("native-acceptance", long.ID); err == nil {
				t.Fatal("Stopped speech remained available")
			}
			if err := manager.Remove(ctx, model.ID); err != nil {
				t.Fatal(err)
			}
			if manager.files.Installed(model.Bundle()) {
				t.Fatal("Removed model remained installed")
			}
			preferences, err := manager.Settings(ctx)
			if err != nil || preferences.ModelID != model.ID {
				t.Fatal("Model removal changed saved preferences", err)
			}

		})
	}
}
