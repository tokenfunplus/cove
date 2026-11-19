package chat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type ProviderSource interface {
	Resolve(ctx context.Context, providerID string) (provider.Profile, credentials.Secret, error)
	ValidateSelection(ctx context.Context, providerID, modelID string) error
}

// ModelMetadataSource is implemented by the production Provider config
// service. It is optional so small test/fake Provider sources keep the secure
// default for NearAI targets unless they explicitly advertise a model class.
type ModelMetadataSource interface {
	ModelMetadata(ctx context.Context, providerID, modelID string) (provider.ModelMetadata, error)
}

type ProviderCatalogSource interface {
	ResolveCatalog(ctx context.Context, id string) (provider.Profile, credentials.Secret, []provider.ModelMetadata, error)
	CheckResolvedProfile(ctx context.Context, profile provider.Profile) error
}

type ExpectedGenerationTarget struct {
	ProviderID        string `json:"provider_id"`
	ModelID           string `json:"model_id"`
	RequirePrivateTEE bool   `json:"require_private_tee,omitempty"`
}

type SendInput struct {
	EditOfBatchID        string
	ExpectedTargets      []ExpectedGenerationTarget
	ConversationID       string
	ProviderID           string
	ModelID              string
	ClientRequestID      string
	Body                 string
	Attachments          []documents.Input
	SystemPrompt         string
	GenerationParameters persistence.GenerationParameters
}

type GenerationStart struct {
	Generation persistence.Generation
}

type GenerationBatchStart struct {
	Batch persistence.GenerationBatch
}

var ErrGenerationInProgress = errors.New("a Generation is already in progress")
var ErrGenerationBatchInProgress = errors.New("a Generation Batch is already in progress")
var ErrGenerationSelectionChanged = errors.New("active model selection changed")
var ErrPrivateTEEUnavailable = errors.New("the required Private TEE transport is unavailable")
var ErrProviderSelectionRequired = errors.New("a configured Provider and model must be selected")

func emptyProviderResponseFailure(finishReason string) (string, string) {
	if strings.EqualFold(strings.TrimSpace(finishReason), "length") {
		return "output_limit", "The Provider reached the output token limit before returning an assistant response."
	}
	return "empty_response", "The Provider completed without an assistant response."
}

type Chat interface {
	PreviewAttachment(ctx context.Context, input documents.Input) (documents.Snapshot, error)
	ReadAttachment(ctx context.Context, batchID, documentID string) (documents.Input, error)
	PreviewGenerationContext(ctx context.Context, input SendInput) ([]provider.ProviderMessage, error)
	CreateConversation(ctx context.Context, title string) (persistence.Conversation, error)
	ListConversations(ctx context.Context, archived bool) ([]persistence.Conversation, error)
	SearchConversations(ctx context.Context, query string, archived bool) ([]persistence.ConversationSearchResult, error)
	ReadConversation(ctx context.Context, conversationID string) (persistence.ConversationView, error)
	StartGeneration(ctx context.Context, input SendInput) (GenerationStart, error)
	SubscribeGeneration(ctx context.Context, generationID, afterEventID string) (<-chan GenerationEvent, error)
	GetGeneration(ctx context.Context, generationID string) (persistence.Generation, error)
	CancelGeneration(ctx context.Context, generationID string) (persistence.Generation, error)
	MarkSecureGenerationVerifyingEnvironment(ctx context.Context, generationID string) (persistence.Generation, error)
	MarkSecureGenerationStreaming(ctx context.Context, generationID string) (persistence.Generation, error)
	MarkSecureGenerationVerifyingResponse(ctx context.Context, generationID string) (persistence.Generation, error)
	SettleSecureGeneration(ctx context.Context, input persistence.SecureGenerationSettlementInput) (persistence.Generation, error)
	RenameConversation(ctx context.Context, conversationID, title string) error
	SetConversationPinned(ctx context.Context, conversationID string, pinned bool) error
	SetConversationArchived(ctx context.Context, conversationID string, archived bool) error
	DeleteConversation(ctx context.Context, conversationID string) error
	ClearChatData(ctx context.Context) error
	StartGenerationBatch(ctx context.Context, input SendInput) (GenerationBatchStart, error)
	GetGenerationBatch(ctx context.Context, batchID string) (persistence.GenerationBatch, error)
	GetGenerationBatchContext(ctx context.Context, batchID string) ([]provider.ProviderMessage, error)
	SubscribeGenerationBatch(ctx context.Context, batchID, afterEventID string) (<-chan GenerationEvent, error)
	CancelGenerationBatch(ctx context.Context, batchID string) (persistence.GenerationBatch, error)
	RetryGenerationTarget(ctx context.Context, targetID, clientRequestID string) (GenerationStart, error)
	SelectGenerationAnswer(ctx context.Context, generationID string) error
	SkipGenerationBatchContext(ctx context.Context, batchID string) error
	HasActiveGenerationBatch() bool
}

