package chat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"github.com/tokenfunplus/cove/services/local-service/internal/websearch"
)

func (service *Service) StartGenerationBatch(ctx context.Context, input SendInput) (GenerationBatchStart, error) {
	if err := service.guardDebateConversation(ctx, input.ConversationID); err != nil {
		return GenerationBatchStart{}, err
	}
	if service.store == nil || service.profiles == nil || service.provider == nil {
		return GenerationBatchStart{}, errors.New("chat service dependencies are required")
	}
	question := input.Body
	cardFingerprint := ""
	if input.Card != nil {
		cardFingerprint = interactive.Fingerprint(*input.Card, question, input.Interactive, input.LocalOnly, input.WebSearchEnabled, input.ExpectedTargets, input.ExpectedProject, input.EditOfBatchID, input.Attachments, input.WebSourceTokens)
	}
	if input.Card != nil {
		store, ok := service.store.(persistence.InteractiveStore)
		if !ok {
			return GenerationBatchStart{}, interactive.ErrInvalid
		}
		if b, replayed, e := store.CardReplay(ctx, *input.Card, cardFingerprint, input.ClientRequestID); e != nil || replayed {
			if e == nil && b.ConversationID != input.ConversationID {
				return GenerationBatchStart{}, persistence.ErrCardConflict
			}
			return GenerationBatchStart{Batch: b}, e
		}
	}
	service.startMu.Lock()
	existing, err := service.checkCardBatchStart(ctx, input, cardFingerprint)
	service.startMu.Unlock()
	if err != nil || existing.ID != "" {
		return GenerationBatchStart{Batch: existing}, err
	}
	if input.LocalOnly && input.WebSearchEnabled {
		return GenerationBatchStart{}, ErrLocalOnly
	}
	var searchPolicy *websearch.Policy
	if input.WebSearchEnabled {
		if service.searchService == nil {
			return GenerationBatchStart{}, websearch.ErrUnavailable
		}
		policy, err := service.searchService.Policy(ctx)
		if err != nil {
			return GenerationBatchStart{}, err
		}
		searchPolicy = &policy
	}
	activeModelSet, systemPrompt, parameters, err := service.activeModelSet(ctx, input)
	if err != nil {
		return GenerationBatchStart{}, err
	}
	if err := matchExpectedTargets(activeModelSet, input.ExpectedTargets); err != nil {
		return GenerationBatchStart{}, err
	}
	if input.Card != nil && len(activeModelSet) != 1 {
		return GenerationBatchStart{}, interactive.ErrInvalid
	}

	if input.LocalOnly {
		for _, target := range activeModelSet {
			if target.ProviderID != localmodels.ProviderID || !localmodels.IsChatModel(target.ModelID) {
				return GenerationBatchStart{}, ErrLocalOnly
			}
		}
	}
	resolved, resolveErr := service.resolveTargets(ctx, activeModelSet)
	if input.MiniApp != nil {
		if service.appActions == nil || input.WebSearchEnabled || input.Card != nil || len(activeModelSet) != 1 || resolveErr == nil && !resolved[0].allowsAppTurn() {
			return GenerationBatchStart{}, ErrAppTurnUnavailable
		}
		if _, err := service.appActions.ChatActions(ctx, *input.MiniApp); err != nil {
			return GenerationBatchStart{}, ErrAppTurnUnavailable
		}
		input.Interactive = false
	}
	if input.Interactive && !interactiveResolvedTargets(resolved) {
		input.Interactive = false
	}
	service.startMu.Lock()
	defer service.startMu.Unlock()
	service.secureMu.Lock()
	defer service.secureMu.Unlock()
	if input.Card != nil {
		if b, replayed, e := service.store.(persistence.InteractiveStore).CardReplay(ctx, *input.Card, cardFingerprint, input.ClientRequestID); e != nil || replayed {
			if e == nil && b.ConversationID != input.ConversationID {
				return GenerationBatchStart{}, persistence.ErrCardConflict
			}
			return GenerationBatchStart{Batch: b}, e
		}
	}
	if batch, err := service.checkCardBatchStart(ctx, input, cardFingerprint); err != nil || batch.ID != "" {
		return GenerationBatchStart{Batch: batch}, err
	}
	if resolveErr != nil {
		return GenerationBatchStart{}, resolveErr
	}
	current, currentPrompt, currentParameters, err := service.activeModelSet(ctx, input)
	if err != nil {
		return GenerationBatchStart{}, err
	}
	if !reflect.DeepEqual(current, activeModelSet) || currentPrompt != systemPrompt || !reflect.DeepEqual(currentParameters, parameters) {
		return GenerationBatchStart{}, ErrGenerationSelectionChanged
	}

	batchTargets := make([]persistence.GenerationTargetInput, 0, len(activeModelSet))
	hasOrdinaryTarget := false
	for index, target := range activeModelSet {
		connection := resolved[index]
		if input.LocalOnly && connection.profile.Kind != provider.KindLocal {
			return GenerationBatchStart{}, ErrLocalOnly
		}
		if input.ExpectedTargets != nil && input.ExpectedTargets[index].RequirePrivateTEE && !connection.isPrivateTEE() {
			return GenerationBatchStart{}, ErrPrivateTEEUnavailable
		}
		if err := service.checkResolvedProfile(ctx, connection.profile); err != nil {
			return GenerationBatchStart{}, err
		}
		hasOrdinaryTarget = hasOrdinaryTarget || !connection.isSecure()
		snapshot := snapshotFor(connection.profile, connection.metadata.PrivacyMode)
		effective := effectiveGenerationParameters(parameters, connection.profile.Kind)
		batchTargets = append(batchTargets, persistence.GenerationTargetInput{GenerationParameters: &effective, ProviderID: target.ProviderID, ModelID: target.ModelID, Snapshot: snapshot})
	}
	project, expectedProject, err := service.PreviewProjectContext(ctx, input.ConversationID)
	if err != nil {
		return GenerationBatchStart{}, err
	}
	if input.ExpectedProject == nil {
		if expectedProject.ProjectID != "" || expectedProject.MembershipRevision != 0 {
			return GenerationBatchStart{}, persistence.ErrProjectChanged
		}
	} else if *input.ExpectedProject != expectedProject {
		return GenerationBatchStart{}, persistence.ErrProjectChanged
	}
	// Validate quotas against this captured revision; persistence rechecks it atomically on admission.
	input.previewProject = project
	input.previewProjectSet = true
	cardInput := ""
	input.Body, cardInput, err = service.prepareCardInput(ctx, input)
	if err != nil {
		return GenerationBatchStart{}, err
	}
	if input.Interactive {
		systemPrompt += interactive.Prompt()
	}
	attachments, inputContent, err := service.prepareAttachments(ctx, input)
	if err != nil {
		return GenerationBatchStart{}, err
	}
	inputContent = mergeCardInput(input.Body, inputContent, cardInput)
	if _, err := service.projectForInput(ctx, input, attachments, inputContent, systemPrompt); err != nil {
		return GenerationBatchStart{}, err
	}
	batch, err := service.store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{
		MiniApp: input.MiniApp, Interactive: input.Interactive, Card: input.Card, CardFingerprint: cardFingerprint,
		LocalOnly:       input.LocalOnly,
		ExpectedProject: input.ExpectedProject,
		WebSearch:       searchPolicy,
		EditOfBatchID:   input.EditOfBatchID, ConversationID: input.ConversationID, ClientRequestID: input.ClientRequestID, Body: input.Body, InputContent: inputContent, Attachments: attachments, SystemPrompt: systemPrompt, GenerationParameters: parameters, Targets: batchTargets,
	})
	if err != nil {
		return GenerationBatchStart{}, err
	}
	service.batchHub.activate(batch.ID, len(batch.Targets))
	for _, target := range batch.Targets {
		if resolved[target.Position].isSecure() {
			service.trackSecureGeneration(target.Generation.ID)
		}
	}
	if !hasOrdinaryTarget {
		return GenerationBatchStart{Batch: batch}, nil
	}
	configuration := batch.Targets[0].Generation.ConfigurationSnapshot
	messages := messagesFromBatchContext(batch, input.Body, configuration, batch.ContextItems)

	type batchRun struct {
		context       context.Context
		batchID       string
		targetID      string
		generation    persistence.Generation
		profile       provider.Profile
		secret        credentials.Secret
		messages      []provider.ProviderMessage
		configuration persistence.GenerationConfigurationSnapshot
		toolCapable   bool
	}
	runs := make([]batchRun, 0, len(batch.Targets))
	service.activeMu.Lock()
	for _, target := range batch.Targets {
		resolvedTarget := resolved[target.Position]
		if resolvedTarget.isSecure() {
			continue
		}
		runContext, cancel := context.WithTimeout(context.Background(), service.timeout)
		service.active[target.Generation.ID] = &activeGeneration{cancel: cancel, done: make(chan struct{})}
		runs = append(runs, batchRun{toolCapable: slices.Contains(resolvedTarget.metadata.Capabilities, "tools"), context: runContext, batchID: batch.ID, targetID: target.ID, generation: target.Generation, profile: resolvedTarget.profile, secret: resolvedTarget.secret, messages: messages, configuration: target.Generation.ConfigurationSnapshot})
	}
	service.activeMu.Unlock()
	for _, run := range runs {
		go service.runBatchGeneration(run.context, run.batchID, run.targetID, run.generation, run.profile, run.secret, run.messages, run.configuration, run.toolCapable)
	}
	return GenerationBatchStart{Batch: batch}, nil
}

