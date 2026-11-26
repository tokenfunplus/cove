package chat

import (
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func TestLocalSnapshotUsesSelectedModelArtifact(t *testing.T) {
	original, _ := localmodels.Lookup(localmodels.ChatID)
	profile := provider.Profile{Kind: provider.KindLocal, LocalModel: &provider.ModelArtifact{SHA256: original.SHA256}}
	for _, id := range []string{localmodels.ChatID, localmodels.Qwen3AbliteratedID, localmodels.Qwen15BID, localmodels.QwenCoder15BID, localmodels.Gemma3ID} {
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

func TestLocalEffectiveParametersDoNotMutatePreferences(t *testing.T) {
	for _, requested := range []int{512, 4096} {
		inputLimit := requested
		parameters := persistence.GenerationParameters{MaxTokens: &inputLimit}
		effective := effectiveGenerationParameters(parameters, provider.KindLocal)
		if *effective.MaxTokens != min(requested, localmodels.MaxOutputTokens) || *parameters.MaxTokens != requested {
			t.Fatal("incorrect local limit")
		}
		remote := effectiveGenerationParameters(parameters, provider.KindOpenAICompatible)
		if *remote.MaxTokens != requested {
			t.Fatal("remote limit changed")
		}
	}
	if *effectiveGenerationParameters(persistence.GenerationParameters{}, provider.KindLocal).MaxTokens != 1024 {
		t.Fatal("missing default limit")
	}
}
