package chat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func (service *Service) PreviewAttachment(ctx context.Context, input documents.Input) (documents.Snapshot, error) {
	parsed, err := service.parseAttachment(ctx, input)
	return parsed.Snapshot, err
}

// SetDocumentParser configures the parser before the service starts handling requests.
func (service *Service) SetDocumentParser(parser documents.Parser) { service.documentParser = parser }

func (service *Service) parseAttachment(ctx context.Context, input documents.Input) (documents.Prepared, error) {
	if service.documentParser != nil {
		return service.documentParser(ctx, input)
	}
	return documents.Parse(ctx, input)
}

func (service *Service) ReadAttachment(ctx context.Context, batchID, documentID string) (documents.Input, error) {
	result, err := service.store.LoadAttachmentData(ctx, batchID, documentID)
	if errors.Is(err, sql.ErrNoRows) {
		return readProjectAttachment(ctx, service.store, batchID, documentID)
	}
	return result, err
}

func (service *Service) PreviewGenerationContext(ctx context.Context, input SendInput) ([]provider.ProviderMessage, error) {
	if _, err := service.store.LoadConversation(ctx, input.ConversationID); err != nil {
		return nil, err
	}
	systemPrompt := input.SystemPrompt
	if service.settings != nil {
		settings, err := service.settings.GetSettings(ctx)
		if err != nil {
			return nil, err
		}
		systemPrompt = settings.SystemPrompt
	}
	if input.Interactive {
		targets, _, _, err := service.activeModelSet(ctx, input)
		if err == nil && !service.interactiveTargets(ctx, targets) {
			input.Interactive = false
		}
	}
	if input.Interactive {
		systemPrompt += interactive.Prompt()
	}
	body, cardInput, err := service.prepareCardInput(ctx, input)
	if err != nil {
		return nil, err
	}
	input.Body = body
	attachments, content, err := service.prepareAttachments(ctx, input, systemPrompt)
	if err != nil {
		return nil, err
	}
	content = mergeCardInput(input.Body, content, cardInput)
	items, err := service.store.LoadBatchContext(ctx, input.ConversationID)
	if err != nil {
		return nil, err
	}
	project, err := service.projectForInput(ctx, input, attachments, content, systemPrompt)
	if err != nil {
		return nil, err
	}
	messages := messagesFromBatchContext(persistence.GenerationBatch{ProjectContext: project}, content, persistence.GenerationConfigurationSnapshot{SystemPrompt: systemPrompt}, items)
	if !input.PreviewOnly {
		if err = validateMessages(messages); err != nil {
			return nil, err
		}
	}
	return messages, nil
}

func (service *Service) prepareAttachments(ctx context.Context, input SendInput, systemPrompt string) ([]documents.Prepared, string, error) {
	if input.EditOfBatchID != "" {
		return service.prepareEditedAttachments(ctx, input, systemPrompt)
	}
	if len(input.Attachments)+len(input.WebSourceTokens) > documents.MaxFiles {
		return nil, "", fmt.Errorf("%w: Attach at most four files or webpages per message.", documents.ErrInvalidDocument)
	}
	prepared, err := documents.PrepareWith(ctx, input.Attachments, service.parseAttachment)
	if err != nil {
		return nil, "", err
	}
	web, err := service.preparedWebSources(input.WebSourceOwner, input.WebSourceTokens)
	if err != nil {
		return nil, "", err
	}
	for _, source := range web {
		if source.Retrieval != nil && source.Retrieval.ProjectID != "" {
			view, err := service.store.LoadConversation(ctx, input.ConversationID)
			if err != nil {
				return nil, "", err
			}
			if view.ProjectID != source.Retrieval.ProjectID {
				return nil, "", fmt.Errorf("%w: Select project sources again in the current project.", documents.ErrInvalidDocument)
			}
		}
	}
	prepared = append(prepared, web...)
	seen := make(map[string]bool)
	sourceCharacters := 0
	for _, source := range prepared {
		if seen[source.ID] {
			return nil, "", fmt.Errorf("%w: The same source is already attached.", documents.ErrInvalidDocument)
		}
		seen[source.ID] = true
		sourceCharacters += source.Characters
	}
	if sourceCharacters > documents.MaxSourceCharacters {
		return nil, "", fmt.Errorf("%w: Sources may contain at most 120,000 extracted characters in total.", documents.ErrInvalidDocument)
	}
	content := documents.Prompt(input.Body, prepared)
	items, err := service.store.LoadBatchContext(ctx, input.ConversationID)
	if err != nil {
		return nil, "", err
	}
	characters := utf8.RuneCountInString(content) + utf8.RuneCountInString(systemPrompt)
	for _, item := range items {
		characters += utf8.RuneCountInString(item.UserBody) + utf8.RuneCountInString(item.AssistantBody)
	}
	if characters > documents.MaxContextCharacters && !input.PreviewOnly {
		return nil, "", documents.ErrContextLimit
	}
	return prepared, content, nil
}

func (service *Service) prepareEditedAttachments(ctx context.Context, input SendInput, systemPrompt string) ([]documents.Prepared, string, error) {
	source, err := service.store.GetGenerationBatch(ctx, input.EditOfBatchID)
	if err != nil {
		return nil, "", err
	}
	if source.ConversationID != input.ConversationID || source.State == "pending" || source.State == "streaming" || len(input.Attachments) > 0 || len(input.WebSourceTokens) > 0 {
		return nil, "", persistence.ErrInvalidBranch
	}
	prepared, err := service.store.LoadBatchAttachments(ctx, source.ID)
	if err != nil {
		return nil, "", err
	}
	content := documents.Prompt(input.Body, prepared)
	items, err := service.store.LoadGenerationBatchContext(ctx, source.ID)
	if err != nil {
		return nil, "", err
	}
	characters := utf8.RuneCountInString(content) + utf8.RuneCountInString(systemPrompt)
	for _, item := range items {
		characters += utf8.RuneCountInString(item.UserBody) + utf8.RuneCountInString(item.AssistantBody)
	}
	if characters > documents.MaxContextCharacters && !input.PreviewOnly {
		return nil, "", documents.ErrContextLimit
	}
	return prepared, content, nil
}