func (service *Service) checkCardBatchStart(ctx context.Context, input SendInput, fingerprint string) (persistence.GenerationBatch, error) {
	batch, err := service.checkBatchStart(ctx, input.ClientRequestID)
	if err == nil && batch.ID != "" && len(batch.Targets) > 0 {
		saved := batch.Targets[0].Generation.ConfigurationSnapshot.MiniApp
		if (saved != nil || input.MiniApp != nil) && (batch.ConversationID != input.ConversationID || !reflect.DeepEqual(saved, input.MiniApp)) {
			return persistence.GenerationBatch{}, ErrAppTurnUnavailable
		}
	}
	if err != nil || batch.ID == "" || input.Card == nil {
		return batch, err
	}
	replay, matched, err := service.store.(persistence.InteractiveStore).CardReplay(ctx, *input.Card, fingerprint, input.ClientRequestID)
	if err != nil {
		return persistence.GenerationBatch{}, err
	}
	if !matched || replay.ConversationID != input.ConversationID {
		return persistence.GenerationBatch{}, persistence.ErrCardConflict
	}
	return replay, nil
}

func (service *Service) checkBatchStart(ctx context.Context, requestID string) (persistence.GenerationBatch, error) {
	batch, err := service.store.GetGenerationBatchByClientRequestID(ctx, requestID)
	if !errors.Is(err, sql.ErrNoRows) {
		return batch, err
	}
	return persistence.GenerationBatch{}, service.requireGenerationIdle(ctx)
}