func (service *Service) HasActiveGenerationBatch() bool {
	if service.debateBusy() {
		return true
	}
	service.activeMu.Lock()
	defer service.activeMu.Unlock()
	return len(service.active) > 0 || len(service.secureActive) > 0
}

type EventType string

const (
	EventStarted   EventType = "started"
	EventDelta     EventType = "delta"
	EventCompleted EventType = "completed"
	EventStopped   EventType = "stopped"
	EventFailed    EventType = "failed"
)

type GenerationEvent struct {
	EventID        string                        `json:"event_id"`
	BatchID        string                        `json:"batch_id,omitempty"`
	TargetID       string                        `json:"target_id,omitempty"`
	GenerationID   string                        `json:"generation_id"`
	Type           EventType                     `json:"type"`
	Delta          string                        `json:"delta,omitempty"`
	ReasoningDelta string                        `json:"reasoning_delta,omitempty"`
	ErrorCode      string                        `json:"error_code,omitempty"`
	ErrorMessage   string                        `json:"error_message,omitempty"`
	Snapshot       *persistence.ProviderSnapshot `json:"snapshot,omitempty"`
}

type Service struct {
	debateMu       sync.Mutex
	debate         *debateRun
	debateWatchers map[string]map[chan struct{}]bool
	debateDelay    time.Duration
	documentParser documents.Parser
	store          persistence.ChatStore
	profiles       ProviderSource
	provider       provider.Provider
	hub            *eventHub
	batchHub       *batchEventHub
	nextID         atomic.Uint64
	startMu        sync.Mutex
	activeMu       sync.Mutex
	active         map[string]*activeGeneration
	secureActive   map[string]*time.Timer
	secureMu       sync.Mutex
	secureTimeout  time.Duration
	timeout        time.Duration
	settings       persistence.SettingsStore

	debateAdmissionClosed bool // guarded by startMu
}

type activeGeneration struct {
	cancel      context.CancelFunc
	done        chan struct{}
	terminalMu  sync.Mutex
	terminalSet bool
}

func NewService(store persistence.ChatStore, profiles ProviderSource, upstream provider.Provider) *Service {
	return NewServiceWithTimeout(store, profiles, upstream, 2*time.Minute)
}

func NewServiceWithTimeout(store persistence.ChatStore, profiles ProviderSource, upstream provider.Provider, timeout time.Duration) *Service {
	return &Service{
		debateDelay: time.Second,
		store:       store, profiles: profiles, provider: upstream,
		hub: newEventHub(), batchHub: newBatchEventHub(),
		active: make(map[string]*activeGeneration), secureActive: make(map[string]*time.Timer),
		timeout: timeout, secureTimeout: timeout + 30*time.Second,
	}
}

func NewServiceWithSettings(store persistence.ChatStore, profiles ProviderSource, upstream provider.Provider, settings persistence.SettingsStore) *Service {
	service := NewService(store, profiles, upstream)
	service.settings = settings
	return service
}

