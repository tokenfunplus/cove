package persistence

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/downloadnetwork"
)

func TestDownloadNetworkPrivateRoundTripAndRecovery(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "data")
	store := DownloadNetworkFile{Root: root}
	value, err := store.LoadDownloadNetwork(ctx)
	if err != nil || value != downloadnetwork.Defaults() {
		t.Fatal("missing file must use system proxy")
	}
	manual := downloadnetwork.Settings{Mode: "manual", ProxyURL: "socks5://localhost:1080"}
	if err = store.SaveDownloadNetwork(ctx, manual); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "download-network.json")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatal("settings must be owner-only")
	}
	reopened := DownloadNetworkFile{Root: root}
	value, err = reopened.LoadDownloadNetwork(ctx)
	if err != nil || value != manual {
		t.Fatalf("restart: %+v %v", value, err)
	}
	before, _ := os.ReadFile(path)
	if err = store.SaveDownloadNetwork(ctx, downloadnetwork.Settings{Mode: "manual", ProxyURL: "http://private-user:private-password@localhost:7890"}); err == nil {
		t.Fatal("credentials must not be saved")
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if err = store.SaveDownloadNetwork(canceled, downloadnetwork.Defaults()); err == nil {
		t.Fatal("canceled save succeeded")
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(before) {
		t.Fatal("failed save replaced previous config")
	}
	for _, bad := range []string{`{"mode":"unknown"}`, `{"mode":"direct","unexpected":true}`, `{"mode":"direct"} {}`, `{"mode":"direct"}` + strings.Repeat(" ", 4096)} {
		if err = os.WriteFile(path, []byte(bad), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err = store.LoadDownloadNetwork(ctx); err == nil {
			t.Fatal("corrupt settings were accepted")
		}
	}
	if err = store.SaveDownloadNetwork(ctx, downloadnetwork.Defaults()); err != nil {
		t.Fatal(err)
	}
	value, err = store.LoadDownloadNetwork(ctx)
	if err != nil || value != downloadnetwork.Defaults() {
		t.Fatal("recovery failed")
	}
	files, _ := filepath.Glob(filepath.Join(root, ".download-network-*"))
	if len(files) != 0 {
		t.Fatal("temporary files left behind")
	}
}