func (service *Service) requireGenerationIdle(ctx context.Context) error {
	active, err := service.generationInProgress(ctx)
	if err != nil {
		return err
	}
	if active {
		if s := service.activeAppName(ctx); s != "" {
			return &AppTaskBusyError{Name: s}
		}
		return ErrGenerationBatchInProgress
	}
	return nil
}

func matchExpectedTargets(actual []persistence.ActiveModelTarget, expected []ExpectedGenerationTarget) error {
	if expected == nil {
		return nil
	}
	if len(actual) != len(expected) {
		return ErrGenerationSelectionChanged
	}
	for index, target := range actual {
		if target.ProviderID != expected[index].ProviderID || target.ModelID != expected[index].ModelID {
			return ErrGenerationSelectionChanged
		}
	}
	return nil
}

type resolvedCatalog struct {
	profile provider.Profile
	secret  credentials.Secret
	models  []provider.ModelMetadata
}

func (service *Service) resolveTargets(ctx context.Context, targets []persistence.ActiveModelTarget) ([]resolvedTarget, error) {
	catalogs := make(map[string]resolvedCatalog)
	resolved := make([]resolvedTarget, 0, len(targets))
	for _, target := range targets {
		var connection resolvedTarget
		if source, ok := service.profiles.(ProviderCatalogSource); ok {
			catalog, cached := catalogs[target.ProviderID]
			if !cached {
				profile, secret, models, err := source.ResolveCatalog(ctx, target.ProviderID)
				if err != nil {
					return nil, err
				}
				catalog = resolvedCatalog{profile: profile, secret: secret, models: models}
				catalogs[target.ProviderID] = catalog
			}
			connection.profile, connection.secret = catalog.profile, catalog.secret
			for _, model := range catalog.models {
				if model.ID == target.ModelID {
					connection.metadata = model
					break
				}
			}
			if connection.metadata.ID == "" {
				return nil, provider.ErrModelUnavailable
			}
		} else {
			if err := service.profiles.ValidateSelection(ctx, target.ProviderID, target.ModelID); err != nil {
				return nil, err
			}
			profile, secret, err := service.profiles.Resolve(ctx, target.ProviderID)
			if err != nil {
				return nil, err
			}
			connection.profile, connection.secret = profile, secret
			connection.metadata = provider.ModelMetadata{ID: target.ModelID, PrivacyMode: provider.PrivacyModeIncognito}
			if source, ok := service.profiles.(ModelMetadataSource); ok {
				connection.metadata, err = source.ModelMetadata(ctx, target.ProviderID, target.ModelID)
				if err != nil {
					return nil, err
				}
			}
		}
		connection.profile.Model = target.ModelID
		resolved = append(resolved, connection)
	}
	return resolved, nil
}

func (service *Service) checkResolvedProfile(ctx context.Context, profile provider.Profile) error {
	if source, ok := service.profiles.(ProviderCatalogSource); ok {
		return source.CheckResolvedProfile(ctx, profile)
	}
	return nil
}

func (service *Service) GetGenerationBatch(ctx context.Context, batchID string) (persistence.GenerationBatch, error) {
	return service.store.GetGenerationBatch(ctx, batchID)
}

// GetGenerationBatchContext reads the immutable context shared by every target and retry.
// It excludes the current user turn and the attempt's System Prompt.
func (service *Service) GetGenerationBatchContext(ctx context.Context, batchID string) ([]provider.ProviderMessage, error) {
	if _, err := service.store.GetGenerationBatch(ctx, batchID); err != nil {
		return nil, err
	}
	items, err := service.store.LoadGenerationBatchContext(ctx, batchID)
	if err != nil {
		return nil, err
	}
	messages := make([]provider.ProviderMessage, 0, len(items)*2)
	for _, item := range items {
		messages = append(messages, historyMessages(item)...)
	}
	return messages, nil
}

func (service *Service) SubscribeGenerationBatch(ctx context.Context, batchID, afterEventID string) (<-chan GenerationEvent, error) {
	batch, err := service.store.GetGenerationBatch(ctx, batchID)
	if err != nil {
		return nil, err
	}
	return service.batchHub.subscribe(ctx, batchID, afterEventID, isTerminalBatch(batch.State)), nil
}