func (service *Service) StartGeneration(ctx context.Context, input SendInput) (GenerationStart, error) {
	if err := service.guardDebateConversation(ctx, input.ConversationID); err != nil {
		return GenerationStart{}, err
	}
	if service.store == nil || service.profiles == nil || service.provider == nil {
		return GenerationStart{}, errors.New("chat service dependencies are required")
	}
	service.startMu.Lock()
	defer service.startMu.Unlock()
	service.secureMu.Lock()
	defer service.secureMu.Unlock()
	if existing, err := service.store.GetGenerationByClientRequestID(ctx, input.ClientRequestID); err == nil {
		return GenerationStart{Generation: existing}, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return GenerationStart{}, err
	}
	activeGenerationExists, err := service.generationInProgress(ctx)
	if err != nil {
		return GenerationStart{}, err
	}
	if activeGenerationExists {
		return GenerationStart{}, ErrGenerationInProgress
	}
	providerID := input.ProviderID
	modelID := strings.TrimSpace(input.ModelID)
	if service.settings != nil {
		settings, err := service.settings.GetSettings(ctx)
		if err != nil {
			return GenerationStart{}, err
		}
		providerID = settings.ActiveProviderID
		modelID = settings.ActiveModelID
		input.SystemPrompt = settings.SystemPrompt
		input.GenerationParameters = settings.GenerationParameters
	}
	if strings.TrimSpace(providerID) == "" {
		return GenerationStart{}, ErrProviderSelectionRequired
	}
	profile, secret, err := service.profiles.Resolve(ctx, providerID)
	if err != nil {
		return GenerationStart{}, err
	}
	if modelID == "" {
		modelID = strings.TrimSpace(profile.Model)
	}
	if modelID == "" {
		return GenerationStart{}, ErrProviderSelectionRequired
	}
	if err := service.profiles.ValidateSelection(ctx, providerID, modelID); err != nil {
		return GenerationStart{}, err
	}
	profile.Model = modelID
	snapshot := snapshotFor(profile, "")
	generation, err := service.store.BeginGeneration(ctx, persistence.BeginGenerationInput{
		ConversationID: input.ConversationID, ClientRequestID: input.ClientRequestID,
		Body: input.Body, Snapshot: snapshot,
		ConfigurationSnapshot: persistence.GenerationConfigurationSnapshot{
			SystemPrompt: input.SystemPrompt, GenerationParameters: input.GenerationParameters,
		},
	})
	if err != nil {
		return GenerationStart{}, err
	}
	service.hub.ensure(generation.ID)
	runContext, cancel := context.WithTimeout(context.Background(), service.timeout)
	service.activeMu.Lock()
	service.active[generation.ID] = &activeGeneration{cancel: cancel, done: make(chan struct{})}
	service.activeMu.Unlock()
	go service.runGeneration(runContext, generation, profile, secret, generation.ConfigurationSnapshot)
	return GenerationStart{Generation: generation}, nil
}

// A persisted terminal result may become visible just before its worker's
// deferred cleanup finishes. Wait for that cleanup rather than rejecting the
// next send as busy after the previous answer is already complete.
// Callers hold startMu, so another send cannot start while this check waits.
func (service *Service) generationInProgress(ctx context.Context) (bool, error) {
	if service.debateBusy() {
		return true, nil
	}
	service.activeMu.Lock()
	workers := make(map[string]*activeGeneration, len(service.active)+len(service.secureActive))
	for id, active := range service.active {
		workers[id] = active
	}
	for id := range service.secureActive {
		workers[id] = nil
	}
	service.activeMu.Unlock()
	for id, worker := range workers {
		generation, err := service.store.GetGeneration(ctx, id)
		if err != nil {
			return false, err
		}
		if !isTerminal(generation.State) {
			return true, nil
		}
		if worker != nil {
			select {
			case <-worker.done:
			case <-ctx.Done():
				return false, ctx.Err()
			}
		}
	}
	return false, nil
}

func (service *Service) SubscribeGeneration(ctx context.Context, generationID, afterEventID string) (<-chan GenerationEvent, error) {
	generation, err := service.store.GetGeneration(ctx, generationID)
	if err != nil {
		return nil, err
	}
	return service.hub.subscribe(ctx, generationID, afterEventID, isTerminal(generation.State)), nil
}

func isTerminal(state persistence.GenerationState) bool {
	return state == persistence.GenerationCompleted || state == persistence.GenerationStopped || state == persistence.GenerationFailed
}

func (service *Service) GetGeneration(ctx context.Context, generationID string) (persistence.Generation, error) {
	return service.store.GetGeneration(ctx, generationID)
}

