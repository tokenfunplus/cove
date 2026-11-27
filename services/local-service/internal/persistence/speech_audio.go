package persistence

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// SpeechAudio retains only bounded, private, short-lived synthesized waveforms.
type SpeechAudio struct{ Root string }

var speechJobIdentity = regexp.MustCompile(`^[0-9a-f]{32}$`)

func (files SpeechAudio) job(id string) (string, error) {
	if !speechJobIdentity.MatchString(id) {
		return "", errors.New("invalid speech job identity")
	}
	return filepath.Join(files.Root, "job-"+id), nil
}
func (files SpeechAudio) Create(id string) error {
	directory, err := files.job(id)
	if err != nil {
		return err
	}
	return os.MkdirAll(directory, 0700)
}
func (files SpeechAudio) Write(id string, index int, bytes []byte) error {
	directory, err := files.job(id)
	if err != nil {
		return err
	}
	if index < 0 || index >= 128 || len(bytes) > 12<<20 {
		return errors.New("speech audio chunk exceeds its limit")
	}
	return os.WriteFile(filepath.Join(directory, fmt.Sprintf("%02d.wav", index)), bytes, 0600)
}
func (files SpeechAudio) Read(id string, index int) ([]byte, error) {
	directory, err := files.job(id)
	if err != nil {
		return nil, err
	}
	if index < 0 || index >= 128 {
		return nil, errors.New("invalid speech chunk")
	}
	return os.ReadFile(filepath.Join(directory, fmt.Sprintf("%02d.wav", index)))
}
func (files SpeechAudio) Remove(id string) error {
	directory, err := files.job(id)
	if err != nil {
		return err
	}
	return os.RemoveAll(directory)
}
func (files SpeechAudio) Clear() error {
	entries, err := os.ReadDir(files.Root)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "job-") && speechJobIdentity.MatchString(strings.TrimPrefix(entry.Name(), "job-")) {
			if err = os.RemoveAll(filepath.Join(files.Root, entry.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}

// RenderChunk provides a private, seekable output file to a local speech engine.
// The job directory is also cleared at startup after an unclean shutdown.
func (files SpeechAudio) RenderChunk(id string, render func(string) error) ([]byte, error) {
	directory, err := files.job(id)
	if err != nil {
		return nil, err
	}
	file, err := os.CreateTemp(directory, "render-*.wav")
	if err != nil {
		return nil, err
	}
	defer os.Remove(file.Name())
	if err = file.Close(); err != nil {
		return nil, err
	}
	if err = render(file.Name()); err != nil {
		return nil, err
	}
	file, err = os.Open(file.Name())
	if err != nil {
		return nil, err
	}
	defer file.Close()
	const limit = 12 << 20
	wave, err := io.ReadAll(io.LimitReader(file, limit+1))
	if len(wave) > limit {
		return nil, errors.New("speech audio chunk exceeds its limit")
	}
	return wave, err
}
