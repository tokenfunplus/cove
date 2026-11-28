package chat

import (
	"context"
	"errors"
	"fmt"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"strings"
	"testing"
)

func TestProviderReferencesHideLocalIdentifiers(t *testing.T) {
	const header = "Reference from Book (review.listDue)\ncove://open/772ac99e-44bc-49e3-b79b-987a471875b2/home\n"
	old := header + "[\n  {\"id\":\"local-record-id\",\"revision\":2,\"fields\":{\"question\":\"Review this?\"}}\n]"
	next := header + "Selected app records (reference data):\n[\n  {\"question\":\"Other question?\"}\n]"
	body := modelAppReferences("Please practice.\n\n" + old + "\n\n" + next + "\nThen explain.")
	for _, v := range []string{"cove://", "local-record-id", "revision"} {
		if strings.Contains(body, v) {
			t.Fatal(body)
		}
	}
	for _, v := range []string{"Review this?", "Other question?", "Then explain."} {
		if !strings.Contains(body, v) {
			t.Fatal(body)
		}
	}
	if strings.Count(body, "reference data") != 2 {
		t.Fatal(body)
	}
}

type turnSource struct {
	denied bool
}

func (source turnSource) AppName(context.Context, string) string { return "Reading list" }
func (source turnSource) ChatActions(_ context.Context, scope persistence.MiniAppScope) (AppActions, error) {
	if source.denied {
		return AppActions{}, ErrAppTurnUnavailable
	}
	return AppActions{Tools: []provider.Tool{{Type: "function", Function: provider.ToolFunction{Name: "choice_1", Description: "List reading"}}}, Normalize: func(body string) (string, error) {
		if strings.TrimSpace(body) != `{"action":"choice_1","inputs":{}}` {
			return "", errors.New("invalid tool")
		}
		return `{"action":"inbox.list","inputs":{}}`, nil
	}}, nil
}

func TestScopedTurnReceivesOneNativeOrTextProposal(t *testing.T) {
	for _, native := range []bool{true, false} {
		t.Run(fmt.Sprint(native), func(t *testing.T) {
			delta := provider.Event{Type: provider.EventDelta, Delta: `{"action":"choice_1","inputs":{}}`}
			if native {
				call := provider.ToolCallDelta{Index: 0}
				call.ID = "call"
				call.Type = "function"
				call.Function.Name = "choice_1"
				call.Function.Arguments = "{}"
				delta = provider.Event{Type: provider.EventDelta, ToolCalls: []provider.ToolCallDelta{call}}
			}
			upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{delta, {Type: provider.EventCompleted}}}}
			service := &Service{provider: upstream, appActions: turnSource{}}
			scope := persistence.MiniAppScope{Instance: "local-instance", Actions: []string{"inbox.list"}}
			stream, err := service.openAppTurn(t.Context(), provider.CompletionInput{Messages: []provider.ProviderMessage{{Role: "user", Content: "Show my reading list"}}}, scope, native)
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			for _, kind := range []provider.EventType{provider.EventStarted, provider.EventDelta, provider.EventCompleted} {
				e, err := stream.Recv(t.Context())
				if err != nil || e.Type != kind || kind == provider.EventDelta && e.Delta != `{"action":"inbox.list","inputs":{}}` {
					t.Fatal(e, err)
				}
			}
			if (len(upstream.input.Tools) == 1) != native || strings.Contains(upstream.input.Messages[0].Content, scope.Instance) {
				t.Fatal("unexpected model scope")
			}
			service.appActions = turnSource{denied: true}
			if _, err := service.openAppTurn(t.Context(), provider.CompletionInput{}, scope, native); err == nil || upstream.calls != 1 {
				t.Fatal("stale scope reached the provider", err)
			}
		})
	}
}

func TestScopedTurnRejectsTruncatedLabeledProposals(t *testing.T) {
	for _, body := range []string{
		`Proposed action: {"action":"choice_1"`,
		"Suggested: ```json\n{\"action\":\"choice_1\"",
		`Suggestion: {"action":"choice_1"`,
	} {
		stream := &appTurnStream{CompletionStream: &fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: body}, {Type: provider.EventCompleted}}}, normalize: func(string) (string, error) {
			return "", ErrAppProposalInvalid
		}}
		if _, err := stream.Recv(t.Context()); err != nil {
			t.Fatal(err)
		}
		if _, err := stream.Recv(t.Context()); !errors.Is(err, ErrAppProposalInvalid) {
			t.Fatal("truncated labeled proposal appeared as a successful answer", body, err)
		}
	}
	for _, body := range []string{`{"example":"An unrelated object"}`, `{"action":"a JSON example"`, "An ordinary answer.", "Suggestion: Try a shorter reading session.", "Suggested: Keep an ordinary note."} {
		if appProposalReply(body) {
			t.Fatal("unlabeled unrelated content was classified as a proposal", body)
		}
	}
}

