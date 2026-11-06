package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestApplicationDataDirectorySupportsIsolatedFixtures(t *testing.T) {
	isolated := t.TempDir()
	got, err := applicationDataDirectoryPath(isolated)
	if err != nil || got != isolated {
		t.Fatalf("isolated data directory = %q, %v; want %q", got, err, isolated)
	}
	got, err = applicationDataDirectoryPath("fixture-data")
	if err != nil || !filepath.IsAbs(got) || filepath.Base(got) != "fixture-data" {
		t.Fatalf("relative override was not resolved: %q, %v", got, err)
	}
}

func TestApplicationDataDirectoryDefaultsToCoveNamespace(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	got, err := applicationDataDirectoryPath("")
	want := filepath.Join(home, "Library", "Application Support", "cove")
	if err != nil || got != want {
		t.Fatalf("default data directory = %q, %v; want %q", got, err, want)
	}
}
