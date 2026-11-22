package persistence

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestModelFileIdentityRejectsTraversalBeforeFilesystemAccess(t *testing.T) {
	files := ModelFiles{Root: t.TempDir()}
	digest := strings.Repeat("a", 64)
	for _, item := range []struct{ id, digest string }{{"../outside", digest}, {"/absolute", digest}, {"a/b", digest}, {`a\b`, digest}, {"%2e%2e", digest}, {"valid", "../outside"}, {"valid", strings.Repeat("a", 63)}, {"valid", strings.Repeat("A", 64)}} {
		if files.Path(item.id, item.digest) != "" || files.Installed(item.id, item.digest, 1) {
			t.Fatal("invalid identity reached a model path", item.id)
		}
		if _, err := files.Verify(context.Background(), item.id, item.digest, 1); err == nil {
			t.Fatal("invalid verification identity accepted")
		}
		if err := files.Install(context.Background(), item.id, item.digest, 1, bytes.NewReader([]byte("x")), nil); err == nil {
			t.Fatal("invalid installation identity accepted")
		}
		if err := files.Remove(item.id, item.digest); err == nil {
			t.Fatal("invalid removal identity accepted")
		}
	}
}
