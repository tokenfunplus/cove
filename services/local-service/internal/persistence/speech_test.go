package persistence

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSpeechBundleInstallationIsVerifiedAtomicAndCancelable(t *testing.T) {
	data := "verified model bytes"
	hash := sha256.Sum256([]byte(data))
	digest := hex.EncodeToString(hash[:])
	bundle := ModelBundle{ID: "speech-test", SHA256: digest, Artifacts: []BundleArtifact{{Filename: "model.bin", Bytes: int64(len(data)), SHA256: digest}}, Required: []string{"model.bin", "config.yaml"}, Generated: map[string][]byte{"config.yaml": []byte("local: true")}}
	files := ModelBundles{Root: t.TempDir()}
	fetch := func(BundleArtifact) (io.ReadCloser, error) { return io.NopCloser(strings.NewReader(data)), nil }
	ctx := context.Background()
	var downloaded int64
	if err := files.Install(ctx, bundle, fetch, func(n int64) { downloaded = n }); err != nil {
		t.Fatal(err)
	}
	if downloaded != int64(len(data)) || !files.Installed(bundle) {
		t.Fatal("installation not published")
	}
	if err := files.Verify(ctx, bundle); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(filepath.Join(files.Path(bundle), "model.bin")); err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("model file not private", err)
	}
	if err := os.WriteFile(filepath.Join(files.Path(bundle), "model.bin"), []byte("corrupted"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := files.Verify(ctx, bundle); err == nil {
		t.Fatal("corrupt model accepted")
	}
	if err := files.Remove(bundle); err != nil {
		t.Fatal(err)
	}
	badFetch := func(BundleArtifact) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader(strings.Repeat("!", len(data)))), nil
	}
	if err := files.Install(ctx, bundle, badFetch, nil); err == nil || files.Installed(bundle) {
		t.Fatal("unverified bundle published")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err := files.Install(cancelled, bundle, fetch, nil); err == nil {
		t.Fatal("cancelled install accepted")
	}
	entries, err := os.ReadDir(filepath.Dir(files.Path(bundle)))
	if err != nil || len(entries) != 0 {
		t.Fatal("partial installation retained", err)
	}
	for _, path := range []string{"..", "../outside", "/absolute", "dir/../outside", "a\\b"} {
		if safeBundlePath(path) {
			t.Fatalf("unsafe bundle path: %q", path)
		}
	}
}
func TestSchema26SpeechUpgradePreservesChatAndPreferences(t *testing.T) {
	path := filepath.Join(t.TempDir(), "schema26.sqlite")
	ctx := context.Background()
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, "Existing chat")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.db.Exec(removeMiniAppsSchema + `DROP TABLE speech_settings; ALTER TABLE project_source_indexes DROP COLUMN source_snapshot; PRAGMA user_version=26`); err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, err = OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if pragmaInt(t, store.db, "user_version") != schemaVersion {
		t.Fatal("speech migration missing")
	}
	if _, err = store.LoadConversation(ctx, conversation.ID); err != nil {
		t.Fatal("migration lost conversation", err)
	}
	settings := SpeechSettings{Mode: "auto", Volume: .5, Threads: 2, Profiles: map[string]SpeechProfile{"fixture": {VoiceID: "voice", Speed: 1}}}
	if err = store.SaveSpeechSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	got, err := store.GetSpeechSettings(ctx)
	if err != nil || got.Volume != .5 || got.Profiles["fixture"].VoiceID != "voice" {
		t.Fatal("speech preferences did not persist", err)
	}
}

func TestSpeechArchiveRejectsPathsAndLinksBeforePublishing(t *testing.T) {
	for _, fixture := range []struct{ name, data string }{
		{"valid", "QlpoOTFBWSZTWUoGCIgAAHX9gMmAAAFAAfUAAAD+r94ACAggAFRGqDQNAPUYjaamQSSTRoAAAAfbzjkIPHoQivtoDTQjQIYGONaniewjBwKvgc47HcFTfp6ojLYocZLK9k5lShgAi/F3JFOFCQSgYIiA"},
		{"traversal", "QlpoOTFBWSZTWVqsidEAAHT9gMmAAAFAAeUAAAFuqN4ACAggAFQyp6npBkHqGh6TIJJQ9TRo9QAAfaTKEIPKkIRHbSGtk6BDAxETaHE7CGQhNxmNkaBo7Tf11X6nTrCdcRZK2Ykgfi7kinChILVZE6I="},
		{"symlink", "QlpoOTFBWSZTWZfvvegAAHd7gMiAABBAAf0ADAAurd4AAAggAFRGkgyBhGQ09NIJJQyNBkADQfab0CQW1IQjCcrCA96BDAxKMVezhOYRywEyEXcHvJoSS0r7XBUtbtxo3W+hreIAIvxdyRThQkJfvveg"},
		{"hardlink", "QlpoOTFBWSZTWZSY+V0AAHd7gMiAABBAAf0ADAAurd4AAAggAFRGpNNMTQZAY00CSUMgaeoAAH2e0wkFlCEIl3fUVkYoEMDDu6k0BQYR1kC5XF25bSaDkntJ0Wh2t85Rt1u9SXiACLAu5IpwoSEpMfK6"},
		{"wrong-root", "QlpoOTFBWSZTWfmrZkgAAHP7gMmAAAFAAfcAIAB2Z54ACAggAFQ0o00yaNMmhpp6nqYEko0000aAAAfcRJkIPHIQiXd0BowegQwMcvk4TmEZTEOFS0hyM14DeSUPIenT5DRYrUWfaJEQFxdyRThQkPmrZkg="},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			data, err := base64.StdEncoding.DecodeString(fixture.data)
			if err != nil {
				t.Fatal(err)
			}
			root := t.TempDir()
			archive := filepath.Join(root, "package.tar.bz2")
			stage := filepath.Join(root, "stage")
			if err = os.Mkdir(stage, 0700); err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(archive, data, 0600); err != nil {
				t.Fatal(err)
			}
			files, err := unpackModelBundle(context.Background(), archive, stage, "package")
			if fixture.name == "valid" {
				if err != nil || len(files) != 1 || files[0].Filename != "model.bin" {
					t.Fatal("valid archive rejected", err)
				}
			} else if err == nil {
				t.Fatal("unsafe archive accepted")
			}
			if _, err = os.Stat(filepath.Join(root, "outside")); !os.IsNotExist(err) {
				t.Fatal("archive escaped staging")
			}
		})
	}
}
