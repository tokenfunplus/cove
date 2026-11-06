package chat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func (service *Service) StartGenerationBatch(ctx context.Context, input SendInput) (GenerationBatchStart, error) {
	if service.store == nil || service.profiles == nil || service.provider == nil {
		return GenerationBatchStart{}, errors.New("chat service dependencies are required")
	}
	service.startMu.Lock()
	defer service.startMu.Unlock()
	if existing, err := service.store.GetGenerationBatchByClientRequestID(ctx, input.ClientRequestID); err == nil {
		return GenerationBatchStart{Batch: existing}, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return GenerationBatchStart{}, err
	}
	activeGenerationExists, err := service.generationInProgress(ctx)
	if err != nil {
		return GenerationBatchStart{}, err
	}
	if activeGenerationExists {
		return GenerationBatchStart{}, ErrGenerationBatchInProgress
	}

	activeModelSet, systemPrompt, parameters, err := service.activeModelSet(ctx, input)
	if err != nil {
		return GenerationBatchStart{}, err
	}
	resolved := make([]resolvedTarget, 0, len(activeModelSet))
	batchTargets := make([]persistence.GenerationTargetInput, 0, len(activeModelSet))
	for _, target := range activeModelSet {
		if err := service.profiles.ValidateSelection(ctx, target.ProviderID, target.ModelID); err != nil {
			return GenerationBatchStart{}, err
		}
		profile, secret, err := service.profiles.Resolve(ctx, target.ProviderID)
		if err != nil {
			return GenerationBatchStart{}, err
		}
		profile.Model = target.ModelID
		metadata := provider.ModelMetadata{ID: target.ModelID, PrivacyMode: provider.PrivacyModeIncognito, Verifiable: false}
		if source, ok := service.profiles.(ModelMetadataSource); ok {
			metadata, err = source.ModelMetadata(ctx, target.ProviderID, target.ModelID)
			if err != nil {
				return GenerationBatchStart{}, err
			}
		}
		snapshot := snapshotFor(profile, metadata.PrivacyMode)
		resolved = append(resolved, resolvedTarget{profile: profile, secret: secret, metadata: metadata})
		batchTargets = append(batchTargets, persistence.GenerationTargetInput{ProviderID: target.ProviderID, ModelID: target.ModelID, Snapshot: snapshot})
	}
	batch, err := service.store.BeginGenerationBatch(ctx, persistence.BeginGenerationBatchInput{
		ConversationID: input.ConversationID, ClientRequestID: input.ClientRequestID, Body: input.Body, SystemPrompt: systemPrompt, GenerationParameters: parameters, Targets: batchTargets,
	})
	if err != nil {
		return GenerationBatchStart{}, err
	}
	service.batchHub.activate(batch.ID, len(batch.Targets))
	// NearAI Private TEE, Incognito, and Chutes targets are driven by the
	// browser Secure Inference Transport. Ordinary OpenAI-compatible Providers
	// keep the Local Service plaintext stream.
	hasLegacyTarget := false
	for _, target := range resolved {
		if !target.isSecure() {
			hasLegacyTarget = true
			break
		}
	}
	var messages []provider.ProviderMessage
	if hasLegacyTarget {
		configuration := batch.Targets[0].Generation.ConfigurationSnapshot
		messages, err = service.messagesForBatch(ctx, batch, input.Body, configuration)
		if err != nil {
			return GenerationBatchStart{}, err
		}
	}
	service.activeMu.Lock()
	for _, target := range batch.Targets {
		if resolved[target.Position].isSecure() {
			service.secureActive[target.Generation.ID] = struct{}{}
		}
	}
	service.activeMu.Unlock()
	if !hasLegacyTarget {
		return GenerationBatchStart{Batch: batch}, nil
	}
	type batchRun struct {
		context       context.Context
		batchID       string
		targetID      string
		generation    persistence.Generation
		profile       provider.Profile
		secret        credentials.Secret
		messages      []provider.ProviderMessage
		configuration persistence.GenerationConfigurationSnapshot
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
		runs = append(runs, batchRun{context: runContext, batchID: batch.ID, targetID: target.ID, generation: target.Generation, profile: resolvedTarget.profile, secret: resolvedTarget.secret, messages: messages, configuration: target.Generation.ConfigurationSnapshot})
	}
	service.activeMu.Unlock()
	for _, run := range runs {
		go service.runBatchGeneration(run.context, run.batchID, run.targetID, run.generation, run.profile, run.secret, run.messages, run.configuration)
	}
	return GenerationBatchStart{Batch: batch}, nil
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
		messages = append(messages, provider.ProviderMessage{Role: "user", Content: item.UserBody}, provider.ProviderMessage{Role: "assistant", Content: item.AssistantBody})
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

func (service *Service) RetryGenerationTarget(ctx context.Context, targetID, clientRequestID string) (GenerationStart, error) {
	if service.store == nil || service.profiles == nil || service.provider == nil {
		return GenerationStart{}, errors.New("chat service dependencies are required")
	}
	service.startMu.Lock()
	defer service.startMu.Unlock()
	target, err := service.store.GetGenerationTarget(ctx, targetID)
	if err != nil {
		return GenerationStart{}, err
	}
	if existing, err := service.store.GetGenerationByClientRequestID(ctx, clientRequestID); err == nil {
		if existing.GenerationTargetID != target.ID {
			return GenerationStart{}, errors.New("generation retry request ID belongs to another target")
		}
		return GenerationStart{Generation: existing}, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return GenerationStart{}, err
	}
	activeGenerationExists, err := service.generationInProgress(ctx)
	if err != nil {
		return GenerationStart{}, err
	}
	if activeGenerationExists {
		return GenerationStart{}, ErrGenerationBatchInProgress
	}
	if !isTerminal(target.Generation.State) {
		return GenerationStart{}, errors.New("only a terminal Generation Target can be retried")
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
	userBody, err := service.batchUserBody(ctx, batch)
	if err != nil {
		return GenerationStart{}, err
	}
	// A retry fixes the target identity but deliberately captures the current
	// connection profile. If that target can no longer be resolved, it still
	// becomes a durable failed attempt rather than silently substituting a model
	// or losing the user's retry action.
	snapshot := target.Generation.Snapshot
	profile, secret, resolveErr := service.profiles.Resolve(ctx, target.ProviderID)
	var selectionErr error
	metadata := provider.ModelMetadata{ID: target.ModelID, PrivacyMode: snapshot.PrivacyMode, Verifiable: snapshot.PrivacyMode == provider.PrivacyModePrivateTEE}
	if resolveErr == nil {
		profile.Model = target.ModelID
		selectionErr = service.profiles.ValidateSelection(ctx, target.ProviderID, target.ModelID)
		if source, ok := service.profiles.(ModelMetadataSource); ok {
			if catalogMetadata, catalogErr := source.ModelMetadata(ctx, target.ProviderID, target.ModelID); catalogErr == nil {
				metadata = catalogMetadata
			} else {
				selectionErr = catalogErr
			}
		}
		snapshot = snapshotFor(profile, metadata.PrivacyMode)
	}
	generation, err := service.store.BeginGenerationAttempt(ctx, persistence.BeginGenerationAttemptInput{TargetID: target.ID, ClientRequestID: clientRequestID, Snapshot: snapshot, ConfigurationSnapshot: configuration})
	if err != nil {
		return GenerationStart{}, err
	}
	// A retry stream contains one new attempt; earlier terminal targets do not
	// emit duplicate terminal events. The hub therefore waits for this target.
	service.batchHub.activate(batch.ID, 1)
	if profile.Kind == provider.KindNearAIPreset && isNearAIVerifiedTransport(metadata.PrivacyMode) {
		service.activeMu.Lock()
		service.secureActive[generation.ID] = struct{}{}
		service.activeMu.Unlock()
	}
	if resolveErr != nil || selectionErr != nil {
		service.activeMu.Lock()
		delete(service.secureActive, generation.ID)
		service.activeMu.Unlock()
		if err := service.store.TerminateGeneration(context.Background(), persistence.TerminateGenerationInput{
			GenerationID: generation.ID, State: persistence.GenerationFailed, ErrorCode: "target_unavailable", ErrorMessage: "The original Provider target is no longer available for retry.",
		}); err != nil {
			return GenerationStart{}, err
		}
		service.publishBatchTerminal(batch.ID, GenerationEvent{
			BatchID: batch.ID, TargetID: target.ID, GenerationID: generation.ID, Type: EventFailed,
			ErrorCode: "target_unavailable", ErrorMessage: "The original Provider target is no longer available for retry.",
		})
		return GenerationStart{Generation: generation}, nil
	}
	if profile.Kind == provider.KindNearAIPreset && isNearAIVerifiedTransport(metadata.PrivacyMode) {
		return GenerationStart{Generation: generation}, nil
	}
	messages, err := service.messagesForBatch(ctx, batch, userBody, generation.ConfigurationSnapshot)
	if err != nil {
		return GenerationStart{}, err
	}
	runContext, cancel := context.WithTimeout(context.Background(), service.timeout)
	service.activeMu.Lock()
	service.active[generation.ID] = &activeGeneration{cancel: cancel, done: make(chan struct{})}
	service.activeMu.Unlock()
	go service.runBatchGeneration(runContext, batch.ID, target.ID, generation, profile, secret, messages, generation.ConfigurationSnapshot)
	return GenerationStart{Generation: generation}, nil
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
	messages := make([]provider.ProviderMessage, 0, 1+len(contextItems)*2+1)
	if strings.TrimSpace(configuration.SystemPrompt) != "" {
		messages = append(messages, provider.ProviderMessage{Role: "system", Content: configuration.SystemPrompt})
	}
	for _, item := range contextItems {
		messages = append(messages, provider.ProviderMessage{Role: "user", Content: item.UserBody}, provider.ProviderMessage{Role: "assistant", Content: item.AssistantBody})
	}
	messages = append(messages, provider.ProviderMessage{Role: "user", Content: currentBody})
	return messages, nil
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

func (target resolvedTarget) isSecure() bool {
	if target.profile.Kind != provider.KindNearAIPreset {
		return false
	}
	switch target.metadata.PrivacyMode {
	case provider.PrivacyModePrivateTEE, provider.PrivacyModeIncognito, provider.PrivacyModeChutes:
		return true
	default:
		return false
	}
}

func snapshotFor(profile provider.Profile, privacyMode string) persistence.ProviderSnapshot {
	return persistence.ProviderSnapshot{
		ProviderID: profile.ID, ProviderName: profile.Name, ModelID: profile.Model,
		RuntimeLocation: profile.RuntimeLocation, Destination: profile.Destination,
		TransportSecurity: profile.TransportSecurity, PrivacyNotice: profile.PrivacyNotice,
		PrivacyMode: privacyMode,
	}
}

func isTerminalBatch(state persistence.GenerationBatchState) bool {
	return state == persistence.GenerationBatchCompleted || state == persistence.GenerationBatchCompletedWithErrors || state == persistence.GenerationBatchStopped || state == persistence.GenerationBatchFailed
}

func (service *Service) runBatchGeneration(ctx context.Context, batchID, targetID string, generation persistence.Generation, profile provider.Profile, secret credentials.Secret, messages []provider.ProviderMessage, configuration persistence.GenerationConfigurationSnapshot) {
	defer service.finishGeneration(generation.ID)
	if ctx.Err() != nil {
		service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationStopped, "stopped", "Generation stopped.")
		return
	}
	stream, err := service.provider.Stream(ctx, provider.CompletionInput{Profile: profile, Secret: secret, Messages: append([]provider.ProviderMessage(nil), messages...), GenerationParameters: providerGenerationParameters(configuration.GenerationParameters)})
	if err != nil {
		if ctx.Err() != nil {
			service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationStopped, "stopped", "Generation stopped.")
		} else {
			service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationFailed, providerErrorCode(err), "Provider could not start the generation.")
		}
		return
	}
	defer stream.Close()
	var body, finishReason string
	for {
		event, err := stream.Recv(ctx)
		if err != nil {
			if ctx.Err() != nil {
				service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationStopped, "stopped", "Generation stopped.")
			} else {
				service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationFailed, "protocol_error", "The Provider stream ended without completion.")
			}
			return
		}
		switch event.Type {
		case provider.EventStarted:
			_ = service.store.MarkGenerationStreaming(context.Background(), generation.ID)
			service.publishBatch(GenerationEvent{BatchID: batchID, TargetID: targetID, GenerationID: generation.ID, Type: EventStarted, Snapshot: &generation.Snapshot})
		case provider.EventDelta:
			body += event.Delta
			if event.FinishReason != "" {
				finishReason = event.FinishReason
			}
			service.publishBatch(GenerationEvent{BatchID: batchID, TargetID: targetID, GenerationID: generation.ID, Type: EventDelta, Delta: event.Delta})
		case provider.EventCompleted:
			if event.FinishReason != "" {
				finishReason = event.FinishReason
			}
			if strings.TrimSpace(body) == "" {
				code, message := emptyProviderResponseFailure(finishReason)
				service.terminateBatchGeneration(batchID, targetID, generation.ID, persistence.GenerationFailed, code, message)
				return
			}
			if !service.claimTerminal(generation.ID) {
				return
			}
			if err := service.store.CompleteGeneration(context.Background(), persistence.CompleteGenerationInput{GenerationID: generation.ID, Body: body}); err != nil {
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
	events          []GenerationEvent
	subscribers     map[chan GenerationEvent]struct{}
	terminal        bool
	expectedTargets int
	terminalTargets map[string]struct{}
}

func newBatchEventHub() *batchEventHub {
	return &batchEventHub{streams: make(map[string]*batchEvents)}
}

func (hub *batchEventHub) activate(batchID string, expectedTargets ...int) {
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
	stream.events = append(stream.events, event)
	if event.Type == EventCompleted || event.Type == EventStopped || event.Type == EventFailed {
		if event.TargetID != "" && stream.expectedTargets > 0 {
			stream.terminalTargets[event.TargetID] = struct{}{}
			terminal = len(stream.terminalTargets) >= stream.expectedTargets
		}
	}
	if len(stream.events) > 256 {
		stream.events = stream.events[len(stream.events)-256:]
	}
	for subscriber := range stream.subscribers {
		subscriber <- event
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
	channel := make(chan GenerationEvent, 256)
	hub.mu.Lock()
	stream := hub.streams[batchID]
	if stream == nil {
		stream = &batchEvents{subscribers: make(map[chan GenerationEvent]struct{}), terminal: terminal}
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
