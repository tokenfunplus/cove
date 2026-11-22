package persistence

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ModelFiles owns downloaded weights. Callers supply only registry identities.
type ModelFiles struct{ Root string }

func (files ModelFiles) Path(id, digest string) string {
	return filepath.Join(files.Root, id, digest+".gguf")
}

func (files ModelFiles) Installed(id, digest string, size int64) bool {
	info, err := os.Stat(files.Path(id, digest))
	return err == nil && info.Mode().IsRegular() && info.Size() == size
}

func (files ModelFiles) Verify(ctx context.Context, id, digest string, size int64) (string, error) {
	path := files.Path(id, digest)
	file, err := os.Open(path)
	if err != nil {
		return "", errors.New("Download and install this model first.")
	}
	defer file.Close()
	hash := sha256.New()
	n, err := io.Copy(hash, &contextReader{ctx: ctx, reader: io.LimitReader(file, size+1)})
	if err != nil {
		return "", err
	}
	if n != size || hex.EncodeToString(hash.Sum(nil)) != digest {
		return "", errors.New("The model failed its integrity check. Remove it and download it again.")
	}
	return path, nil
}

func (files ModelFiles) Install(ctx context.Context, id, digest string, size int64, reader io.Reader, progress func(int64)) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	directory := filepath.Dir(files.Path(id, digest))
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	if err := files.cleanPartialDownloads(id, digest); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".download-*")
	if err != nil {
		return err
	}
	defer os.Remove(temporary.Name())
	defer temporary.Close()
	hash := sha256.New()
	buffer := make([]byte, 64<<10)
	var total int64
	input := io.LimitReader(reader, size+1)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		count, readErr := input.Read(buffer)
		if count > 0 {
			if _, err := io.MultiWriter(temporary, hash).Write(buffer[:count]); err != nil {
				return err
			}
			total += int64(count)
			if progress != nil {
				progress(total)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if total != size || hex.EncodeToString(hash.Sum(nil)) != digest {
		return fmt.Errorf("The download failed its size or SHA-256 check.")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporary.Name(), files.Path(id, digest))
}

func (files ModelFiles) Remove(id, digest string) error {
	err := os.Remove(files.Path(id, digest))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return files.cleanPartialDownloads(id, digest)
}

// The manager serializes downloads and removal for each model. Only Cove's
// private temporary weights are removed; unrelated entries remain untouched.
func (files ModelFiles) cleanPartialDownloads(id, digest string) error {
	directory := filepath.Dir(files.Path(id, digest))
	entries, err := os.ReadDir(directory)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Type().IsRegular() && strings.HasPrefix(entry.Name(), ".download-") {
			if err := os.Remove(filepath.Join(directory, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	return nil
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (reader *contextReader) Read(buffer []byte) (int, error) {
	if err := reader.ctx.Err(); err != nil {
		return 0, err
	}
	return reader.reader.Read(buffer)
}
