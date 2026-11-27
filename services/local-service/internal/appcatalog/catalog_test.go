package appcatalog

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"testing"
)

func TestSignedCatalogRejectsChangedPackage(t *testing.T) {
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := (Catalog{}).List(context.Background())
	if err != nil || len(entries) < 2 {
		t.Fatal("missing bundled apps", err)
	}
	payload, _ := json.Marshal(map[string]any{"format": 1, "packages": [][]byte{entries[0].Raw}})
	envelope := map[string][]byte{"payload": payload, "signature": ed25519.Sign(private, payload)}
	bytes, _ := json.Marshal(envelope)
	if packages, err := verify(bytes, public); err != nil || len(packages) != 1 {
		t.Fatal(err)
	}
	envelope["payload"] = append(payload, ' ')
	bytes, _ = json.Marshal(envelope)
	if _, err := verify(bytes, public); err == nil {
		t.Fatal("modified index accepted")
	}
}
