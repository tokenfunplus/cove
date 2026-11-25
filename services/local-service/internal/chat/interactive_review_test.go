package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type previewCatalogSource struct {
	profileProviderSource
	calls    atomic.Int32
	metadata provider.ModelMetadata
}

func (s *previewCatalogSource) ResolveCatalog(ctx context.Context, id string) (provider.Profile, credentials.Secret, []provider.ModelMetadata, error) {
	s.calls.Add(1)
	p, key, err := s.Resolve(ctx, id)
	return p, key, []provider.ModelMetadata{s.metadata}, err
}
func (s *previewCatalogSource) CheckResolvedProfile(context.Context, provider.Profile) error {
	return nil
}
func (s *previewCatalogSource) PreviewModelMetadata(ctx context.Context, id, model string) (provider.Profile, provider.ModelMetadata, error) {
	return s.profiles[id], s.metadata, nil
}
func TestInteractivePreviewIsLocalAndAdmissionResolvesCatalogOnce(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	c, err := store.CreateConversation(ctx, "Local preview")
	if err != nil {
		t.Fatal(err)
	}
	source := &previewCatalogSource{profileProviderSource: fakeProviderProfiles("provider-a"), metadata: provider.ModelMetadata{ID: "model-a"}}
	upstream := &modelStreamsProvider{}
	s := NewService(store, source, upstream)
	input := SendInput{ConversationID: c.ID, ClientRequestID: "first", ProviderID: "provider-a", ModelID: "model-a", Body: "Hello", Interactive: true}
	preview, err := s.PreviewGenerationContext(ctx, input)
	if err != nil || source.calls.Load() != 0 || !strings.Contains(preview[0].Content, interactive.Prompt()) {
		t.Fatal("preview contacted Provider or lost local policy", err)
	}
	b, err := s.StartGenerationBatch(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, s, b.Batch.ID)
	if source.calls.Load() != 1 {
		t.Fatal("send resolved catalog more than once")
	}
	if _, err = s.RetryGenerationTarget(ctx, b.Batch.Targets[0].ID, "retry"); err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, s, b.Batch.ID)
	if source.calls.Load() != 2 {
		t.Fatal("retry resolved catalog more than once")
	}
	small := int64(4096)
	source.metadata.ContextLength = &small
	preview, err = s.PreviewGenerationContext(ctx, input)
	if err != nil || strings.Contains(fmt.Sprint(preview), interactive.Prompt()) || source.calls.Load() != 2 {
		t.Fatal("preview ignored cached capacity", err)
	}
}

