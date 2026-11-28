package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

// App tasks share model admission with conversations and debates. The instance
// owns the frozen input and candidate output, independent of chat history.
type AppTaskInput struct {
	// InstanceChanges protects the final grant check and worker registration
	// against instance revocation. Catalog discovery runs outside this lock.
	InstanceChanges                                                              sync.Locker
	BrowserOwner                                                                 string
	CandidateSchema                                                              json.RawMessage
	Instance, ID, Fingerprint, Request, Prompt, ProviderID, ModelID, Destination string
	LocalOnly                                                                    bool
	ProposalTools                                                                []provider.Tool
	ValidateProposal                                                             func(string) (string, error)
}
type AppTaskStore interface {
	FindAppTask(context.Context, string, string) (persistence.AppTask, bool, error)
	BeginAppTask(context.Context, string, string, string, string) error
	FinishAppTask(context.Context, string, string, string, string, string) error
}
type appTaskWorker struct {
	browser *browserAppTask
	pending *appTaskSettlement
	sync.Mutex
	instance, id string
	cancel       context.CancelFunc
	done         chan struct{}
}

var ErrAppTaskConflict = errors.New("the operation ID was used for a different model request")
var ErrAppBrowserModel = errors.New("this model requires a verified browser generation")
var ErrAppDestination = errors.New("the selected model destination has changed")

func (s *Service) StartAppTask(ctx context.Context, in AppTaskInput, authorize func() error) (persistence.AppTask, error) {
	store, ok := s.store.(AppTaskStore)
	if !ok || s.profiles == nil || s.provider == nil {
		return persistence.AppTask{}, errors.New("model tasks unavailable")
	}
	check := func() (persistence.AppTask, error) {
		if err := authorize(); err != nil {
			return persistence.AppTask{}, err
		}
		task, found, err := s.findProjectedAppTask(ctx, store, in.Instance, in.ID)
		if found && (task.Fingerprint != in.Fingerprint || task.State == "expired") {
			return persistence.AppTask{}, ErrAppTaskConflict
		}
		if found || err != nil {
			return task, err
		}
		if s.hasPendingAppTaskSave() {
			return persistence.AppTask{}, ErrAppTaskSavePending
		}
		if err := s.requireGenerationIdle(ctx); err != nil {
			return persistence.AppTask{}, err
		}
		// A worker may have finished while the shared idle check waited for its
		// lock. Its pending settlement is established before releasing that slot.
		if s.hasPendingAppTaskSave() {
			return persistence.AppTask{}, ErrAppTaskSavePending
		}
		return persistence.AppTask{}, nil
	}
	unlock := s.lockAppAdmission(in.InstanceChanges)
	existing, err := check()
	unlock()
	if err != nil || existing.ID != "" {
		return existing, err
	}
	if in.LocalOnly && (in.ProviderID != localmodels.ProviderID || !localmodels.IsChatModel(in.ModelID)) {
		return persistence.AppTask{}, ErrLocalOnly
	}

	c, resolveErr := s.resolveAppTarget(ctx, in)
	unlock = s.lockAppAdmission(in.InstanceChanges)
	defer unlock()
	if existing, err := check(); err != nil || existing.ID != "" {
		return existing, err
	}
	if resolveErr != nil {
		return persistence.AppTask{}, resolveErr
	}
	if c.profile.Kind == provider.KindNearAIPreset && (!c.isSecure() || in.BrowserOwner == "" || in.ValidateProposal != nil || len(in.ProposalTools) > 0) {
		return persistence.AppTask{}, ErrAppBrowserModel
	}
	if in.LocalOnly && c.profile.Kind != provider.KindLocal {
		return persistence.AppTask{}, ErrLocalOnly
	}
	if c.profile.Endpoint != in.Destination {
		return persistence.AppTask{}, ErrAppDestination
	}
	if err := s.checkResolvedProfile(ctx, c.profile); err != nil {
		return persistence.AppTask{}, err
	}
	params := persistence.GenerationParameters{}
	if s.settings != nil {
		prefs, err := s.settings.GetSettings(ctx)
		if err != nil {
			return persistence.AppTask{}, err
		}
		params.MaxTokens = prefs.GenerationParameters.MaxTokens
	}
	params = effectiveGenerationParameters(params, c.profile.Kind)
	if c.isSecure() {
		return s.beginBrowserAppTask(ctx, in, snapshotFor(c.profile, c.metadata.PrivacyMode), params.MaxTokens)
	}
	if err := store.BeginAppTask(ctx, in.Instance, in.ID, in.Fingerprint, in.Request); err != nil {
		return persistence.AppTask{}, err
	}
	run, cancel := context.WithTimeout(context.Background(), s.timeout)
	done := make(chan struct{})
	w := &s.appTask
	w.Lock()
	w.instance, w.id, w.cancel, w.done = in.Instance, in.ID, cancel, done
	w.Unlock()
	go func() {
		defer cancel()
		input := provider.CompletionInput{Profile: c.profile, Secret: c.secret, Messages: []provider.ProviderMessage{{Role: "user", Content: in.Prompt}}, GenerationParameters: providerGenerationParameters(params)}
		// Cove-managed workers and llama.cpp endpoints support constrained JSON decoding.
		if len(in.CandidateSchema) > 0 && (c.profile.Kind == provider.KindLocal || c.metadata.Owner == "llamacpp" || c.metadata.Owner == "llama.cpp") {
			input.StructuredOutput = &provider.StructuredOutput{Type: "json_schema", JSONSchema: provider.NamedOutputSchema{Name: "app_candidates", Schema: in.CandidateSchema}}
		}
		if slices.Contains(c.metadata.Capabilities, "tools") {
			input.Tools = in.ProposalTools
		}
		result, err := s.readAppCompletion(run, input)
		if err == nil && in.ValidateProposal != nil {
			result, err = in.ValidateProposal(result)
		}
		w.Lock()
		defer w.Unlock()
		state, detail := "completed", ""
		if run.Err() == context.Canceled {
			state, result = "cancelled", ""
		} else if err != nil || run.Err() != nil {
			state, result, detail = "failed", "", "The model task did not complete."
		}
		s.settleAppTaskLocked(store, appTaskSettlement{instance: in.Instance, id: in.ID, state: state, result: result, detail: detail})
		w.instance, w.id, w.cancel, w.done = "", "", nil, nil
		close(done)
	}()
	return persistence.AppTask{ID: in.ID, State: "running"}, nil
}

