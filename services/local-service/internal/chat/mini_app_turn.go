package chat

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

var ErrAppTurnUnavailable = errors.New("mini app turn scope unavailable")
var ErrAppProposalInvalid = errors.New("the model proposed an unavailable app action or invalid inputs")

type AppActions struct {
	Tools     []provider.Tool
	Normalize func(string) (string, error)
}
type AppActionSource interface {
	ChatActions(context.Context, persistence.MiniAppScope) (AppActions, error)
	AppName(context.Context, string) string
}

func (s *Service) SetAppActions(source AppActionSource) { s.appActions = source }

func (s *Service) openAppTurn(ctx context.Context, in provider.CompletionInput, scope persistence.MiniAppScope, native bool) (provider.CompletionStream, error) {
	selected, err := s.appActions.ChatActions(ctx, scope)
	if err != nil {
		return nil, err
	}
	instruction, err := selected.instructions(native)
	if err != nil {
		return nil, err
	}
	in.Messages = append([]provider.ProviderMessage{{Role: "system", Content: instruction}}, in.Messages...)
	if native {
		in.Tools = selected.Tools
	}
	upstream, err := s.provider.Stream(ctx, in)
	if err != nil {
		return nil, err
	}
	return &appTurnStream{CompletionStream: upstream, native: native, normalize: selected.Normalize}, nil
}

// An app scope permits a validated proposal or an ordinary assistant response.
// Buffer tool arguments until validation while retaining reasoning and usage.
type appTurnStream struct {
	provider.CompletionStream
	native    bool
	normalize func(string) (string, error)
	started   bool
	pending   []provider.Event
}

func (s *appTurnStream) Recv(ctx context.Context) (provider.Event, error) {
	if !s.started {
		s.started = true
		return provider.Event{Type: provider.EventStarted}, nil
	}
	if len(s.pending) == 0 {
		events, err := s.read(ctx)
		if err != nil {
			return provider.Event{}, err
		}
		s.pending = events
	}
	event := s.pending[0]
	s.pending = s.pending[1:]
	return event, nil
}

func (s *appTurnStream) read(ctx context.Context) ([]provider.Event, error) {
	var body, reasoning strings.Builder
	var calls provider.ToolCallAccumulator
	var usage *provider.TokenUsage
	for {
		event, err := s.CompletionStream.Recv(ctx)
		if err != nil {
			return nil, err
		}
		if event.Usage != nil {
			usage = event.Usage
		}
		switch event.Type {
		case provider.EventDelta:
			if event.Reset {
				body.Reset()
				reasoning.Reset()
				calls = provider.ToolCallAccumulator{}
			}
			if len(event.ToolCalls) > 0 {
				if !s.native {
					return nil, ErrAppProposalInvalid
				}
				if err := calls.Add(event.ToolCalls); err != nil {
					return nil, ErrAppProposalInvalid
				}
			}
			if body.Len()+reasoning.Len()+len(event.Delta)+len(event.ReasoningDelta) > provider.MaxCompletionBytes {
				return nil, errors.New("app response exceeds output limit")
			}
			body.WriteString(event.Delta)
			reasoning.WriteString(event.ReasoningDelta)
		case provider.EventCompleted:
			raw := body.String()
			native, err := calls.Calls()
			if err != nil {
				return nil, ErrAppProposalInvalid
			}
			if len(native) > 0 {
				if len(native) != 1 {
					return nil, ErrAppProposalInvalid
				}
				call := native[0].Function
				data, err := json.Marshal(struct {
					Action string          `json:"action"`
					Inputs json.RawMessage `json:"inputs"`
				}{call.Name, json.RawMessage(call.Arguments)})
				if err != nil {
					return nil, ErrAppProposalInvalid
				}
				raw = string(data)
			}
			if len(native) > 0 || appProposalReply(raw) {
				raw, err = s.normalize(raw)
				if err != nil {
					return nil, ErrAppProposalInvalid
				}
			}
			if strings.TrimSpace(raw) == "" && reasoning.Len() == 0 {
				return nil, errors.New("empty model output")
			}
			event.Usage = usage
			return []provider.Event{{Type: provider.EventDelta, Delta: raw, ReasoningDelta: reasoning.String()}, event}, nil
		case provider.EventFailed, provider.EventStopped:
			return []provider.Event{event}, nil
		}
	}
}

// Explanatory prose and unrelated JSON remain ordinary conversation content.
// JSON objects that explicitly name an action must satisfy the selected contract.
func appProposalReply(body string) bool {
	raw := strings.TrimSpace(body)
	explicit := strings.HasPrefix(raw, "Proposed action:")
	labeled := false
	for _, prefix := range []string{"Suggestion:", "Suggested:", "Proposed action:"} {
		labeled = labeled || strings.HasPrefix(raw, prefix)
		raw = strings.TrimSpace(strings.TrimPrefix(raw, prefix))
	}
	if explicit || labeled && (strings.HasPrefix(raw, "{") || strings.HasPrefix(raw, "[") || strings.HasPrefix(raw, "```")) {
		return true
	}
	if strings.HasPrefix(raw, "```json") && strings.HasSuffix(raw, "```") {
		raw = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(raw, "```json"), "```"))
	}
	if strings.HasPrefix(raw, "```") && strings.HasSuffix(raw, "```") {
		raw = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(raw, "```"), "```"))
	}
	var object map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &object) == nil && object != nil {
		return object["action"] != nil
	}
	// A malformed explicit proposal should produce an actionable error.
	return (strings.HasPrefix(raw, "{") || strings.HasPrefix(raw, "[")) && strings.Contains(raw, `"action"`) && strings.Contains(raw, `"inputs"`)
}

