package persistence

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/tokenfunplus/cove/services/local-service/internal/downloadnetwork"
)

// DownloadNetworkFile stores machine-level routing outside the conversation DB.
// Proxy authentication is rejected before persistence; no credentials belong here.
type DownloadNetworkFile struct{ Root string }

func (store DownloadNetworkFile) LoadDownloadNetwork(ctx context.Context) (downloadnetwork.Settings, error) {
	if err := ctx.Err(); err != nil {
		return downloadnetwork.Settings{}, err
	}
	file, err := os.Open(filepath.Join(store.Root, "download-network.json"))
	if errors.Is(err, os.ErrNotExist) {
		return downloadnetwork.Defaults(), nil
	}
	if err != nil {
		return downloadnetwork.Settings{}, errors.New("Download network settings could not be read.")
	}
	defer file.Close()
	if info, err := file.Stat(); err != nil || info.Size() > 4096 {
		return downloadnetwork.Settings{}, errors.New("Download network settings are invalid.")
	}
	decoder := json.NewDecoder(io.LimitReader(file, 4097))
	decoder.DisallowUnknownFields()
	var value downloadnetwork.Settings
	if err = decoder.Decode(&value); err != nil {
		return value, errors.New("Download network settings are invalid.")
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		return value, errors.New("Download network settings are invalid.")
	}
	return downloadnetwork.Normalize(value)
}

func (store DownloadNetworkFile) SaveDownloadNetwork(ctx context.Context, value downloadnetwork.Settings) error {
	value, err := downloadnetwork.Normalize(value)
	if err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if err = os.MkdirAll(store.Root, 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(store.Root, ".download-network-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err = json.NewEncoder(file).Encode(value); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(store.Root, "download-network.json"))
}
