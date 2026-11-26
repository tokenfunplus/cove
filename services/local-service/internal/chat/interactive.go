package chat

import (
	"context"
	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"strings"
)

func (s *Service) MaterializeCard(ctx context.Context, id string) (interactive.Run, error) {
	store, ok := s.store.(persistence.InteractiveStore)
	if !ok {
		return interactive.Run{}, interactive.ErrInvalid
	}
	return store.MaterializeCard(ctx, id)
}
func (s *Service) SaveCard(ctx context.Context, input interactive.Submission) (interactive.Run, error) {
	store, ok := s.store.(persistence.InteractiveStore)
	if !ok {
		return interactive.Run{}, interactive.ErrInvalid
	}
	return store.SaveCard(ctx, input)
}

func (s *Service) prepareCardInput(ctx context.Context, input SendInput) (string, string, error) {
	if input.Card == nil {
		return input.Body, "", nil
	}
	if input.EditOfBatchID != "" || (input.Card.Intent != "discuss" && (len(input.Attachments) > 0 || len(input.WebSourceTokens) > 0)) {
		return "", "", interactive.ErrInvalid
	}
	source, err := s.store.GetGeneration(ctx, input.Card.GenerationID)
	if err != nil {
		return "", "", err
	}
	if source.ConversationID != input.ConversationID {
		return "", "", persistence.ErrCardConflict
	}
	store, ok := s.store.(persistence.InteractiveStore)
	if !ok {
		return "", "", interactive.ErrInvalid
	}
	return store.PrepareCard(ctx, *input.Card, input.Body)
}
func mergeCardInput(body, content, card string) string {
	if card == "" {
		return content
	}
	return content + strings.TrimPrefix(card, body)
}

// Preview capability checks must never resolve credentials or contact a Provider.
func (s *Service) previewInteractiveTargets(ctx context.Context, targets []persistence.ActiveModelTarget) bool {
	if len(targets) != 1 || targets[0].ProviderID == "cove-local" {
		return false
	}
	if source, ok := s.profiles.(interface {
		PreviewModelMetadata(context.Context, string, string) (provider.Profile, provider.ModelMetadata, error)
	}); ok {
		profile, metadata, err := source.PreviewModelMetadata(ctx, targets[0].ProviderID, targets[0].ModelID)
		return err == nil && interactiveModel(profile, metadata)
	}
	return true
}

func interactiveModel(profile provider.Profile, metadata provider.ModelMetadata) bool {
	return profile.Kind != provider.KindLocal && (metadata.ContextLength == nil || *metadata.ContextLength >= 8192)
}

func interactiveResolvedTargets(targets []resolvedTarget) bool {
	return len(targets) == 1 && targets[0].profile.ID != "cove-local" && interactiveModel(targets[0].profile, targets[0].metadata)
}
