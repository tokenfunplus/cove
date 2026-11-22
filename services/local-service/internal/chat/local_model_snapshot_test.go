package chat

import (
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func TestLocalSnapshotUsesSelectedModelArtifact(t *testing.T) {
	original, _ := localmodels.Lookup(localmodels.ChatID)
	profile := provider.Profile{Kind: provider.KindLocal, LocalModel: &provider.ModelArtifact{SHA256: original.SHA256}}
	for _, id := range []string{localmodels.ChatID, localmodels.Qwen3AbliteratedID} {
		profile.Model = id
		model, _ := localmodels.Lookup(id)
		snapshot := snapshotFor(profile, "")
		if snapshot.ModelID != id || snapshot.LocalModel == nil || snapshot.LocalModel.SHA256 != model.SHA256 || snapshot.LocalModel.Revision != model.Revision || snapshot.LocalModel.RuntimeVersion != localmodels.RuntimeVersion {
			t.Fatalf("snapshot did not capture the selected artifact for %s", id)
		}
	}
	if profile.LocalModel.SHA256 != original.SHA256 {
		t.Fatal("snapshot construction mutated the shared Provider profile")
	}
}
