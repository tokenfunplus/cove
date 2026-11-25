package chat

import (
	"context"
	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
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

func (s *Service) interactiveTargets(ctx context.Context, targets []persistence.ActiveModelTarget) bool {
	if len(targets) != 1 || targets[0].ProviderID == "cove-local" {
		return false
	}
	resolved, err := s.resolveTargets(ctx, targets)
	if err != nil {
		return false
	}
	target := resolved[0]
	return target.profile.Kind != "local" && (target.metadata.ContextLength == nil || *target.metadata.ContextLength >= 8192)
}
