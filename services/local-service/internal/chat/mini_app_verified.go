package chat

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type browserAppStore interface {
	AppTaskStore
	BeginBrowserAppTask(context.Context, string, string, string, string, persistence.ProviderSnapshot) error
	FinishBrowserAppTask(context.Context, string, string, string, string, string, persistence.GenerationVerification, string) error
	AppBrowserSettlement(context.Context, string, string, string) (bool, error)
}
type browserAppTask struct {
	maxTokens                   *int
	ctx                         context.Context
	owner, claim, phase, prompt string
	snapshot                    persistence.ProviderSnapshot
}

var ErrAppVerification = errors.New("invalid Mini App browser verification")

type BrowserAppContext struct {
	MaxTokens *int                         `json:"max_tokens"`
	Snapshot  persistence.ProviderSnapshot `json:"snapshot"`
	Prompt    string                       `json:"prompt"`
}

func (s *Service) beginBrowserAppTask(ctx context.Context, in AppTaskInput, snapshot persistence.ProviderSnapshot, maxTokens *int) (persistence.AppTask, error) {
	store, ok := s.store.(browserAppStore)
	if !ok {
		return persistence.AppTask{}, ErrAppBrowserModel
	}
	if err := store.BeginBrowserAppTask(ctx, in.Instance, in.ID, in.Fingerprint, in.Request, snapshot); err != nil {
		return persistence.AppTask{}, err
	}
	run, cancel := context.WithTimeout(context.Background(), s.secureTimeout)
	browser := &browserAppTask{maxTokens: maxTokens, ctx: run, owner: in.BrowserOwner, snapshot: snapshot, prompt: in.Prompt}
	done := make(chan struct{})
	w := &s.appTask
	w.Lock()
	w.instance, w.id, w.cancel, w.done, w.browser = in.Instance, in.ID, cancel, done, browser
	w.Unlock()
	go func() {
		<-run.Done()
		w.Lock()
		defer w.Unlock()
		if w.browser != browser {
			return
		} // accepted settlement already closed the slot
		state, detail := "cancelled", ""
		if errors.Is(run.Err(), context.DeadlineExceeded) {
			state, detail = "failed", "The browser did not complete verification before the task expired."
		}
		s.settleAppTaskLocked(store, appTaskSettlement{instance: in.Instance, id: in.ID, state: state, detail: detail})
		w.releaseBrowser()
	}()
	return persistence.AppTask{ID: in.ID, State: "running", Browser: true, Snapshot: &snapshot}, nil
}

// Caller holds the worker lock. A closed claim is never eligible for another provider call.
func (w *appTaskWorker) releaseBrowser() {
	w.cancel()
	close(w.done)
	w.instance, w.id, w.cancel, w.done, w.browser = "", "", nil, nil, nil
}
func (w *appTaskWorker) ownedBrowser(instance, id, owner string) (*browserAppTask, error) {
	b := w.browser
	if b == nil || w.instance != instance || w.id != id || b.ctx.Err() != nil || b.owner == "" || b.owner != owner {
		return nil, ErrAppTaskConflict
	}
	return b, nil
}
func (s *Service) ClaimAppBrowser(instance, id, owner, claim string) (BrowserAppContext, error) {
	if _, err := uuid.Parse(claim); err != nil {
		return BrowserAppContext{}, ErrAppVerification
	}
	w := &s.appTask
	w.Lock()
	defer w.Unlock()
	b, err := w.ownedBrowser(instance, id, owner)
	if err != nil {
		return BrowserAppContext{}, err
	}
	if b.claim != "" {
		return BrowserAppContext{}, ErrAppTaskConflict
	}
	b.claim = claim
	return BrowserAppContext{Snapshot: b.snapshot, Prompt: b.prompt, MaxTokens: b.maxTokens}, nil
}
func (s *Service) ProgressAppBrowser(instance, id, owner, claim, phase string) error {
	w := &s.appTask
	w.Lock()
	defer w.Unlock()
	b, err := w.ownedBrowser(instance, id, owner)
	if err != nil {
		return err
	}
	if claim == "" || claim != b.claim {
		return ErrAppTaskConflict
	}
	if debateBrowserPhase(phase) == 0 || debateBrowserPhase(phase) < debateBrowserPhase(b.phase) {
		return ErrAppVerification
	}
	b.phase = phase
	return nil
}
func appBrowserReceipt(instance, id, owner string, input DebateBrowserResult) (string, error) {
	encoded, err := json.Marshal(input)
	if err != nil {
		return "", ErrAppVerification
	}
	sum := sha256.Sum256(append([]byte(instance+"/"+id+"/"+owner+"/"), encoded...))
	return hex.EncodeToString(sum[:]), nil
}

// Acknowledgement reads only an exact, already committed receipt. It cannot
// restore a grant, accept new output, or start browser work after revocation.
func (s *Service) AcknowledgeAppBrowserSettlement(ctx context.Context, instance, id, owner string, input DebateBrowserResult) (bool, error) {
	store, ok := s.store.(browserAppStore)
	if !ok {
		return false, ErrAppBrowserModel
	}
	receipt, err := appBrowserReceipt(instance, id, owner, input)
	if err != nil {
		return false, err
	}
	return store.AppBrowserSettlement(ctx, instance, id, receipt)
}

func (s *Service) SettleAppBrowser(ctx context.Context, instance, id, owner string, input DebateBrowserResult) error {
	w := &s.appTask
	w.Lock()
	defer w.Unlock()
	receipt, err := appBrowserReceipt(instance, id, owner, input)
	if err != nil {
		return err
	}
	accepted, err := s.store.(browserAppStore).AppBrowserSettlement(ctx, instance, id, receipt)
	if err != nil {
		return err
	}
	if accepted {
		// A previous update may have committed before its caller lost the response.
		if w.browser != nil && w.instance == instance && w.id == id {
			w.releaseBrowser()
		}
		return nil
	}
	if pending := w.pending; pending != nil && pending.instance == instance && pending.id == id && pending.receipt == receipt {
		return ErrAppTaskSavePending
	}
	b, err := w.ownedBrowser(instance, id, owner)
	if err != nil {
		return err
	}
	if input.ClaimID == "" || input.ClaimID != b.claim {
		return ErrAppTaskConflict
	}
	if len(input.Body) > 128<<10 || input.Reasoning != "" || persistence.ValidateBrowserSettlement(persistence.SecureGenerationSettlementInput{Body: input.Body, Verification: input.Verification}) != nil {
		return ErrAppVerification
	}
	v := input.Verification
	state, body, detail := "failed", "", "Browser verification did not complete."
	if v.Status == persistence.VerificationGateway || v.Status == persistence.VerificationModel {
		private := b.snapshot.PrivacyMode == provider.PrivacyModePrivateTEE
		if b.phase != "verifying_response" || private != (v.Status == persistence.VerificationModel) {
			return ErrAppVerification
		}
		now := time.Now().UTC()
		v.VerifiedAt = &now
		state, body, detail = "completed", input.Body, ""
	}
	if err = s.settleAppTaskLocked(s.store.(browserAppStore), appTaskSettlement{instance: instance, id: id, state: state, result: body, detail: detail, verification: &v, receipt: receipt}); err != nil {
		w.releaseBrowser()
		return ErrAppTaskSavePending
	}
	w.releaseBrowser()
	return nil
}