func TestScopedTurnRequiresOneCompatibleModel(t *testing.T) {
	ctx := t.Context()
	scope := &persistence.MiniAppScope{Instance: "book", Release: "release", Revision: 1, Actions: []string{"inbox.list"}}
	secure, store, c := secureWatchdogFixture(t)
	secure.SetAppActions(turnSource{})
	started, err := secure.StartGenerationBatch(ctx, SendInput{ConversationID: c.ID, ClientRequestID: "scoped-private", ProviderID: "nearai", ModelID: "model-a", Body: "List articles", MiniApp: scope})
	if err != nil {
		t.Fatal(err)
	}
	id := started.Batch.Targets[0].Generation.ID
	preflight, err := secure.BrowserAppTurn(ctx, id)
	if err != nil || !strings.Contains(preflight.Instructions, "choice_1") || preflight.Message != "List articles" || len(preflight.Proposal) != 0 {
		t.Fatal(preflight, err)
	}
	prepareSecureResponse(t, secure, id)
	receipt := verifiedSettlement(id)
	receipt.Body = " \n" + `{"action":"choice_1","inputs":{}}` + "\n "
	receipt.Verification.SignedMessage = "original-signed-envelope"
	receipt.Verification.Signature = "original-signature"
	if _, err := secure.SettleSecureGeneration(ctx, receipt); err != nil {
		t.Fatal(err)
	}
	projection, err := secure.BrowserAppTurn(ctx, id)
	if err != nil || string(projection.Proposal) != `{"action":"inbox.list","inputs":{}}` {
		t.Fatal(projection, err)
	}
	v, err := store.LoadConversation(ctx, c.ID)
	if err != nil || len(v.Messages) != 2 || v.Messages[1].Body != receipt.Body {
		t.Fatal("changed original verified response", err)
	}
	g, err := store.GetGeneration(ctx, id)
	if err != nil || g.Verification.Signature != receipt.Verification.Signature || g.Verification.SignedMessage != receipt.Verification.SignedMessage {
		t.Fatal("changed receipt", err)
	}
	secure.SetAppActions(turnSource{denied: true})
	if _, err := secure.BrowserAppTurn(ctx, id); !errors.Is(err, ErrAppTurnUnavailable) {
		t.Fatal("revoked scope yielded a usable proposal", err)
	}
	p := testProfile()
	settings := persistence.Settings{Theme: "system", Locale: "en", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: p.ID, ModelID: p.Model}, {ProviderID: p.ID, ModelID: "second"}}}
	if err := store.UpdateSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	upstream := &fakeProvider{}
	ordinary := NewServiceWithSettings(store, fakeProviderSource{profile: p}, upstream, store)
	ordinary.SetAppActions(turnSource{})
	if _, err := ordinary.StartGenerationBatch(ctx, SendInput{ConversationID: c.ID, ClientRequestID: "scoped-comparison", Body: "List articles", MiniApp: scope}); !errors.Is(err, ErrAppTurnUnavailable) {
		t.Fatal(err)
	}
	if upstream.calls != 0 {
		t.Fatal("unexpected proposal request")
	}
}

func TestFailedSecureScopeHasNoExecutableProjection(t *testing.T) {
	s, _, conversation := secureWatchdogFixture(t)
	s.SetAppActions(turnSource{})
	b, err := s.StartGenerationBatch(t.Context(), SendInput{ConversationID: conversation.ID, ClientRequestID: "failed-private", ProviderID: "nearai", ModelID: "model-a", Body: "Read my list", MiniApp: &persistence.MiniAppScope{Instance: "book", Release: "release", Revision: 1, Actions: []string{"inbox.list"}}})
	if err != nil {
		t.Fatal(err)
	}
	id := b.Batch.Targets[0].Generation.ID
	prepareSecureResponse(t, s, id)
	receipt := persistence.SecureGenerationSettlementInput{GenerationID: id, Body: `{"action":"choice_1","inputs":{}}`, Verification: persistence.GenerationVerification{Status: persistence.VerificationFailed, FailureCode: "response_verification_failed", EvidenceSummary: "Fixture signature mismatch"}}
	if _, err := s.SettleSecureGeneration(t.Context(), receipt); err != nil {
		t.Fatal(err)
	}
	if projection, err := s.BrowserAppTurn(t.Context(), id); !errors.Is(err, ErrAppTurnUnavailable) || len(projection.Proposal) != 0 {
		t.Fatal(projection, err)
	}
}

func TestScopedTurnCanAnswerNormallyAndPreservesUsageAndReasoning(t *testing.T) {
	for _, body := range []string{"You can ask me about this book.", `{"title":"A JSON example","value":3}`, `{"inputs":{"text":"An ordinary API example"}}`, `This format example contains {"action":"choice_1","inputs":{}} in explanatory text.`} {
		input, output := int64(12), int64(8)
		upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: body, ReasoningDelta: "Short reasoning"}, {Type: provider.EventCompleted, Usage: &provider.TokenUsage{InputTokens: &input, OutputTokens: &output}, FinishReason: "stop"}}}}
		service := &Service{provider: upstream, appActions: turnSource{}}
		stream, err := service.openAppTurn(t.Context(), provider.CompletionInput{}, persistence.MiniAppScope{}, false)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = stream.Recv(t.Context())
		delta, err := stream.Recv(t.Context())
		if err != nil || delta.Delta != body || delta.ReasoningDelta != "Short reasoning" {
			t.Fatal(delta, err)
		}
		done, err := stream.Recv(t.Context())
		if err != nil || done.Usage == nil || *done.Usage.InputTokens != 12 || done.FinishReason != "stop" {
			t.Fatal(done, err)
		}
	}
}

func TestScopedTurnInvalidExplicitProposalHasAnAppError(t *testing.T) {
	for _, body := range []string{`{"action":"unknown","inputs":{}}`, `{"action":"choice_1","inputs":`} {
		upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: body}, {Type: provider.EventCompleted}}}}
		service := &Service{provider: upstream, appActions: turnSource{}}
		stream, err := service.openAppTurn(t.Context(), provider.CompletionInput{}, persistence.MiniAppScope{}, false)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = stream.Recv(t.Context())
		if _, err := stream.Recv(t.Context()); !errors.Is(err, ErrAppProposalInvalid) {
			t.Fatal(err)
		}
	}
}