func (service *Service) CreateConversation(ctx context.Context, title string) (persistence.Conversation, error) {
	return service.store.CreateConversation(ctx, title)
}

func (service *Service) ListConversations(ctx context.Context, archived bool) ([]persistence.Conversation, error) {
	if archived {
		return service.store.ListArchivedConversations(ctx)
	}
	return service.store.ListConversations(ctx)
}

func (service *Service) ReadConversation(ctx context.Context, conversationID string) (persistence.ConversationView, error) {
	return service.store.LoadConversation(ctx, conversationID)
}

func (service *Service) SearchConversations(ctx context.Context, query string, archived bool) ([]persistence.ConversationSearchResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return service.store.SearchConversations(ctx, query, archived)
}

func (service *Service) SearchFilteredConversations(ctx context.Context, query string, archived bool, filter persistence.ConversationSearchFilter) ([]persistence.ConversationSearchResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	store, ok := service.store.(persistence.FilteredConversationSearcher)
	if !ok {
		return nil, errors.New("filtered local history is unavailable")
	}
	return store.SearchFilteredConversations(ctx, query, archived, filter)
}

func (service *Service) RenameConversation(ctx context.Context, conversationID, title string) error {
	return service.store.RenameConversation(ctx, conversationID, title)
}

func (service *Service) SetConversationPinned(ctx context.Context, conversationID string, pinned bool) error {
	return service.store.SetConversationPinned(ctx, conversationID, pinned)
}

func (service *Service) SetConversationArchived(ctx context.Context, conversationID string, archived bool) error {
	return service.store.SetConversationArchived(ctx, conversationID, archived)
}

func (service *Service) DeleteConversation(ctx context.Context, conversationID string) error {
	service.startMu.Lock()
	defer service.startMu.Unlock()
	if err := service.stopDebateForDataChange(ctx, conversationID); err != nil {
		return err
	}
	service.activeMu.Lock()
	ids := make([]string, 0, len(service.active)+len(service.secureActive))
	for id := range service.active {
		ids = append(ids, id)
	}
	for id := range service.secureActive {
		ids = append(ids, id)
	}
	service.activeMu.Unlock()
	for _, id := range ids {
		generation, err := service.store.GetGeneration(ctx, id)
		if err != nil {
			return err
		}
		if generation.ConversationID != conversationID {
			continue
		}
		if _, err := service.CancelGeneration(ctx, id); err != nil {
			return err
		}
	}
	return service.store.DeleteConversation(ctx, conversationID)
}

func (service *Service) ClearChatData(ctx context.Context) error {
	if service.store == nil {
		return errors.New("chat store is required")
	}
	service.startMu.Lock()
	defer service.startMu.Unlock()
	if err := service.stopDebateForDataChange(ctx, ""); err != nil {
		return err
	}
	service.activeMu.Lock()
	activeGenerationIDs := make([]string, 0, len(service.active)+len(service.secureActive))
	for id := range service.active {
		activeGenerationIDs = append(activeGenerationIDs, id)
	}
	for id := range service.secureActive {
		activeGenerationIDs = append(activeGenerationIDs, id)
	}
	service.activeMu.Unlock()
	for _, id := range activeGenerationIDs {
		if _, err := service.CancelGeneration(ctx, id); err != nil {
			return err
		}
	}
	if err := service.store.ClearChatData(ctx); err != nil {
		return err
	}
	service.hub.forgetCompleted("")
	service.batchHub.forgetCompleted("")
	return nil
}

func (service *Service) CancelGeneration(ctx context.Context, generationID string) (persistence.Generation, error) {
	service.activeMu.Lock()
	active := service.active[generationID]
	service.activeMu.Unlock()
	if active != nil {
		active.cancel()
		select {
		case <-active.done:
		case <-ctx.Done():
			return persistence.Generation{}, ctx.Err()
		}
	} else {
		service.secureMu.Lock()
		defer service.secureMu.Unlock()
		generation, err := service.store.GetGeneration(ctx, generationID)
		if err != nil {
			return persistence.Generation{}, err
		}
		if !isTerminal(generation.State) {
			if err := service.store.TerminateGeneration(ctx, persistence.TerminateGenerationInput{GenerationID: generationID, State: persistence.GenerationStopped, ErrorCode: "stopped", ErrorMessage: "Generation stopped."}); err != nil {
				return persistence.Generation{}, err
			}
			if generation.GenerationBatchID != "" {
				service.publishBatchTerminal(generation.GenerationBatchID, GenerationEvent{BatchID: generation.GenerationBatchID, TargetID: generation.GenerationTargetID, GenerationID: generation.ID, Type: EventStopped, ErrorCode: "stopped", ErrorMessage: "Generation stopped."})
			}
		}
		service.finishSecureGeneration(generationID)
	}
	return service.store.GetGeneration(ctx, generationID)
}

