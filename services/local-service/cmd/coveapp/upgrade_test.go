package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUpgradeFixtureChecksSavedStateAndNewRules(t *testing.T) {
	dir := t.TempDir()
	old := filepath.Join(packageDir, "japanese-review-book.coveapp")
	next := filepath.Join(packageDir, "japanese-review-book-1.1.coveapp")
	fixture := filepath.Join(fixturesDir, "japanese-review-upgrade.json")
	args := []string{"upgrade-test", old, next, fixture}
	if err := run(args, io.Discard); err != nil {
		t.Fatal(err)
	}
	var f upgradeFixture
	if err := readFixture(fixture, &f); err != nil {
		t.Fatal(err)
	}
	// Change an expected migrated field to prove the post-upgrade scenario
	// executed against the saved user record on the selected instance.
	f.After[0].ExpectFields["archived"] = true
	data, err := json.Marshal(f)
	if err != nil {
		t.Fatal(err)
	}
	args[3] = filepath.Join(dir, "wrong-default.json")
	if err = os.WriteFile(args[3], data, 0600); err != nil {
		t.Fatal(err)
	}
	if err = run(args, io.Discard); err == nil || !strings.Contains(err.Error(), "after upgrade") {
		t.Fatalf("expected failed upgraded query, got %v", err)
	}
	args = []string{"upgrade-test", old, old, fixture}
	if err = run(args, io.Discard); err == nil {
		t.Fatal("accepted reinstall as an upgrade")
	}
}

func TestShippedReadingInboxUpgrade(t *testing.T) {
	args := []string{
		"upgrade-test",
		filepath.Join(packageDir, "reading-inbox.coveapp"),
		filepath.Join(packageDir, "reading-inbox-1.1.coveapp"),
		filepath.Join(fixturesDir, "reading-inbox-upgrade.json"),
	}
	if err := run(args, io.Discard); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	for _, index := range []int{1, 2} {
		source, err := os.ReadFile(args[index])
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(dir, filepath.Base(args[index]))
		// Author tests accept unpublished bytes without claiming a distribution identity.
		if err = os.WriteFile(path, append(source, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
		args[index] = path
		err = run(args, io.Discard)
		if index == 1 && err != nil || index == 2 && (err == nil || !strings.Contains(err.Error(), "incompatible upgrade")) {
			t.Fatalf("unpublished author identity check failed at argument %d: %v", index, err)
		}
		personal := bytes.Replace(source, []byte(`"bookshelf"`), []byte(`"personal-shelf"`), 1)
		if err = os.WriteFile(path, personal, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := run(args, io.Discard); err != nil {
		t.Fatalf("personal Reading Inbox upgrade failed: %v", err)
	}
}

func TestJapaneseReview12UpgradePreservesUserStateAndAppliesMissRules(t *testing.T) {
	args := []string{"upgrade-test", filepath.Join(packageDir, "japanese-review-book-1.1.coveapp"), filepath.Join(packageDir, "japanese-review-book-1.2.coveapp"), filepath.Join(fixturesDir, "japanese-review-1.2-upgrade.json")}
	if err := run(args, io.Discard); err != nil {
		t.Fatal(err)
	}
}