func (service *Service) CancelGenerationBatch(ctx context.Context, batchID string) (persistence.GenerationBatch, error) {
	batch, err := service.store.GetGenerationBatch(ctx, batchID)
	if err != nil {
		return persistence.GenerationBatch{}, err
	}
	for _, target := range batch.Targets {
		if isTerminal(target.Generation.State) {
			continue
		}
		if _, err := service.CancelGeneration(ctx, target.Generation.ID); err != nil {
			return persistence.GenerationBatch{}, err
		}
	}
	return service.store.GetGenerationBatch(ctx, batchID)
}

func (service *Service) RetryGenerationTarget(ctx context.Context, targetID, clientRequestID string, requestedLocalOnly ...bool) (GenerationStart, error) {
	if service.store == nil || service.profiles == nil || service.provider == nil {
		return GenerationStart{}, errors.New("chat service dependencies are required")
	}
	localOnly := len(requestedLocalOnly) > 0 && requestedLocalOnly[0]
	service.startMu.Lock()
	target, existing, err := service.checkRetry(ctx, targetID, clientRequestID)
	service.startMu.Unlock()
	if err == nil && localOnly && (target.ProviderID != localmodels.ProviderID || !localmodels.IsChatModel(target.ModelID)) {
		return GenerationStart{}, ErrLocalOnly
	}
	if err != nil || existing.ID != "" {
		return GenerationStart{Generation: existing}, err
	}
	priorBatch, err := service.store.GetGenerationBatch(ctx, target.BatchID)
	if err != nil {
		return GenerationStart{}, err
	}
	if (localOnly || priorBatch.LocalOnly) && (target.ProviderID != localmodels.ProviderID || !localmodels.IsChatModel(target.ModelID) || priorBatch.WebSearch != nil) {
		return GenerationStart{}, ErrLocalOnly
	}
	resolved, resolveErr := service.resolveTargets(ctx, []persistence.ActiveModelTarget{{ProviderID: target.ProviderID, ModelID: target.ModelID}})
	service.startMu.Lock()
	defer service.startMu.Unlock()
	service.secureMu.Lock()
	defer service.secureMu.Unlock()
	current, existing, err := service.checkRetry(ctx, targetID, clientRequestID)
	if err != nil || existing.ID != "" {
		return GenerationStart{Generation: existing}, err
	}
	if current.Generation.ID != target.Generation.ID {
		return GenerationStart{}, ErrGenerationSelectionChanged
	}
	batch, err := service.store.GetGenerationBatch(ctx, target.BatchID)
	if err != nil {
		return GenerationStart{}, err
	}
	configuration := persistence.GenerationConfigurationSnapshot{SystemPrompt: batch.SystemPrompt, GenerationParameters: batch.GenerationParameters}
	if service.settings != nil {
		settings, err := service.settings.GetSettings(ctx)
		if err != nil {
			return GenerationStart{}, err
		}
		configuration = persistence.GenerationConfigurationSnapshot{SystemPrompt: settings.SystemPrompt, GenerationParameters: settings.GenerationParameters}
	}
	if batch.Interactive && service.settings != nil && interactiveResolvedTargets(resolved) {
		configuration.SystemPrompt += interactive.Prompt()
	}
	userBody, err := service.batchUserBody(ctx, batch)
	configuration.MiniApp = target.Generation.ConfigurationSnapshot.MiniApp
	if configuration.MiniApp != nil {
		if service.appActions == nil || resolveErr == nil && !resolved[0].allowsAppTurn() {
			return GenerationStart{}, ErrAppTurnUnavailable
		}
		if _, err := service.appActions.ChatActions(ctx, *configuration.MiniApp); err != nil {
			return GenerationStart{}, ErrAppTurnUnavailable
		}
	}
	configuration.WebSearch = batch.WebSearch
	if err != nil {
		return GenerationStart{}, err
	}
	// Keep the prior snapshot on a failed retry so a Private TEE requirement
	// also survives subsequent retries of this target.
	snapshot := target.Generation.Snapshot
	var connection resolvedTarget
	if resolveErr == nil {
		connection = resolved[0]
		if (localOnly || batch.LocalOnly) && connection.profile.Kind != provider.KindLocal {
			return GenerationStart{}, ErrLocalOnly
		}
		resolveErr = service.checkResolvedProfile(ctx, connection.profile)
		if connection.profile.Kind == provider.KindLocal && resolveErr != nil {
			return GenerationStart{}, resolveErr
		}
		if resolveErr == nil && snapshot.IsNearAI() && snapshot.PrivacyMode == provider.PrivacyModePrivateTEE && !connection.isPrivateTEE() {
			resolveErr = ErrPrivateTEEUnavailable
		}
		if resolveErr == nil {
			snapshot = snapshotFor(connection.profile, connection.metadata.PrivacyMode)
		}
	}
	configuration.GenerationParameters = effectiveGenerationParameters(configuration.GenerationParameters, snapshot.ProviderKind)
	var messages []provider.ProviderMessage
	if resolveErr == nil {
		messages, err = service.messagesForBatch(ctx, batch, userBody, configuration)
		if err != nil {
			return GenerationStart{}, err
		}
		characters := 0
		for _, message := range messages {
			characters += utf8.RuneCountInString(message.Content)
		}
		if characters > documents.MaxContextCharacters {
			return GenerationStart{}, documents.ErrContextLimit
		}
	}
	attempt := persistence.BeginGenerationAttemptInput{
		TargetID: target.ID, ClientRequestID: clientRequestID, Snapshot: snapshot, ConfigurationSnapshot: configuration,
	}
	if errors.Is(resolveErr, ErrPrivateTEEUnavailable) {
		attempt.Failure = &persistence.GenerationAttemptFailure{
			Code: "private_tee_unavailable", Message: "Private TEE is no longer available for this model.",
		}
	} else if resolveErr != nil {
		attempt.Failure = &persistence.GenerationAttemptFailure{
			Code: "target_unavailable", Message: "The original Provider target is no longer available for retry.",
		}
	}
	generation, err := service.store.BeginGenerationAttempt(ctx, attempt)
	if err != nil {
		return GenerationStart{}, err
	}
	// A retry stream contains one new attempt; earlier terminal targets do not
	// emit duplicate terminal events. The hub therefore waits for this target.
	service.batchHub.activate(batch.ID, 1)
	if attempt.Failure != nil {
		service.publishBatchTerminal(batch.ID, GenerationEvent{
			BatchID: batch.ID, TargetID: target.ID, GenerationID: generation.ID, Type: EventFailed,
			ErrorCode: generation.ErrorCode, ErrorMessage: generation.ErrorMessage,
		})
		return GenerationStart{Generation: generation}, nil
	}
	if connection.isSecure() {
		service.trackSecureGeneration(generation.ID)
		return GenerationStart{Generation: generation}, nil
	}
	runContext, cancel := context.WithTimeout(context.Background(), service.timeout)
	service.activeMu.Lock()
	service.active[generation.ID] = &activeGeneration{cancel: cancel, done: make(chan struct{})}
	service.activeMu.Unlock()
	go service.runBatchGeneration(runContext, batch.ID, target.ID, generation, connection.profile, connection.secret, messages, generation.ConfigurationSnapshot, slices.Contains(connection.metadata.Capabilities, "tools"))
	return GenerationStart{Generation: generation}, nil
}

