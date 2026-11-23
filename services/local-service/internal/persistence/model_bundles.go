package persistence

import (
	"archive/tar"
	"bytes"
	"compress/bzip2"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

type BundleArtifact struct {
	Filename string `json:"filename"`
	SHA256   string `json:"sha256"`
	Bytes    int64  `json:"bytes"`
}
type ModelBundle struct {
	ID          string
	SHA256      string
	ArchiveRoot string
	Artifacts   []BundleArtifact
	Required    []string
	Generated   map[string][]byte
}
type ModelBundles struct{ Root string }
type installedBundle struct {
	SHA256 string           `json:"sha256"`
	Files  []BundleArtifact `json:"files"`
}

var bundleIdentity = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,80}$`)
var bundleHash = regexp.MustCompile(`^[0-9a-f]{64}$`)

func (files ModelBundles) Path(bundle ModelBundle) string {
	return filepath.Join(files.Root, bundle.ID, bundle.SHA256)
}
func validateBundle(bundle ModelBundle) error {
	if !bundleIdentity.MatchString(bundle.ID) || !bundleHash.MatchString(bundle.SHA256) || len(bundle.Artifacts) == 0 {
		return errors.New("invalid model bundle identity")
	}
	for _, asset := range bundle.Artifacts {
		if !safeBundlePath(asset.Filename) || !bundleHash.MatchString(asset.SHA256) || asset.Bytes <= 0 || asset.Bytes > 1<<30 {
			return errors.New("invalid model bundle artifact")
		}
	}
	return nil
}
func safeBundlePath(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, "\\\x00") && !path.IsAbs(name) && path.Clean(name) == name && !strings.HasPrefix(name, "../")
}
func (files ModelBundles) Installed(bundle ModelBundle) bool {
	if validateBundle(bundle) != nil {
		return false
	}
	marker, err := os.ReadFile(filepath.Join(files.Path(bundle), ".installed.json"))
	if err != nil {
		return false
	}
	var state installedBundle
	if json.Unmarshal(marker, &state) != nil || state.SHA256 != bundle.SHA256 || len(state.Files) == 0 {
		return false
	}
	for _, required := range bundle.Required {
		if !safeBundlePath(required) {
			return false
		}
		info, err := os.Stat(filepath.Join(files.Path(bundle), required))
		if err != nil || !info.Mode().IsRegular() {
			return false
		}
	}
	return true
}
func (files ModelBundles) Verify(ctx context.Context, bundle ModelBundle) error {
	if !files.Installed(bundle) {
		return errors.New("Download and install this speech model first.")
	}
	marker, err := os.ReadFile(filepath.Join(files.Path(bundle), ".installed.json"))
	if err != nil {
		return err
	}
	var state installedBundle
	if err = json.Unmarshal(marker, &state); err != nil {
		return err
	}
	for _, item := range state.Files {
		if !safeBundlePath(item.Filename) || !bundleHash.MatchString(item.SHA256) || item.Bytes < 0 || item.Bytes > 1<<30 {
			return errors.New("The speech model manifest is invalid.")
		}
		file, err := os.Open(filepath.Join(files.Path(bundle), item.Filename))
		if err != nil {
			return errors.New("The speech model is incomplete. Remove it and download again.")
		}
		hash := sha256.New()
		n, err := io.Copy(hash, &contextReader{ctx: ctx, reader: io.LimitReader(file, item.Bytes+1)})
		file.Close()
		if err != nil {
			return err
		}
		if n != item.Bytes || hex.EncodeToString(hash.Sum(nil)) != item.SHA256 {
			return errors.New("The speech model failed its integrity check. Remove it and download again.")
		}
	}
	for name, expected := range bundle.Generated {
		actual, err := os.ReadFile(filepath.Join(files.Path(bundle), name))
		if err != nil || !bytes.Equal(actual, expected) {
			return errors.New("The speech configuration is outdated. Remove this model and download it again.")
		}
	}
	return nil
}
func (files ModelBundles) Install(ctx context.Context, bundle ModelBundle, fetch func(BundleArtifact) (io.ReadCloser, error), progress func(int64)) error {
	if err := validateBundle(bundle); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	parent := filepath.Dir(files.Path(bundle))
	if err := os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	if err := files.cleanPartial(bundle); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(parent, ".install-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	state := installedBundle{SHA256: bundle.SHA256}
	var downloaded int64
	for _, asset := range bundle.Artifacts {
		if err := ctx.Err(); err != nil {
			return err
		}
		reader, err := fetch(asset)
		if err != nil {
			return err
		}
		name := filepath.Join(stage, asset.Filename)
		if bundle.ArchiveRoot != "" {
			name = filepath.Join(stage, ".archive")
		}
		if err = os.MkdirAll(filepath.Dir(name), 0700); err != nil {
			reader.Close()
			return err
		}
		file, err := os.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			reader.Close()
			return err
		}
		hash := sha256.New()
		limited := io.LimitReader(reader, asset.Bytes+1)
		buffer := make([]byte, 64<<10)
		var total int64
		for {
			if err = ctx.Err(); err != nil {
				break
			}
			var n int
			n, err = limited.Read(buffer)
			if n > 0 {
				if _, writeErr := io.MultiWriter(file, hash).Write(buffer[:n]); writeErr != nil {
					err = writeErr
					break
				}
				total += int64(n)
				if progress != nil {
					progress(downloaded + total)
				}
			}
			if err != nil {
				break
			}
		}
		reader.Close()
		syncErr := file.Sync()
		closeErr := file.Close()
		if err != io.EOF {
			return err
		}
		if syncErr != nil {
			return syncErr
		}
		if closeErr != nil {
			return closeErr
		}
		if total != asset.Bytes || hex.EncodeToString(hash.Sum(nil)) != asset.SHA256 {
			return errors.New("The speech model download failed its size or SHA-256 check.")
		}
		downloaded += total
		if bundle.ArchiveRoot != "" {
			if len(bundle.Artifacts) != 1 {
				return errors.New("invalid speech archive manifest")
			}
			state.Files, err = unpackModelBundle(ctx, name, stage, bundle.ArchiveRoot)
			if err != nil {
				return err
			}
			if err = os.Remove(name); err != nil {
				return err
			}
		} else {
			state.Files = append(state.Files, asset)
		}
	}
	for name, data := range bundle.Generated {
		if !safeBundlePath(name) || name == ".installed.json" || len(data) > 64<<10 {
			return errors.New("invalid generated speech configuration")
		}
		if err = os.WriteFile(filepath.Join(stage, name), data, 0600); err != nil {
			return err
		}
		hash := sha256.Sum256(data)
		state.Files = append(state.Files, BundleArtifact{Filename: name, Bytes: int64(len(data)), SHA256: hex.EncodeToString(hash[:])})
	}
	for _, name := range bundle.Required {
		if !safeBundlePath(name) {
			return errors.New("invalid required speech file")
		}
		info, err := os.Stat(filepath.Join(stage, name))
		if err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("The speech package is missing a required file: %s", name)
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(stage, ".installed.json"), encoded, 0600); err != nil {
		return err
	}
	if err = os.RemoveAll(files.Path(bundle)); err != nil {
		return err
	}
	return os.Rename(stage, files.Path(bundle))
}
func unpackModelBundle(ctx context.Context, archive, directory, prefix string) ([]BundleArtifact, error) {
	file, err := os.Open(archive)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	reader := tar.NewReader(bzip2.NewReader(&contextReader{ctx: ctx, reader: file}))
	var result []BundleArtifact
	var total int64
	seen := map[string]bool{}
	for {
		item, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		name := strings.TrimSuffix(item.Name, "/")
		if name == prefix {
			continue
		}
		if !strings.HasPrefix(name, prefix+"/") {
			return nil, errors.New("The speech archive contains an invalid root.")
		}
		name = strings.TrimPrefix(name, prefix+"/")
		if !safeBundlePath(name) || name == ".installed.json" || name == ".archive" {
			return nil, errors.New("The speech archive contains an invalid path.")
		}
		if item.Typeflag == tar.TypeDir {
			if err = os.MkdirAll(filepath.Join(directory, name), 0700); err != nil {
				return nil, err
			}
			continue
		}
		if item.Typeflag != tar.TypeReg || item.Size < 0 || seen[name] {
			return nil, errors.New("The speech archive contains an unsupported entry.")
		}
		seen[name] = true
		total += item.Size
		if total > 1<<30 || len(result) >= 4096 {
			return nil, errors.New("The speech archive exceeds its extraction limit.")
		}
		if err = os.MkdirAll(filepath.Dir(filepath.Join(directory, name)), 0700); err != nil {
			return nil, err
		}
		output, err := os.OpenFile(filepath.Join(directory, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return nil, err
		}
		hash := sha256.New()
		n, copyErr := io.Copy(io.MultiWriter(output, hash), &contextReader{ctx: ctx, reader: reader})
		syncErr := output.Sync()
		closeErr := output.Close()
		if copyErr != nil {
			return nil, copyErr
		}
		if syncErr != nil {
			return nil, syncErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		if n != item.Size {
			return nil, io.ErrUnexpectedEOF
		}
		result = append(result, BundleArtifact{Filename: name, Bytes: n, SHA256: hex.EncodeToString(hash.Sum(nil))})
	}
	return result, nil
}
func (files ModelBundles) cleanPartial(bundle ModelBundle) error {
	entries, err := os.ReadDir(filepath.Dir(files.Path(bundle)))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".install-") {
			if err = os.RemoveAll(filepath.Join(filepath.Dir(files.Path(bundle)), entry.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}
func (files ModelBundles) Remove(bundle ModelBundle) error {
	if err := validateBundle(bundle); err != nil {
		return err
	}
	if err := os.RemoveAll(files.Path(bundle)); err != nil {
		return err
	}
	if err := os.RemoveAll(filepath.Join(filepath.Dir(files.Path(bundle)), ".resume-"+bundle.SHA256)); err != nil {
		return err
	}
	return files.cleanPartial(bundle)
}