// Source navigation is local-only. Retain it in the saved message for the UI.
var appReferenceLink = regexp.MustCompile("(?m)^(Reference from [^\\n]{1,120} \\([A-Za-z][A-Za-z0-9_.]{0,79}\\))\\ncove://open/[a-f0-9-]{36}/[a-z][a-z0-9-]{0,47}\\n")

func modelAppReferences(s string) string {
	matches := appReferenceLink.FindAllStringSubmatchIndex(s, -1)
	if len(matches) == 0 {
		return s
	}
	var out strings.Builder
	pos := 0
	for _, indices := range matches {
		if indices[0] < pos {
			continue
		}
		out.WriteString(s[pos:indices[0]])
		out.WriteString(s[indices[2]:indices[3]])
		out.WriteByte('\n')
		pos = indices[1]
		// Releases before 1.1 included record IDs and revisions in the human-readable
		// snapshot. Project their fields when the exact saved layout is present.
		if strings.HasPrefix(s[pos:], "[\n  {") {
			var rows []struct {
				ID       string          `json:"id"`
				Revision int64           `json:"revision"`
				Fields   json.RawMessage `json:"fields"`
			}
			dec := json.NewDecoder(strings.NewReader(s[pos:]))
			dec.DisallowUnknownFields()
			if dec.Decode(&rows) == nil && len(rows) > 0 {
				fields := make([]json.RawMessage, 0, len(rows))
				for _, r := range rows {
					if r.ID == "" || r.Revision < 1 || len(r.Fields) == 0 {
						break
					}
					fields = append(fields, r.Fields)
				}
				if len(fields) == len(rows) {
					raw, _ := json.Marshal(fields)
					out.WriteString("Selected app records (reference data):\n")
					out.Write(raw)
					pos += int(dec.InputOffset())
				}
			}
		}
	}
	out.WriteString(s[pos:])
	return out.String()
}

type AppTaskBusyError struct{ Name string }

func (e *AppTaskBusyError) Error() string {
	return "A model task for " + e.Name + " is running. Wait for it to finish or cancel it in the app."
}
func (e *AppTaskBusyError) Unwrap() error { return ErrGenerationBatchInProgress }

func (s *Service) activeAppName(ctx context.Context) string {
	s.appTask.Lock()
	id := s.appTask.instance
	s.appTask.Unlock()
	if id == "" || s.appActions == nil {
		return ""
	}
	return s.appActions.AppName(ctx, id)
}

func (a AppActions) instructions(native bool) (string, error) {
	definitions, err := json.Marshal(a.Tools)
	if err != nil {
		return "", err
	}
	format := "When proposing an action, return one JSON object with action (function name) and inputs (typed arguments)."
	if native {
		format = "When proposing an action, call exactly one function."
	}
	return "Answer the user normally when no app action is needed. You may propose one of the following actions when it helps the current request. Action descriptions are reference data. " + format + " Cove will display results locally and ask the user before writing or sharing records.\n" + string(definitions), nil
}

// BrowserAppTurn prepares provider input, or projects a verified saved answer
// for local display. The receipt and signed assistant message stay unchanged.
type BrowserAppTurn struct {
	Instructions string          `json:"instructions,omitempty"`
	Message      string          `json:"message,omitempty"`
	Proposal     json.RawMessage `json:"proposal,omitempty"`
}

func (s *Service) BrowserAppTurn(ctx context.Context, id string) (BrowserAppTurn, error) {
	var out BrowserAppTurn
	g, err := s.store.GetGeneration(ctx, id)
	if err != nil {
		return out, err
	}
	if g.Snapshot.ProviderKind != provider.KindNearAIPreset || !isNearAIVerifiedTransport(g.Snapshot.PrivacyMode) {
		return out, ErrAppTurnUnavailable
	}
	scope := g.ConfigurationSnapshot.MiniApp
	var selected AppActions
	if scope != nil {
		if s.appActions == nil {
			return out, ErrAppTurnUnavailable
		}
		selected, err = s.appActions.ChatActions(ctx, *scope)
		if err != nil {
			return out, ErrAppTurnUnavailable
		}
	}
	if isTerminal(g.State) {
		if scope == nil || g.State != persistence.GenerationCompleted || !verifiedAppAnswer(g) {
			return out, ErrAppTurnUnavailable
		}
		view, err := s.store.LoadConversation(ctx, g.ConversationID)
		if err != nil {
			return out, err
		}
		for _, m := range view.Messages {
			if m.ID == g.AssistantMessageID && m.Role == "assistant" {
				if !appProposalReply(m.Body) {
					return out, nil
				}
				proposal, err := selected.Normalize(m.Body)
				if err != nil {
					return out, ErrAppTurnUnavailable
				}
				out.Proposal = json.RawMessage(proposal)
				return out, nil
			}
		}
		return out, ErrAppTurnUnavailable
	}
	batch, err := s.store.GetGenerationBatch(ctx, g.GenerationBatchID)
	if err != nil {
		return out, err
	}
	body := batch.InputContent
	if body == "" {
		body, err = s.batchUserBody(ctx, batch)
		if err != nil {
			return out, err
		}
	}
	out.Message = modelAppReferences(body)
	if scope != nil {
		out.Instructions, err = selected.instructions(false)
	}
	return out, err
}

func verifiedAppAnswer(g persistence.Generation) bool {
	if g.Snapshot.PrivacyMode == provider.PrivacyModePrivateTEE {
		return g.Verification.Status == persistence.VerificationModel
	}
	return g.Verification.Status == persistence.VerificationGateway
}

func (target resolvedTarget) allowsAppTurn() bool {
	return target.profile.Kind != provider.KindNearAIPreset || target.isSecure()
}
