package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
)

// CI runs these checks alongside the behavioral fixtures. This exercises the
// published JSON Schema using a validator independent of the Go interpreter.
func TestShippedPackagesConformToPublicSchema(t *testing.T) {
	raw, err := os.ReadFile("../../../../packages/api-contract/schemas/mini-app-v1.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	var spec jsonschema.Schema
	if err = json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	resolved, err := spec.Resolve(nil)
	if err != nil {
		t.Fatal(err)
	}
	paths, err := filepath.Glob(filepath.Join(packageDir, "*.coveapp"))
	if err != nil || len(paths) < 2 {
		t.Fatal("missing catalog fixtures", err)
	}
	for _, file := range append(paths, "starter.coveapp") {
		t.Run(filepath.Base(file), func(t *testing.T) {
			data, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = miniapps.Validate(data); err != nil {
				t.Fatal(err)
			}
			var manifest map[string]any
			if err = json.Unmarshal(data, &manifest); err != nil {
				t.Fatal(err)
			}
			if err = resolved.Validate(manifest); err != nil {
				t.Fatalf("author schema rejected shipped package: %v", err)
			}
			manifest["format"] = 2
			if err = resolved.Validate(manifest); err == nil {
				t.Fatal("v1 schema accepted an unknown format")
			}
		})
	}
}