func TestProjectedContextQuotaAndNoninteractiveExamples(t *testing.T) {
	for _, edit := range []bool{false, true} {
		t.Run(fmt.Sprint("edit=", edit), func(t *testing.T) {
			ctx := context.Background()
			store, err := persistence.OpenSQLite(":memory:")
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			c, err := store.CreateConversation(ctx, "Large cards")
			if err != nil {
				t.Fatal(err)
			}
			targets := []persistence.GenerationTargetInput{{ProviderID: "provider-a", ModelID: "model-a", Snapshot: persistence.ProviderSnapshot{ProviderID: "provider-a", ModelID: "model-a"}}}
			var last persistence.GenerationBatch
			for i := 0; i < 9; i++ {
				last, err = store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{Interactive: true, ConversationID: c.ID, ClientRequestID: fmt.Sprint("seed", i), Body: "A question", Targets: targets})
				if err != nil {
					t.Fatal(err)
				}
				raw, _ := json.Marshal(map[string]any{"cove_ui": 1, "title": "A small card", "continue": false, "children": []any{map[string]any{"type": "Text", "text": "Useful summary"}}, "unused": strings.Repeat("x", 30000)})
				if err = store.CompleteGeneration(ctx, persistence.CompleteGenerationInput{GenerationID: last.Targets[0].Generation.ID, Body: "```cove-ui\n" + string(raw) + "\n```"}); err != nil {
					t.Fatal(err)
				}
			}
			s := NewService(store, fakeProviderProfiles("provider-a"), &modelStreamsProvider{})
			in := SendInput{ConversationID: c.ID, ClientRequestID: "follow-up", ProviderID: "provider-a", ModelID: "model-a", Body: "More"}
			if edit {
				in.EditOfBatchID = last.ID
			}
			preview, err := s.PreviewGenerationContext(ctx, in)
			if err != nil {
				t.Fatal("quota used raw card JSON", err)
			}
			started, err := s.StartGenerationBatch(ctx, in)
			if err != nil {
				t.Fatal("send disagreed with preview", err)
			}
			waitFileBatch(t, s, started.Batch.ID)
			history, err := s.GetGenerationBatchContext(ctx, started.Batch.ID)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(history, preview[:len(preview)-1]) {
				t.Fatal("saved context differs from projected preview")
			}
		})
	}
	t.Run("noninteractive", func(t *testing.T) {
		ctx := context.Background()
		store, err := persistence.OpenSQLite(":memory:")
		if err != nil {
			t.Fatal(err)
		}
		defer store.Close()
		c, err := store.CreateConversation(ctx, "Code example")
		if err != nil {
			t.Fatal(err)
		}
		b, err := store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{ConversationID: c.ID, ClientRequestID: "example", Body: "Show the DSL", Targets: []persistence.GenerationTargetInput{{ProviderID: "provider-a", ModelID: "model-a", Snapshot: persistence.ProviderSnapshot{ProviderID: "provider-a", ModelID: "model-a"}}}})
		if err != nil {
			t.Fatal(err)
		}
		example := "Here is code:\n```cove-ui\n{\"cove_ui\":1,\"title\":\"Example\",\"continue\":false,\"children\":[{\"type\":\"Text\",\"text\":\"Example text\"}]}\n```"
		if err = store.CompleteGeneration(ctx, persistence.CompleteGenerationInput{GenerationID: b.Targets[0].Generation.ID, Body: example}); err != nil {
			t.Fatal(err)
		}
		s := NewService(store, fakeProviderProfiles("provider-a"), &modelStreamsProvider{})
		in := SendInput{ConversationID: c.ID, ClientRequestID: "follow", ProviderID: "provider-a", ModelID: "model-a", Body: "Explain this"}
		preview, err := s.PreviewGenerationContext(ctx, in)
		if err != nil || preview[1].Content != example {
			t.Fatal("ordinary code was rewritten", err)
		}
		next, err := s.StartGenerationBatch(ctx, in)
		if err != nil {
			t.Fatal(err)
		}
		waitFileBatch(t, s, next.Batch.ID)
		history, err := s.GetGenerationBatchContext(ctx, next.Batch.ID)
		if err != nil || history[1].Content != example {
			t.Fatal("saved ordinary code was rewritten", err)
		}
	})
}

// Simulate a transaction becoming visible between the first replay read and
// the generic idempotency lookup. A changed card payload must still conflict.
type missedCardReplayStore struct {
	*persistence.SQLiteStore
	missed bool
}

func (s *missedCardReplayStore) CardReplay(ctx context.Context, in interactive.Submission, fingerprint, request string) (persistence.GenerationBatch, bool, error) {
	if !s.missed {
		s.missed = true
		return persistence.GenerationBatch{}, false, nil
	}
	return s.SQLiteStore.CardReplay(ctx, in, fingerprint, request)
}
func TestCardReplayChecksGenericEarlyReturn(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	c, err := store.CreateConversation(ctx, "Replay race")
	if err != nil {
		t.Fatal(err)
	}
	b, err := store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{ConversationID: c.ID, ClientRequestID: "existing", Body: "Original", Targets: []persistence.GenerationTargetInput{{ProviderID: "provider-a", ModelID: "model-a", Snapshot: persistence.ProviderSnapshot{ProviderID: "provider-a", ModelID: "model-a"}}}})
	if err != nil {
		t.Fatal(err)
	}
	wrapper := &missedCardReplayStore{SQLiteStore: store}
	s := NewService(wrapper, fakeProviderProfiles("provider-a"), &fakeProvider{})
	_, err = s.StartGenerationBatch(ctx, SendInput{ConversationID: c.ID, ClientRequestID: b.ClientRequestID, Body: "Changed", Card: &interactive.Submission{GenerationID: "different-source"}})
	if !errors.Is(err, persistence.ErrCardConflict) {
		t.Fatal("generic replay bypassed card fingerprint", err)
	}
}