func (service *Service) checkRetry(ctx context.Context, targetID, requestID string) (persistence.GenerationTarget, persistence.Generation, error) {
	target, err := service.store.GetGenerationTarget(ctx, targetID)
	if err != nil {
		return target, persistence.Generation{}, err
	}
	existing, err := service.store.GetGenerationByClientRequestID(ctx, requestID)
	if err == nil {
		if existing.GenerationTargetID != target.ID {
			return target, persistence.Generation{}, errors.New("generation retry request ID belongs to another target")
		}
		return target, existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return target, persistence.Generation{}, err
	}
	if err := service.requireGenerationIdle(ctx); err != nil {
		return target, persistence.Generation{}, err
	}
	if !isTerminal(target.Generation.State) {
		return target, persistence.Generation{}, errors.New("only a terminal Generation Target can be retried")
	}
	return target, persistence.Generation{}, nil
}

func (service *Service) SelectGenerationAnswer(ctx context.Context, generationID string) error {
	return service.store.SelectGenerationAnswer(ctx, generationID)
}

func (service *Service) SkipGenerationBatchContext(ctx context.Context, batchID string) error {
	return service.store.SkipGenerationBatchContext(ctx, batchID)
}

func (service *Service) activeModelSet(ctx context.Context, fallback SendInput) ([]persistence.ActiveModelTarget, string, persistence.GenerationParameters, error) {
	if service.settings != nil {
		settings, err := service.settings.GetSettings(ctx)
		if err != nil {
			return nil, "", persistence.GenerationParameters{}, err
		}
		if len(settings.ActiveModelSet) == 0 {
			return nil, "", persistence.GenerationParameters{}, ErrProviderSelectionRequired
		}
		if fallback.EditOfBatchID != "" && fallback.ExpectedTargets != nil {
			chosen := make([]persistence.ActiveModelTarget, 0, len(fallback.ExpectedTargets))
			seen := make(map[persistence.ActiveModelTarget]bool)
			for _, requested := range fallback.ExpectedTargets {
				target := persistence.ActiveModelTarget{ProviderID: requested.ProviderID, ModelID: requested.ModelID}
				found := false
				for _, current := range settings.ActiveModelSet {
					if current == target {
						found = true
						break
					}
				}
				if !found || seen[target] {
					return nil, "", persistence.GenerationParameters{}, ErrGenerationSelectionChanged
				}
				chosen = append(chosen, target)
				seen[target] = true
			}
			if len(chosen) == 0 {
				return nil, "", persistence.GenerationParameters{}, ErrProviderSelectionRequired
			}
			return chosen, settings.SystemPrompt, settings.GenerationParameters, nil
		}
		return settings.ActiveModelSet, settings.SystemPrompt, settings.GenerationParameters, nil
	}
	if strings.TrimSpace(fallback.ProviderID) == "" || strings.TrimSpace(fallback.ModelID) == "" {
		return nil, "", persistence.GenerationParameters{}, ErrProviderSelectionRequired
	}
	return []persistence.ActiveModelTarget{{ProviderID: fallback.ProviderID, ModelID: fallback.ModelID}}, fallback.SystemPrompt, fallback.GenerationParameters, nil
}