func (service *Service) MarkSecureGenerationVerifyingEnvironment(ctx context.Context, generationID string) (persistence.Generation, error) {
	service.secureMu.Lock()
	defer service.secureMu.Unlock()
	if err := service.store.MarkGenerationVerifyingEnvironment(ctx, generationID); err != nil {
		return persistence.Generation{}, err
	}
	generation, err := service.store.GetGeneration(ctx, generationID)
	if err == nil && !isTerminal(generation.State) {
		service.trackSecureGeneration(generationID)
	}
	return generation, err
}

func (service *Service) MarkSecureGenerationStreaming(ctx context.Context, generationID string) (persistence.Generation, error) {
	service.secureMu.Lock()
	defer service.secureMu.Unlock()
	if err := service.store.MarkGenerationStreaming(ctx, generationID); err != nil {
		return persistence.Generation{}, err
	}
	return service.store.GetGeneration(ctx, generationID)
}

func (service *Service) MarkSecureGenerationVerifyingResponse(ctx context.Context, generationID string) (persistence.Generation, error) {
	service.secureMu.Lock()
	defer service.secureMu.Unlock()
	if err := service.store.MarkGenerationVerifyingResponse(ctx, generationID); err != nil {
		return persistence.Generation{}, err
	}
	return service.store.GetGeneration(ctx, generationID)
}

func (service *Service) SettleSecureGeneration(ctx context.Context, input persistence.SecureGenerationSettlementInput) (persistence.Generation, error) {
	service.secureMu.Lock()
	defer service.secureMu.Unlock()
	return service.settleSecureGeneration(ctx, input)
}

// Caller holds secureMu so settlement, cancellation, and expiry emit one terminal result.
func (service *Service) settleSecureGeneration(ctx context.Context, input persistence.SecureGenerationSettlementInput) (persistence.Generation, error) {
	previous, err := service.store.GetGeneration(ctx, input.GenerationID)
	if err != nil {
		return persistence.Generation{}, err
	}
	if err := service.store.SettleSecureGeneration(ctx, input); err != nil {
		return persistence.Generation{}, err
	}
	service.finishSecureGeneration(input.GenerationID)
	generation, err := service.store.GetGeneration(ctx, input.GenerationID)
	if err == nil && !isTerminal(previous.State) && generation.GenerationBatchID != "" {
		eventType := EventCompleted
		if generation.State == persistence.GenerationFailed || generation.Verification.Status == persistence.VerificationUnsupported || generation.Verification.Status == persistence.VerificationFailed {
			eventType = EventFailed
		}
		service.publishBatchTerminal(generation.GenerationBatchID, GenerationEvent{BatchID: generation.GenerationBatchID, TargetID: generation.GenerationTargetID, GenerationID: generation.ID, Type: eventType, ErrorCode: generation.ErrorCode, ErrorMessage: generation.ErrorMessage})
	}
	return generation, err
}

