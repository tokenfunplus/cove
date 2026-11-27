package speech

import (
	"context"
	"errors"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

const systemSay = "/usr/bin/say"

func SystemJapaneseAvailable(ctx context.Context) bool {
	_, err := installedJapaneseVoice(ctx)
	return err == nil
}

func installedJapaneseVoice(ctx context.Context) (Voice, error) {
	unavailable := errors.New("No installed macOS Japanese voice is available for local playback.")
	if runtime.GOOS != "darwin" {
		return Voice{}, unavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, systemSay, "-v", "?")
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LANG=en_US.UTF-8"}
	list, err := cmd.Output()
	if err != nil {
		return Voice{}, unavailable
	}
	// The voice name may contain spaces. The locale is the final column before the sample.
	fallback := ""
	for _, line := range strings.Split(string(list), "\n") {
		nameAndLocale, _, ok := strings.Cut(line, "#")
		if !ok {
			continue
		}
		fields := strings.Fields(nameAndLocale)
		if len(fields) < 2 || fields[len(fields)-1] != "ja_JP" {
			continue
		}
		name := strings.Join(fields[:len(fields)-1], " ")
		if name == "Kyoko" {
			return Voice{ID: name, Name: name, Language: "ja"}, nil
		}
		if fallback == "" {
			fallback = name
		}
	}
	if fallback != "" {
		return Voice{ID: fallback, Name: fallback, Language: "ja"}, nil
	}
	return Voice{}, unavailable
}

func (manager *Manager) synthesizeJapanese(ctx context.Context, job string, voice Voice, parts []string, receive func([]byte) error) error {
	for _, part := range parts {
		if err := ctx.Err(); err != nil {
			return err
		}
		wave, err := manager.audio.RenderChunk(job, func(path string) error {
			cmd := exec.CommandContext(ctx, systemSay, "-v", voice.ID, "-o", path, "--file-format=WAVE", "--data-format=LEI16@22050", "-f", "-")
			cmd.Env = []string{"PATH=/usr/bin:/bin", "LANG=en_US.UTF-8"}
			// Treat embedded macOS speech directives as literal prose.
			cmd.Stdin = strings.NewReader(strings.ReplaceAll(part, "[[", "[ ["))
			cmd.WaitDelay = time.Second
			if err := cmd.Run(); err != nil {
				return errors.New("The installed Japanese voice could not prepare this reading.")
			}
			return nil
		})
		if err != nil {
			return err
		}
		wave, err = normalizeWave(wave)
		if err != nil {
			return err
		}
		if err = receive(wave); err != nil {
			return err
		}
	}
	return nil
}