func (service *Service) messagesForBatch(ctx context.Context, batch persistence.GenerationBatch, currentBody string, configuration persistence.GenerationConfigurationSnapshot) ([]provider.ProviderMessage, error) {
	contextItems, err := service.store.LoadGenerationBatchContext(ctx, batch.ID)
	if err != nil {
		return nil, err
	}
	return messagesFromBatchContext(batch, currentBody, configuration, contextItems), nil
}

func historyMessages(item persistence.ContextItem) []provider.ProviderMessage {
	user, assistant := item.UserBody, item.AssistantBody
	if item.Interactive {
		user, assistant = interactive.CompactReference(user), interactive.HistoryText(assistant)
	}
	return []provider.ProviderMessage{{Role: "user", Content: modelAppReferences(user)}, {Role: "assistant", Content: assistant}}
}

func messagesFromBatchContext(batch persistence.GenerationBatch, currentBody string, configuration persistence.GenerationConfigurationSnapshot, contextItems []persistence.ContextItem) []provider.ProviderMessage {
	if batch.InputContent != "" {
		currentBody = batch.InputContent
	}
	messages := make([]provider.ProviderMessage, 0, 1+len(contextItems)*2+1)
	if prompt := projectInstructions(configuration.SystemPrompt, batch.ProjectContext); strings.TrimSpace(prompt) != "" {
		messages = append(messages, provider.ProviderMessage{Role: "system", Content: prompt})
	}
	for _, item := range contextItems {
		messages = append(messages, historyMessages(item)...)
	}
	messages = append(messages, provider.ProviderMessage{Role: "user", Content: projectUserContent(modelAppReferences(currentBody), batch.ProjectContext)})
	return messages
}

func (service *Service) batchUserBody(ctx context.Context, batch persistence.GenerationBatch) (string, error) {
	view, err := service.store.LoadConversation(ctx, batch.ConversationID)
	if err != nil {
		return "", err
	}
	for _, message := range view.Messages {
		if message.ID == batch.UserMessageID {
			return message.Body, nil
		}
	}
	return "", fmt.Errorf("batch user message %q: %w", batch.UserMessageID, sql.ErrNoRows)
}

type resolvedTarget struct {
	profile  provider.Profile
	secret   credentials.Secret
	metadata provider.ModelMetadata
}

func (target resolvedTarget) isPrivateTEE() bool {
	return target.profile.Kind == provider.KindNearAIPreset && target.metadata.PrivacyMode == provider.PrivacyModePrivateTEE && target.metadata.Verifiable
}

func (target resolvedTarget) isSecure() bool {
	return target.profile.Kind == provider.KindNearAIPreset && isNearAIVerifiedTransport(target.metadata.PrivacyMode)
}

func snapshotFor(profile provider.Profile, privacyMode string) persistence.ProviderSnapshot {
	if profile.Kind == provider.KindLocal {
		if model, err := localmodels.Lookup(profile.Model); err == nil && model.Role == "chat" {
			profile.LocalModel = &provider.ModelArtifact{Revision: model.Revision, SHA256: model.SHA256, RuntimeVersion: localmodels.RuntimeVersion}
		}
	}
	return persistence.ProviderSnapshot{
		LocalModel:   profile.LocalModel,
		ProviderKind: profile.Kind, ProviderID: profile.ID, ProviderName: profile.Name, ModelID: profile.Model,
		RuntimeLocation: profile.RuntimeLocation, Destination: profile.Destination,
		TransportSecurity: profile.TransportSecurity, PrivacyNotice: profile.PrivacyNotice,
		PrivacyMode: privacyMode,
	}
}

func isTerminalBatch(state persistence.GenerationBatchState) bool {
	return state == persistence.GenerationBatchCompleted || state == persistence.GenerationBatchCompletedWithErrors || state == persistence.GenerationBatchStopped || state == persistence.GenerationBatchFailed
}