func (service *Service) runGeneration(ctx context.Context, generation persistence.Generation, profile provider.Profile, secret credentials.Secret, configuration persistence.GenerationConfigurationSnapshot) {
	defer service.finishGeneration(generation.ID)
	measurement := generationMeasurement{started: time.Now()}
	view, err := service.store.LoadConversation(ctx, generation.ConversationID)
	if err != nil {
		service.terminate(generation.ID, persistence.GenerationFailed, "internal_error", "The conversation could not be loaded.")
		return
	}
	messages := make([]provider.ProviderMessage, 0, len(view.Messages)+1)
	if strings.TrimSpace(configuration.SystemPrompt) != "" {
		messages = append(messages, provider.ProviderMessage{Role: "system", Content: configuration.SystemPrompt})
	}
	for _, message := range view.Messages {
		messages = append(messages, provider.ProviderMessage{Role: message.Role, Content: message.Body})
	}
	if ctx.Err() != nil {
		service.terminateForContext(generation.ID, ctx)
		return
	}
	stream, err := service.provider.Stream(ctx, provider.CompletionInput{
		Profile: profile, Secret: secret, Messages: messages,
		GenerationParameters: providerGenerationParameters(configuration.GenerationParameters),
	})
	if err != nil {
		if ctx.Err() != nil {
			service.terminateForContext(generation.ID, ctx)
			return
		}
		service.terminate(generation.ID, persistence.GenerationFailed, providerErrorCode(err), "Provider could not start the generation.")
		return
	}
	defer stream.Close()
	var body, reasoning strings.Builder
	var finishReason string
	for {
		event, err := stream.Recv(ctx)
		if err != nil {
			if ctx.Err() != nil {
				service.terminateForContext(generation.ID, ctx)
				return
			}
			service.terminate(generation.ID, persistence.GenerationFailed, "protocol_error", "The Provider stream ended without completion.")
			return
		}
		if ctx.Err() != nil {
			service.terminateForContext(generation.ID, ctx)
			return
		}
		measurement.observe(event)
		switch event.Type {
		case provider.EventStarted:
			_ = service.store.MarkGenerationStreaming(context.Background(), generation.ID)
			service.publish(GenerationEvent{GenerationID: generation.ID, Type: EventStarted, Snapshot: &generation.Snapshot})
		case provider.EventDelta:
			if len(event.Delta)+len(event.ReasoningDelta) > provider.MaxCompletionBytes-body.Len()-reasoning.Len() {
				service.terminate(generation.ID, persistence.GenerationFailed, "protocol_error", "The Provider response exceeded the size limit.")
				return
			}
			body.WriteString(event.Delta)
			reasoning.WriteString(event.ReasoningDelta)
			if event.FinishReason != "" {
				finishReason = event.FinishReason
			}
			service.publish(GenerationEvent{GenerationID: generation.ID, Type: EventDelta, Delta: event.Delta, ReasoningDelta: event.ReasoningDelta})
		case provider.EventCompleted:
			if event.FinishReason != "" {
				finishReason = event.FinishReason
			}
			if strings.TrimSpace(body.String()) == "" {
				code, message := emptyProviderResponseFailure(finishReason)
				service.terminate(generation.ID, persistence.GenerationFailed, code, message)
				return
			}
			if !service.claimTerminal(generation.ID) {
				return
			}
			if err := service.store.CompleteGeneration(context.Background(), persistence.CompleteGenerationInput{GenerationID: generation.ID, Body: body.String(), Reasoning: reasoning.String(), Metrics: measurement.snapshot()}); err != nil {
				_ = service.store.TerminateGeneration(context.Background(), persistence.TerminateGenerationInput{GenerationID: generation.ID, State: persistence.GenerationFailed, ErrorCode: "internal_error", ErrorMessage: "The completed response could not be saved."})
				service.publish(GenerationEvent{GenerationID: generation.ID, Type: EventFailed, ErrorCode: "internal_error", ErrorMessage: "The completed response could not be saved."})
				return
			}
			service.publish(GenerationEvent{GenerationID: generation.ID, Type: EventCompleted})
			return
		case provider.EventStopped:
			service.terminate(generation.ID, persistence.GenerationStopped, "stopped", "Generation stopped.")
			return
		case provider.EventFailed:
			service.terminate(generation.ID, persistence.GenerationFailed, "provider_error", "The Provider rejected the generation request.")
			return
		default:
			service.terminate(generation.ID, persistence.GenerationFailed, "protocol_error", "The Provider returned an unknown event.")
			return
		}
	}
}

func (service *Service) terminate(id string, state persistence.GenerationState, code, message string) {
	if !service.claimTerminal(id) {
		return
	}
	_ = service.store.TerminateGeneration(context.Background(), persistence.TerminateGenerationInput{
		GenerationID: id, State: state, ErrorCode: code, ErrorMessage: message,
	})
	eventType := EventFailed
	if state == persistence.GenerationStopped {
		eventType = EventStopped
	}
	service.publish(GenerationEvent{GenerationID: id, Type: eventType, ErrorCode: code, ErrorMessage: message})
}

