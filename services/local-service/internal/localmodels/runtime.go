package localmodels

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type worker struct {
	command       *exec.Cmd
	done          chan struct{}
	endpoint, key string
	directory     string
	client        *http.Client
	lastUsed      time.Time
}

func (manager *Manager) stopWorker(id string) {
	if w := manager.workers[id]; w != nil {
		_ = w.command.Process.Kill()
		<-w.done
		manager.mu.Lock()
		measurement := manager.metrics[id]
		measurement.PeakResidentBytes = peakResidentBytes(w.command.ProcessState)
		manager.metrics[id] = measurement
		manager.mu.Unlock()
		w.client.CloseIdleConnections()
		_ = os.RemoveAll(w.directory)
		delete(manager.workers, id)
	}
}

// The caller owns the manager gate for the worker's entire request/stream.
func (manager *Manager) startWorker(ctx context.Context, id string) (*worker, error) {
	started := time.Now()
	for other := range manager.workers {
		if other != id {
			manager.stopWorker(other)
		}
	}
	if w := manager.workers[id]; w != nil {
		select {
		case <-w.done:
			manager.stopWorker(id)
		default:
			w.lastUsed = time.Now()
			return w, nil
		}
	}
	for other, w := range manager.workers {
		if time.Since(w.lastUsed) > 2*time.Minute {
			manager.stopWorker(other)
		}
	}
	if !manager.RuntimeReady() {
		return nil, errors.New("The bundled inference runtime is unavailable.")
	}
	m, err := Lookup(id)
	if err != nil {
		return nil, err
	}
	path, err := manager.files.Verify(ctx, id, m.SHA256, m.Bytes)
	if err != nil {
		return nil, err
	}
	// A private Unix socket removes TCP port handoff and peer-impersonation races.
	// Keep the path short enough for Darwin's sockaddr_un limit.
	directory, err := os.MkdirTemp("/tmp", "cove-infer-")
	if err != nil {
		return nil, err
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(directory)
		}
	}()
	socketPath := filepath.Join(directory, "worker.sock")
	var random [32]byte
	if _, err = rand.Read(random[:]); err != nil {
		return nil, err
	}
	key := hex.EncodeToString(random[:])
	keyPath := filepath.Join(directory, "auth")
	if err = os.WriteFile(keyPath, []byte(key), 0600); err != nil {
		return nil, err
	}
	args := []string{"--model", path, "--alias", id, "--host", socketPath, "--api-key-file", keyPath, "--parallel", "1", "--no-webui", "--no-warmup", "--ctx-size", "512", "--batch-size", "512", "--ubatch-size", "512", "--gpu-layers", "0"}
	if m.Role == "embedding" {
		args = append(args, "--embeddings", "--pooling", "cls")
	} else {
		args = append(args, "--ctx-size", "4096", "--gpu-layers", "99", "--jinja", "--no-context-shift")
		if id == Qwen3AbliteratedID {
			args = append(args, "--chat-template-kwargs", `{"enable_thinking":false}`)
		}
	}
	command := exec.CommandContext(manager.lifetime, manager.executable, args...)
	command.Env = []string{"PATH=/usr/bin:/bin", "TMPDIR=" + os.TempDir()}
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	if err = command.Start(); err != nil {
		return nil, errors.New("The local inference worker could not start.")
	}
	w := &worker{command: command, done: make(chan struct{}), endpoint: "http://127.0.0.1", key: key, directory: directory, client: workerClient(socketPath), lastUsed: time.Now()}
	cleanup = false
	go func() { _ = command.Wait(); close(w.done) }()
	manager.workers[id] = w
	ready, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	client := w.client
	for {
		select {
		case <-ready.Done():
			manager.stopWorker(id)
			return nil, errors.New("Local model loading was stopped or timed out.")
		case <-w.done:
			manager.stopWorker(id)
			return nil, errors.New("The local inference worker exited while loading the model.")
		case <-ticker.C:
			probe, err := http.NewRequestWithContext(ready, http.MethodGet, w.endpoint+"/health", nil)
			if err != nil {
				return nil, err
			}
			probe.Header.Set("Authorization", "Bearer "+key)
			response, err := client.Do(probe)
			if err == nil {
				_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
				response.Body.Close()
				if response.StatusCode == 200 {
					manager.mu.Lock()
					manager.metrics[id] = Measurement{LoadMS: time.Since(started).Milliseconds()}
					manager.mu.Unlock()
					return w, nil
				}
			}
		}
	}
}

func (manager *Manager) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	ctx, cancel := context.WithTimeout(ctx, manager.embeddingTimeout)
	defer cancel()
	if len(texts) == 0 || len(texts) > 16 {
		return nil, errors.New("Embedding batches must contain one to sixteen texts.")
	}
	if err := manager.acquire(ctx); err != nil {
		return nil, err
	}
	defer manager.release()
	defer func() {
		if ctx.Err() != nil {
			manager.stopWorker(EmbeddingID)
		}
	}()
	w, err := manager.startWorker(ctx, EmbeddingID)
	if err != nil {
		return nil, err
	}
	payload, _ := json.Marshal(map[string]any{"model": EmbeddingID, "input": texts, "encoding_format": "float"})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, w.endpoint+"/v1/embeddings", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+w.key)
	response, err := w.client.Do(request)
	if err != nil {
		return nil, errors.New("Local embedding inference failed or was stopped.")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, errors.New("Local embedding inference rejected the input.")
	}
	var result struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&result); err != nil || len(result.Data) != len(texts) {
		return nil, errors.New("Local embedding inference returned an invalid response.")
	}
	vectors := make([][]float32, len(texts))
	for _, row := range result.Data {
		if row.Index < 0 || row.Index >= len(texts) || vectors[row.Index] != nil || len(row.Embedding) != 512 {
			return nil, errors.New("The local embedding dimension or response order is invalid.")
		}
		var norm float64
		for _, v := range row.Embedding {
			if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
				return nil, errors.New("Local inference returned a non-finite vector.")
			}
			norm += float64(v) * float64(v)
		}
		if norm < 1e-12 {
			return nil, errors.New("Local inference returned an empty vector.")
		}
		scale := float32(1 / math.Sqrt(norm))
		for i := range row.Embedding {
			row.Embedding[i] *= scale
		}
		vectors[row.Index] = row.Embedding
	}
	w.lastUsed = time.Now()
	return vectors, nil
}