func (service *Service) runBatchGeneration(ctx context.Context, batchID, targetID string, generation persistence.Generation, profile provider.Profile, secret credentials.Secret, messages []provider.ProviderMessage, configuration persistence.GenerationConfigurationSnapshot, toolCapable bool) {
	defer service.finishGeneration(generation.ID)
	measurement := generationMeasurement{started: time.Now()}
	if ctx.Err() != nil {
		service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationStopped, "stopped", "Generation stopped.")
		return
	}
	completion := provider.CompletionInput{Profile: profile, Secret: secret, Messages: append([]provider.ProviderMessage(nil), messages...), GenerationParameters: providerGenerationParameters(configuration.GenerationParameters)}
	if configuration.WebSearch != nil {
		completion.Tools = websearch.Tools()
	}
	completion.Activity = func(activity string) {
		service.publishBatch(GenerationEvent{BatchID: batchID, TargetID: targetID, GenerationID: generation.ID, Type: EventActivity, Activity: activity})
	}
	var stream provider.CompletionStream
	var err error
	if configuration.MiniApp != nil {
		stream, err = service.openAppTurn(ctx, completion, *configuration.MiniApp, toolCapable)
	} else {
		stream, err = service.provider.Stream(ctx, completion)
	}
	if err != nil {
		if ctx.Err() != nil {
			service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationStopped, "stopped", "Generation stopped.")
		} else {
			message := "Provider could not start the generation."
			if configuration.WebSearch != nil {
				message = "The Provider could not start a Web search response. Check tool calling support or turn Web search off."
			}
			code := providerErrorCode(err)
			if configuration.WebSearch != nil && code == "provider_error" {
				code = "web_research_failed"
			}
			service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationFailed, code, message)
		}
		return
	}
	defer stream.Close()
	if configuration.WebSearch != nil {
		stream = &webCompletionStream{service: service, generation: generation, input: completion, stream: stream}
		defer stream.Close()
	}
	var body, reasoning strings.Builder
	var finishReason string
	for {
		event, err := stream.Recv(ctx)
		if err != nil {
			if ctx.Err() != nil {
				service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationStopped, "stopped", "Generation stopped.")
			} else {
				message := "The Provider stream ended without completion."
				if configuration.WebSearch != nil {
					message = "The Provider could not finish web research. Check tool calling support or turn Web search off."
				}
				code := "protocol_error"
				if configuration.WebSearch != nil {
					code = "web_research_failed"
				}
				service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationFailed, code, message)
			}
			return
		}
		measurement.observe(event)
		switch event.Type {
		case provider.EventWebActivity:
			if event.Reset {
				body.Reset()
				reasoning.Reset()
				finishReason = ""
			}
			service.publishBatch(GenerationEvent{BatchID: batchID, TargetID: targetID, GenerationID: generation.ID, Type: EventWebActivity, WebActivity: event.WebActivity, Reset: event.Reset})
		case provider.EventStarted:
			_ = service.store.MarkGenerationStreaming(context.Background(), generation.ID)
			service.publishBatch(GenerationEvent{BatchID: batchID, TargetID: targetID, GenerationID: generation.ID, Type: EventStarted, Snapshot: &generation.Snapshot})
		case provider.EventDelta:
			if len(event.Delta)+len(event.ReasoningDelta) > provider.MaxCompletionBytes-body.Len()-reasoning.Len() {
				service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationFailed, "protocol_error", "The Provider response exceeded the size limit.")
				return
			}
			body.WriteString(event.Delta)
			reasoning.WriteString(event.ReasoningDelta)
			if event.FinishReason != "" {
				finishReason = event.FinishReason
			}
			service.publishBatch(GenerationEvent{BatchID: batchID, TargetID: targetID, GenerationID: generation.ID, Type: EventDelta, Delta: event.Delta, ReasoningDelta: event.ReasoningDelta})
		case provider.EventCompleted:
			if event.FinishReason != "" {
				finishReason = event.FinishReason
			}
			if strings.TrimSpace(body.String()) == "" {
				code, message := emptyProviderResponseFailure(finishReason)
				service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationFailed, code, message)
				return
			}
			if !service.claimTerminal(generation.ID) {
				return
			}
			if err := service.store.CompleteGeneration(context.Background(), persistence.CompleteGenerationInput{GenerationID: generation.ID, Body: body.String(), Reasoning: reasoning.String(), Metrics: measurement.snapshot()}); err != nil {
				_ = service.store.TerminateGeneration(context.Background(), persistence.TerminateGenerationInput{GenerationID: generation.ID, State: persistence.GenerationFailed, ErrorCode: "internal_error", ErrorMessage: "The completed response could not be saved."})
				service.publishBatchTerminal(batchID, GenerationEvent{BatchID: batchID, TargetID: targetID, GenerationID: generation.ID, Type: EventFailed, ErrorCode: "internal_error", ErrorMessage: "The completed response could not be saved."})
				return
			}
			service.publishBatchTerminal(batchID, GenerationEvent{BatchID: batchID, TargetID: targetID, GenerationID: generation.ID, Type: EventCompleted})
			return
		case provider.EventStopped:
			service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationStopped, "stopped", "Generation stopped.")
			return
		case provider.EventFailed:
			service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationFailed, "provider_error", "The Provider rejected the generation request.")
			return
		default:
			service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationFailed, "protocol_error", "The Provider returned an unknown event.")
			return
		}
	}
}

func providerGenerationParameters(parameters persistence.GenerationParameters) provider.GenerationParameters {
	return provider.GenerationParameters{
		Temperature: parameters.Temperature,
		TopP:        parameters.TopP,
		MaxTokens:   parameters.MaxTokens,
	}
}

func (service *Service) terminateBatchGeneration(batchID, targetID, generationID string, state persistence.GenerationState, code, message string) {
	if !service.claimTerminal(generationID) {
		return
	}
	_ = service.store.TerminateGeneration(context.Background(), persistence.TerminateGenerationInput{GenerationID: generationID, State: state, ErrorCode: code, ErrorMessage: message})
	eventType := EventFailed
	if state == persistence.GenerationStopped {
		eventType = EventStopped
	}
	service.publishBatchTerminal(batchID, GenerationEvent{BatchID: batchID, TargetID: targetID, GenerationID: generationID, Type: eventType, ErrorCode: code, ErrorMessage: message})
}

