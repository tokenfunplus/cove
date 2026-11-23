package persistence

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
)

// ArtifactFetch returns a stream and whether the server honored the requested offset.
// Callers retain their pinned URL, redirect policy, and deadline.
type ArtifactFetch func(offset int64) (io.ReadCloser, bool, error)

// downloadArtifact retains interrupted bytes, but never publishes an unverified file.
// Explicit cancellation discards the partial file; network failures and timeouts can resume.
func downloadArtifact(ctx context.Context, directory, digest string, size int64, fetch ArtifactFetch, progress func(int64)) (string, error) {
	if !modelDigest.MatchString(digest) || size <= 0 || size > 1<<30 {
		return "", errModelIdentity
	}
	// Cancellation must also clear bytes retained by an earlier failed attempt.
	name := filepath.Join(directory, ".download-"+digest+".partial")
	discard := false
	defer func() {
		if discard || errors.Is(ctx.Err(), context.Canceled) {
			_ = os.Remove(name)
		}
	}()
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	file, err := os.OpenFile(name, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", err
	}
	offset := info.Size()
	if offset > size {
		if err := file.Truncate(0); err != nil {
			return "", err
		}
		offset = 0
	}
	if progress != nil {
		progress(offset)
	}
	if offset < size {
		body, resumed, err := fetch(offset)
		if err != nil {
			return "", err
		}
		defer body.Close()
		if offset > 0 && !resumed {
			if err = file.Truncate(0); err != nil {
				return "", err
			}
			offset = 0
		}
		if _, err = file.Seek(offset, io.SeekStart); err != nil {
			return "", err
		}
		buffer := make([]byte, 64<<10)
		input := &contextReader{ctx: ctx, reader: io.LimitReader(body, size-offset+1)}
		for {
			n, readErr := input.Read(buffer)
			if n > 0 {
				if _, err = file.Write(buffer[:n]); err != nil {
					return "", err
				}
				offset += int64(n)
				if progress != nil {
					progress(offset)
				}
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				return "", readErr
			}
		}
	}
	if offset != size {
		if offset > size {
			discard = true
		}
		return "", errors.New("The model download is incomplete. Retry to resume it.")
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	hash := sha256.New()
	if _, err = io.Copy(hash, &contextReader{ctx: ctx, reader: file}); err != nil {
		return "", err
	}
	if hex.EncodeToString(hash.Sum(nil)) != digest {
		discard = true
		return "", errors.New("The download failed its SHA-256 check. Retry to download a fresh copy.")
	}
	if err = ctx.Err(); err != nil {
		return "", err
	}
	if err = file.Sync(); err != nil {
		return "", err
	}
	return name, nil
}

func (files ModelFiles) Download(ctx context.Context, id, digest string, size int64, fetch ArtifactFetch, progress func(int64)) error {
	path := files.Path(id, digest)
	if path == "" {
		return errModelIdentity
	}
	partial, err := downloadArtifact(ctx, filepath.Dir(path), digest, size, fetch, progress)
	if err != nil {
		return err
	}
	return os.Rename(partial, path)
}

// Keep verified compressed assets until the complete bundle has been installed.
func (files ModelBundles) InstallResumable(ctx context.Context, bundle ModelBundle, fetch func(BundleArtifact, int64) (io.ReadCloser, bool, error), progress func(int64)) error {
	if err := validateBundle(bundle); err != nil {
		return err
	}
	directory := filepath.Join(filepath.Dir(files.Path(bundle)), ".resume-"+bundle.SHA256)
	var downloaded int64
	err := files.Install(ctx, bundle, func(asset BundleArtifact) (io.ReadCloser, error) {
		name, err := downloadArtifact(ctx, directory, asset.SHA256, asset.Bytes, func(offset int64) (io.ReadCloser, bool, error) { return fetch(asset, offset) }, func(n int64) {
			if progress != nil {
				progress(downloaded + n)
			}
		})
		if err != nil {
			return nil, err
		}
		downloaded += asset.Bytes
		return os.Open(name)
	}, nil)
	if err == nil || errors.Is(ctx.Err(), context.Canceled) {
		_ = os.RemoveAll(directory)
	}
	return err
}
