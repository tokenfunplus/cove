package speech

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func (manager *Manager) command(ctx context.Context, model Model, name string, args ...string) *exec.Cmd {
	command := exec.CommandContext(ctx, filepath.Join(manager.runtime, name), args...)
	command.Dir = manager.files.Path(model.Bundle())
	command.Env = []string{"PATH=/usr/bin:/bin", "LANG=en_US.UTF-8", "OMP_NUM_THREADS=2", "HF_HUB_OFFLINE=1", "HTTP_PROXY=http://127.0.0.1:1", "HTTPS_PROXY=http://127.0.0.1:1", "ALL_PROXY=http://127.0.0.1:1"}
	command.Stderr = io.Discard
	command.WaitDelay = time.Second
	return command
}
func (manager *Manager) runWorker(ctx context.Context, model Model, profile persistence.SpeechProfile, voice Voice, language string, threads int, parts []string, receive func([]byte) error) error {
	if model.Engine == "pocket" {
		return manager.runPocket(ctx, model, profile, voice, threads, parts, receive)
	}
	args := []string{"engine", model.Engine, "model", model.ModelFile, "tokens", model.TokensFile, "voices", model.VoicesFile, "data", model.DataDir, "dict", model.DictDir, "lexicon", strings.Join(model.Lexicon, ","), "rules", strings.Join(model.Rules, ","), "voice", strconv.Itoa(voice.Speaker), "speed", strconv.FormatFloat(profile.Speed, 'f', 3, 64), "threads", strconv.Itoa(threads), "noise", strconv.FormatFloat(profile.NoiseScale, 'f', 3, 64), "language", language}
	worker := "cove-speech-worker"
	if model.Engine == "kitten" {
		worker = "kitten/cove-speech-worker"
	}
	command := manager.command(ctx, model, worker, args...)
	var input bytes.Buffer
	for _, part := range parts {
		_ = binary.Write(&input, binary.LittleEndian, uint32(len([]byte(part))))
		input.WriteString(part)
	}
	command.Stdin = &input
	output, err := command.StdoutPipe()
	if err != nil {
		return errors.New("Local speech could not start.")
	}
	if err = command.Start(); err != nil {
		return errors.New("Local speech could not start. Check the bundled runtime.")
	}
	finished := false
	defer func() {
		if !finished {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
	}()
	for range parts {
		var size uint32
		if err = binary.Read(output, binary.LittleEndian, &size); err != nil {
			return errors.New("The local speech model could not prepare this reading. Try a shorter passage or another model.")
		}
		if size < 44 || size > 12<<20 {
			return errors.New("The local speech model returned invalid audio.")
		}
		wave := make([]byte, size)
		if _, err = io.ReadFull(output, wave); err != nil {
			return errors.New("Local speech ended before the audio was ready.")
		}
		wave, err = normalizeWave(wave)
		if err != nil {
			return err
		}
		if err = receive(wave); err != nil {
			return err
		}
	}
	if err = command.Wait(); err != nil {
		return errors.New("The local speech worker stopped unexpectedly.")
	}
	finished = true
	return nil
}
func (manager *Manager) runPocket(ctx context.Context, model Model, profile persistence.SpeechProfile, voice Voice, threads int, parts []string, receive func([]byte) error) error {
	// The config and all voice paths are local. The preset-only worker receives no tokens.
	for _, part := range parts {
		if err := ctx.Err(); err != nil {
			return err
		}
		args := []string{"generate", "--quiet", "--config", filepath.Join(manager.files.Path(model.Bundle()), "cove-config.yaml"), "--voice", voice.ID + ".safetensors", "--text", "-", "--output-path", "-", "--quantize", "--sampler-decode-steps", "1", "--temperature", strconv.FormatFloat(profile.Temperature, 'f', 3, 64)}
		command := manager.command(ctx, model, "pocket-tts", args...)
		command.Env = append(command.Env, "RAYON_NUM_THREADS="+strconv.Itoa(threads), "OMP_NUM_THREADS="+strconv.Itoa(threads))
		command.Stdin = strings.NewReader(part)
		var output boundedAudio
		command.Stdout = &output
		if err := command.Run(); err != nil {
			return errors.New("Pocket TTS could not prepare this reading. Try another voice or a shorter passage.")
		}
		wave, err := normalizeWave(output.Bytes())
		if err != nil {
			return err
		}
		if err = receive(wave); err != nil {
			return err
		}
	}
	return nil
}

type boundedAudio struct{ bytes.Buffer }

func (buffer *boundedAudio) Write(value []byte) (int, error) {
	if buffer.Len()+len(value) > 12<<20 {
		return 0, errors.New("Local speech exceeded the audio limit.")
	}
	return buffer.Buffer.Write(value)
}

func normalizeWave(wave []byte) ([]byte, error) {
	invalid := errors.New("The local speech worker returned invalid audio.")
	if len(wave) < 44 || string(wave[:4]) != "RIFF" || string(wave[8:12]) != "WAVE" {
		return nil, invalid
	}
	var format, channels, bits uint16
	var rate uint32
	var samples []byte
	for offset := 12; offset+8 <= len(wave); {
		kind := string(wave[offset : offset+4])
		size := uint64(binary.LittleEndian.Uint32(wave[offset+4 : offset+8]))
		offset += 8
		if kind == "data" {
			if size > uint64(len(wave)-offset) {
				size = uint64(len(wave) - offset)
			}
			samples = wave[offset : offset+int(size)]
			break
		}
		if size > uint64(len(wave)-offset) {
			return nil, invalid
		}
		if kind == "fmt " && size >= 16 {
			format = binary.LittleEndian.Uint16(wave[offset:])
			channels = binary.LittleEndian.Uint16(wave[offset+2:])
			rate = binary.LittleEndian.Uint32(wave[offset+4:])
			bits = binary.LittleEndian.Uint16(wave[offset+14:])
		}
		offset += int(size)
		if size%2 != 0 {
			offset++
		}
	}
	if channels != 1 || rate < 16000 || rate > 48000 || len(samples) == 0 {
		return nil, invalid
	}
	if format == 3 && bits == 32 {
		if len(samples)%4 != 0 {
			return nil, invalid
		}
		pcm := make([]byte, len(samples)/2)
		for i := 0; i < len(samples)/4; i++ {
			value := float64(math.Float32frombits(binary.LittleEndian.Uint32(samples[i*4:])))
			if math.IsNaN(value) || math.IsInf(value, 0) {
				value = 0
			}
			value = math.Max(-1, math.Min(1, value))
			binary.LittleEndian.PutUint16(pcm[i*2:], uint16(int16(value*32767)))
		}
		samples = pcm
	} else if format != 1 || bits != 16 || len(samples)%2 != 0 {
		return nil, invalid
	}
	result := make([]byte, 44+len(samples))
	copy(result, "RIFF")
	binary.LittleEndian.PutUint32(result[4:], uint32(len(result)-8))
	copy(result[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(result[16:], 16)
	binary.LittleEndian.PutUint16(result[20:], 1)
	binary.LittleEndian.PutUint16(result[22:], 1)
	binary.LittleEndian.PutUint32(result[24:], rate)
	binary.LittleEndian.PutUint32(result[28:], rate*2)
	binary.LittleEndian.PutUint16(result[32:], 2)
	binary.LittleEndian.PutUint16(result[34:], 16)
	copy(result[36:], "data")
	binary.LittleEndian.PutUint32(result[40:], uint32(len(samples)))
	copy(result[44:], samples)
	return result, nil
}
func joinWaves(waves [][]byte) ([]byte, error) {
	if len(waves) == 0 {
		return nil, errors.New("No speech audio is available.")
	}
	var result []byte
	for i, wave := range waves {
		normalized, err := normalizeWave(wave)
		if err != nil {
			return nil, err
		}
		if i == 0 {
			result = append(result, normalized...)
		} else {
			if !bytes.Equal(result[20:36], normalized[20:36]) {
				return nil, fmt.Errorf("Speech chunks have different audio formats.")
			}
			result = append(result, normalized[44:]...)
		}
		if len(result) > 32<<20 {
			return nil, errors.New("The audio export exceeds its limit.")
		}
	}
	binary.LittleEndian.PutUint32(result[4:], uint32(len(result)-8))
	binary.LittleEndian.PutUint32(result[40:], uint32(len(result)-44))
	return result, nil
}