func (service *Service) finishGeneration(generationID string) {
	service.activeMu.Lock()
	active := service.active[generationID]
	delete(service.active, generationID)
	service.activeMu.Unlock()
	if active != nil {
		if active.cancel != nil {
			active.cancel()
		}
		close(active.done)
	}
}

func (service *Service) publishBatch(event GenerationEvent) {
	event.EventID = fmt.Sprintf("%d", service.nextID.Add(1))
	service.batchHub.publish(event, false)
}

func (service *Service) publishBatchTerminal(batchID string, event GenerationEvent) {
	event.EventID = fmt.Sprintf("%d", service.nextID.Add(1))
	batch, err := service.store.GetGenerationBatch(context.Background(), batchID)
	service.batchHub.publish(event, err == nil && isTerminalBatch(batch.State))
}

type batchEventHub struct {
	mu      sync.Mutex
	streams map[string]*batchEvents
}

type batchEvents struct {
	replay
	subscribers     map[chan GenerationEvent]struct{}
	terminal        bool
	expectedTargets int
	terminalTargets map[string]struct{}
}

func newBatchEventHub() *batchEventHub {
	return &batchEventHub{streams: make(map[string]*batchEvents)}
}

func (hub *batchEventHub) forgetCompleted(keep string) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	for id, stream := range hub.streams {
		if id != keep && stream.terminal && len(stream.subscribers) == 0 {
			delete(hub.streams, id)
		}
	}
}

func (hub *batchEventHub) activate(batchID string, expectedTargets ...int) {
	hub.forgetCompleted(batchID)
	hub.mu.Lock()
	defer hub.mu.Unlock()
	stream := hub.streams[batchID]
	if stream == nil {
		stream = &batchEvents{subscribers: make(map[chan GenerationEvent]struct{}), terminalTargets: make(map[string]struct{})}
		hub.streams[batchID] = stream
	}
	if len(expectedTargets) > 0 {
		stream.expectedTargets = expectedTargets[0]
	}
	stream.terminalTargets = make(map[string]struct{})
	stream.terminal = false
}

func (hub *batchEventHub) publish(event GenerationEvent, terminal bool) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	stream := hub.streams[event.BatchID]
	if stream == nil {
		stream = &batchEvents{subscribers: make(map[chan GenerationEvent]struct{}), terminalTargets: make(map[string]struct{})}
		hub.streams[event.BatchID] = stream
	}
	stream.replay.append(event)
	if event.Type == EventCompleted || event.Type == EventStopped || event.Type == EventFailed {
		if event.TargetID != "" && stream.expectedTargets > 0 {
			stream.terminalTargets[event.TargetID] = struct{}{}
			terminal = len(stream.terminalTargets) >= stream.expectedTargets
		}
	}
	for subscriber := range stream.subscribers {
		select {
		case subscriber <- event:
		default:
			// Slow subscribers reconnect and reconcile against persisted state.
			// Never hold the hub lock while waiting for a browser to read.
			close(subscriber)
			delete(stream.subscribers, subscriber)
			continue
		}
		if terminal {
			close(subscriber)
			delete(stream.subscribers, subscriber)
		}
	}
	if terminal {
		stream.terminal = true
	}
}

func (hub *batchEventHub) subscribe(ctx context.Context, batchID, afterID string, terminal bool) <-chan GenerationEvent {
	channel := make(chan GenerationEvent, maxReplayEvents)
	hub.mu.Lock()
	stream := hub.streams[batchID]
	if stream == nil {
		if terminal {
			hub.mu.Unlock()
			close(channel)
			return channel
		}
		stream = &batchEvents{subscribers: make(map[chan GenerationEvent]struct{})}
		hub.streams[batchID] = stream
	} else if terminal {
		stream.terminal = true
	}
	lastEventNumber, _ := strconv.ParseUint(afterID, 10, 64)
	for _, event := range stream.events {
		eventNumber, _ := strconv.ParseUint(event.EventID, 10, 64)
		if afterID == "" || eventNumber > lastEventNumber {
			channel <- event
		}
	}
	if stream.terminal {
		close(channel)
	} else {
		stream.subscribers[channel] = struct{}{}
		go hub.removeSubscriber(ctx, stream, channel)
	}
	hub.mu.Unlock()
	return channel
}

func (hub *batchEventHub) removeSubscriber(ctx context.Context, stream *batchEvents, channel chan GenerationEvent) {
	<-ctx.Done()
	hub.mu.Lock()
	defer hub.mu.Unlock()
	if _, ok := stream.subscribers[channel]; ok {
		delete(stream.subscribers, channel)
		close(channel)
	}
}

func isNearAIVerifiedTransport(privacyMode string) bool {
	return privacyMode == provider.PrivacyModePrivateTEE || privacyMode == provider.PrivacyModeIncognito || privacyMode == provider.PrivacyModeChutes
}

// Save each attempt's effective limits without changing workspace preferences or other comparison targets.
func effectiveGenerationParameters(parameters persistence.GenerationParameters, kind string) persistence.GenerationParameters {
	if kind == provider.KindLocal && (parameters.MaxTokens == nil || *parameters.MaxTokens > localmodels.MaxOutputTokens) {
		limit := localmodels.MaxOutputTokens
		parameters.MaxTokens = &limit
	}
	return parameters
}