func (service *Service) claimTerminal(id string) bool {
	service.activeMu.Lock()
	active := service.active[id]
	service.activeMu.Unlock()
	if active == nil {
		return false
	}
	active.terminalMu.Lock()
	defer active.terminalMu.Unlock()
	if active.terminalSet {
		return false
	}
	active.terminalSet = true
	return true
}

func (service *Service) terminateForContext(id string, ctx context.Context) {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		service.terminate(id, persistence.GenerationFailed, "timeout", "The Generation timed out.")
		return
	}
	service.terminate(id, persistence.GenerationStopped, "stopped", "Generation stopped.")
}

func (service *Service) publish(event GenerationEvent) {
	event.EventID = fmt.Sprintf("%d", service.nextID.Add(1))
	service.hub.publish(event)
}

func providerErrorCode(err error) string {
	switch {
	case errors.Is(err, provider.ErrAuthenticationFailed):
		return "authentication_failed"
	case errors.Is(err, provider.ErrRateLimited):
		return "rate_limited"
	case errors.Is(err, provider.ErrProviderUnavailable):
		return "provider_unavailable"
	case errors.Is(err, provider.ErrProtocol):
		return "protocol_error"
	default:
		return "provider_error"
	}
}

type eventHub struct {
	mu      sync.Mutex
	streams map[string]*generationEvents
}

type generationEvents struct {
	replay
	subscribers map[chan GenerationEvent]struct{}
	terminal    bool
}

func newEventHub() *eventHub {
	return &eventHub{streams: make(map[string]*generationEvents)}
}

func (hub *eventHub) ensure(id string) {
	hub.forgetCompleted(id)
	hub.mu.Lock()
	defer hub.mu.Unlock()
	if hub.streams[id] == nil {
		hub.streams[id] = &generationEvents{subscribers: make(map[chan GenerationEvent]struct{})}
	}
}

func (hub *eventHub) forgetCompleted(keep string) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	for id, stream := range hub.streams {
		if id != keep && stream.terminal && len(stream.subscribers) == 0 {
			delete(hub.streams, id)
		}
	}
}

const (
	maxReplayEvents = 256
	maxReplayBytes  = 256 << 10
)

type replay struct {
	events []GenerationEvent
	bytes  int
}

func (buffer *replay) append(event GenerationEvent) {
	buffer.events = append(buffer.events, event)
	buffer.bytes += len(event.Delta) + len(event.ReasoningDelta)
	for len(buffer.events) > maxReplayEvents || buffer.bytes > maxReplayBytes {
		buffer.bytes -= len(buffer.events[0].Delta) + len(buffer.events[0].ReasoningDelta)
		buffer.events[0] = GenerationEvent{}
		buffer.events = buffer.events[1:]
	}
}

func (hub *eventHub) publish(event GenerationEvent) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	stream := hub.streams[event.GenerationID]
	if stream == nil {
		stream = &generationEvents{subscribers: make(map[chan GenerationEvent]struct{})}
		hub.streams[event.GenerationID] = stream
	}
	stream.replay.append(event)
	terminal := event.Type == EventCompleted || event.Type == EventStopped || event.Type == EventFailed
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

func (hub *eventHub) subscribe(ctx context.Context, id, afterID string, terminal bool) <-chan GenerationEvent {
	channel := make(chan GenerationEvent, maxReplayEvents)
	hub.mu.Lock()
	stream := hub.streams[id]
	if stream == nil {
		if terminal {
			hub.mu.Unlock()
			close(channel)
			return channel
		}
		stream = &generationEvents{subscribers: make(map[chan GenerationEvent]struct{})}
		hub.streams[id] = stream
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

func (hub *eventHub) removeSubscriber(ctx context.Context, stream *generationEvents, channel chan GenerationEvent) {
	<-ctx.Done()
	hub.mu.Lock()
	defer hub.mu.Unlock()
	if _, ok := stream.subscribers[channel]; ok {
		delete(stream.subscribers, channel)
		close(channel)
	}
}