func (s *Service) lockAppAdmission(changes sync.Locker) func() {
	// Wait for any grant changes before entering Chat's shared start section.
	if changes != nil {
		changes.Lock()
	}
	s.startMu.Lock()
	return func() {
		s.startMu.Unlock()
		if changes != nil {
			changes.Unlock()
		}
	}
}

func (s *Service) readAppCompletion(ctx context.Context, input provider.CompletionInput) (string, error) {
	stream, err := s.provider.Stream(ctx, input)
	if err != nil {
		return "", err
	}
	defer stream.Close()
	return readAppStream(ctx, stream, len(input.Tools) > 0)
}

func readAppStream(ctx context.Context, stream provider.CompletionStream, allowTools bool) (string, error) {
	var out strings.Builder
	var calls provider.ToolCallAccumulator
	for {
		e, err := stream.Recv(ctx)
		if err != nil {
			return "", err
		}
		switch e.Type {
		case provider.EventDelta:
			if len(e.ToolCalls) > 0 {
				if !allowTools {
					return "", errors.New("unexpected model tool call")
				}
				if err := calls.Add(e.ToolCalls); err != nil {
					return "", err
				}
			}
			if e.Reset {
				out.Reset()
			}
			if out.Len()+len(e.Delta) > 128<<10 {
				return "", fmt.Errorf("app output exceeds limit")
			}
			out.WriteString(e.Delta)
		case provider.EventCompleted:
			pending, err := calls.Calls()
			if err != nil {
				return "", err
			}
			if len(pending) > 0 {
				if len(pending) != 1 {
					return "", errors.New("choose one action per proposal")
				}
				call := pending[0].Function
				body, err := json.Marshal(struct {
					Action string          `json:"action"`
					Inputs json.RawMessage `json:"inputs"`
				}{call.Name, json.RawMessage(call.Arguments)})
				return string(body), err
			}
			if strings.TrimSpace(out.String()) == "" {
				return "", errors.New("empty model output")
			}
			return out.String(), nil
		case provider.EventFailed, provider.EventStopped:
			return "", errors.New("model stopped")
		}
	}
}

func (s *Service) appTaskBusy() bool {
	s.appTask.Lock()
	defer s.appTask.Unlock()
	return s.appTask.cancel != nil
}

// Empty filters are used at shutdown. Cancellation completes before resources are released.
func (s *Service) StopAppTask(instance, id string) {
	w := &s.appTask
	w.Lock()
	if w.cancel == nil || (instance != "" && instance != w.instance) || (id != "" && id != w.id) {
		w.Unlock()
		s.flushPendingAppTaskOnStop(instance, id)
		return
	}
	w.cancel()
	done := w.done
	w.Unlock()
	<-done
	s.flushPendingAppTaskOnStop(instance, id)
}
