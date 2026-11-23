package localmodels

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

const ProviderID = "cove-local"
const MaxOutputTokens = 1024

func (manager *Manager) Profile() provider.Profile {
	p, _ := provider.NormalizeProfile(provider.Profile{ID: ProviderID, Kind: provider.KindLocal, Name: "On this Mac", Endpoint: "http://127.0.0.1", AuthMethod: provider.AuthBearer, CreatedAt: time.Unix(0, 0).UTC(), UpdatedAt: time.Unix(0, 0).UTC()})
	p.Configured = len(manager.Metadata()) > 0
	return p
}
func (manager *Manager) Metadata() []provider.ModelMetadata {
	contextLength := int64(4096)
	output := int64(MaxOutputTokens)
	if !manager.RuntimeReady() {
		return nil
	}
	var result []provider.ModelMetadata
	for _, model := range Registry {
		if model.Role != "chat" || !manager.Installed(model.ID) {
			continue
		}
		owner := "Qwen"
		description := "Experimental local model for short rewrites and extraction. Facts and code may be wrong."
		if model.ID == Qwen3AbliteratedID {
			owner = "mlabonne / Qwen"
			description = "Experimental abliterated model with reduced refusals. Non-thinking mode. Facts and code may be wrong."
		}
		result = append(result, provider.ModelMetadata{ID: model.ID, Name: model.Name + " · local", Owner: owner, Description: description, ContextLength: &contextLength, MaxOutputTokens: &output, Capabilities: []string{"text_input"}})
	}
	return result
}

// RoutedProvider preserves the ordinary HTTP adapter for remote Providers.
type RoutedProvider struct {
	Local  *Manager
	Remote provider.Provider
}

func (router RoutedProvider) Validate(ctx context.Context, input provider.ValidateInput) (provider.ValidationResult, error) {
	if input.Profile.Kind != provider.KindLocal {
		return router.Remote.Validate(ctx, input)
	}
	metadata := router.Local.Metadata()
	if len(metadata) == 0 {
		return provider.ValidationResult{}, provider.ErrModelUnavailable
	}
	models := make([]string, len(metadata))
	for index, model := range metadata {
		models[index] = model.ID
	}
	return provider.ValidationResult{Models: models, ModelMetadata: metadata}, nil
}
func (router RoutedProvider) Stream(ctx context.Context, input provider.CompletionInput) (provider.CompletionStream, error) {
	if input.Profile.Kind != provider.KindLocal {
		return router.Remote.Stream(ctx, input)
	}
	manager := router.Local
	modelID := input.Profile.Model
	if input.Profile.ID != ProviderID || !IsChatModel(modelID) {
		return nil, provider.ErrModelUnavailable
	}
	if len(input.Tools) > 0 {
		return nil, errors.New("This local model does not support Cove Web search tools. Turn Web search off for this response.")
	}
	if input.Activity != nil {
		input.Activity("Waiting for local inference…")
	}
	if err := manager.acquire(ctx); err != nil {
		return nil, err
	}
	if input.Activity != nil {
		input.Activity("Preparing local model…")
	}
	w, err := manager.startWorker(ctx, modelID)
	if err != nil {
		manager.release()
		return nil, err
	}
	input.Profile.Kind = provider.KindOpenAICompatible
	input.Profile.Endpoint = w.endpoint
	input.Secret = credentials.Secret{Value: w.key}
	maxOutput := MaxOutputTokens
	if input.GenerationParameters.MaxTokens == nil || *input.GenerationParameters.MaxTokens > maxOutput {
		input.GenerationParameters.MaxTokens = &maxOutput
	}
	if input.Activity != nil {
		input.Activity("Generating on this Mac…")
	}
	stream, err := provider.NewHTTPAdapter(w.client).Stream(ctx, input)
	if err != nil {
		if ctx.Err() != nil {
			manager.stopWorker(modelID)
		}
		manager.release()
		return nil, err
	}
	return &localStream{CompletionStream: stream, manager: manager, ctx: ctx, modelID: modelID}, nil
}

type localStream struct {
	provider.CompletionStream
	manager *Manager
	ctx     context.Context
	modelID string
	once    sync.Once
}

func (stream *localStream) Close() error {
	err := stream.CompletionStream.Close()
	stream.once.Do(func() {
		if stream.ctx.Err() != nil {
			stream.manager.stopWorker(stream.modelID)
		} else if w := stream.manager.workers[stream.modelID]; w != nil {
			w.lastUsed = time.Now()
		}
		stream.manager.release()
	})
	return err
}
