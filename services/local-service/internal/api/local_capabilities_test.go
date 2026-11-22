package api

import (
	"encoding/json"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func TestLocalOnlyPolicySurvivesBatchAndConversationResponses(t *testing.T) {
	batch := persistence.GenerationBatch{ID: "local-batch", LocalOnly: true}
	direct := generationBatchEnvelopeFor(batch)
	conversation := conversationViewEnvelopeFor(persistence.ConversationView{GenerationBatches: []persistence.GenerationBatch{batch}, ActiveGenerationBatch: &batch})
	for _, wire := range []generationBatchEnvelope{direct, conversation.GenerationBatches[0], *conversation.ActiveGenerationBatch} {
		raw, err := json.Marshal(wire)
		if err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if err = json.Unmarshal(raw, &payload); err != nil {
			t.Fatal(err)
		}
		if payload["local_only"] != true {
			t.Fatal("wire response lost the accepted local-only execution policy")
		}
	}
}

func TestLocalModelArtifactSurvivesSnapshotResponse(t *testing.T) {
	artifact := &provider.ModelArtifact{Revision: "selected-revision", SHA256: "selected-model-hash", RuntimeVersion: "fixture-runtime"}
	snapshot := persistence.ProviderSnapshot{ProviderKind: provider.KindLocal, ModelID: "selected-local-model", LocalModel: artifact}
	encoded, err := json.Marshal(providerSnapshotEnvelopeFor(snapshot))
	if err != nil {
		t.Fatal(err)
	}
	var saved persistence.ProviderSnapshot
	if err := json.Unmarshal(encoded, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.LocalModel == nil || *saved.LocalModel != *artifact || saved.ModelID != snapshot.ModelID {
		t.Fatal("API response lost the selected local model artifact")
	}
}
