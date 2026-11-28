package chat

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func appBrowserFixture(t *testing.T, mode string) (*Service, *persistence.SQLiteStore, *debateTestProvider, AppTaskInput) {
	t.Helper()
	s, store, upstream := browserDebateFixture(t, mode)
	err := store.MiniAppTransaction(t.Context(), func(tx *persistence.MiniAppStore) error {
		if err := tx.AddRelease(persistence.AppRelease{ID: "release", Origin: "local", Manifest: []byte("{}")}); err != nil {
			return err
		}
		return tx.SaveInstance(persistence.AppInstance{ID: "book", Name: "Book", ReleaseID: "release", Revision: 1, Enabled: true, Grants: []byte("[]")})
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.StopAppTask("", "") })
	in := AppTaskInput{Instance: "book", ID: uuid.NewString(), BrowserOwner: "starting-session", Fingerprint: "frozen", Request: "{}", Prompt: "Frozen source text",
		ProviderID: "fixture", ModelID: "model-a", Destination: "https://cloud-api.near.ai"}
	return s, store, upstream, in
}
func TestVerifiedAppTaskExclusiveClaimReceiptAndNoPlaintextFallback(t *testing.T) {
	for _, mode := range []string{provider.PrivacyModePrivateTEE, provider.PrivacyModeIncognito} {
		t.Run(mode, func(t *testing.T) {
			s, store, upstream, in := appBrowserFixture(t, mode)
			ctx := t.Context()
			start, err := s.StartAppTask(ctx, in, func() error { return nil })
			if err != nil || !start.Browser || start.State != "running" || !s.appTaskBusy() {
				t.Fatal(start, err)
			}
			claim := uuid.NewString()
			if _, err := s.ClaimAppBrowser(in.Instance, in.ID, "other-session", claim); !errors.Is(err, ErrAppTaskConflict) {
				t.Fatal(err)
			}
			payload, err := s.ClaimAppBrowser(in.Instance, in.ID, in.BrowserOwner, claim)
			if err != nil || payload.Prompt != in.Prompt || payload.Snapshot.PrivacyMode != mode || payload.Snapshot.ModelID != in.ModelID {
				t.Fatal(payload, err)
			}
			if _, err := s.ClaimAppBrowser(in.Instance, in.ID, in.BrowserOwner, claim); !errors.Is(err, ErrAppTaskConflict) {
				t.Fatal(err)
			}
			result := DebateBrowserResult{ClaimID: claim, Body: "Candidate", Verification: verifiedSettlement("").Verification}
			if err := s.SettleAppBrowser(ctx, in.Instance, in.ID, in.BrowserOwner, result); !errors.Is(err, ErrAppVerification) {
				t.Fatal(err)
			}
			if err := s.ProgressAppBrowser(in.Instance, in.ID, in.BrowserOwner, claim, "verifying_response"); err != nil {
				t.Fatal(err)
			}
			if mode == provider.PrivacyModeIncognito {
				if err := s.SettleAppBrowser(ctx, in.Instance, in.ID, in.BrowserOwner, result); !errors.Is(err, ErrAppVerification) {
					t.Fatal("wrong verification kind", err)
				}
				result.Verification.Status = persistence.VerificationGateway
				result.Verification.SignatureKind = "gateway"
			}
			if err := s.SettleAppBrowser(ctx, in.Instance, in.ID, "wrong", result); !errors.Is(err, ErrAppTaskConflict) {
				t.Fatal(err)
			}
			if err := s.SettleAppBrowser(ctx, in.Instance, in.ID, in.BrowserOwner, result); err != nil {
				t.Fatal(err)
			}
			job, err := store.AppTask(ctx, in.Instance, in.ID)
			if err != nil || job.State != "completed" || job.Result != result.Body || job.Verification == nil || job.Verification.CompletionID != result.Verification.CompletionID || s.appTaskBusy() {
				t.Fatal(job, err)
			}
			if upstream.calls() != 0 {
				t.Fatal("verified request used ordinary provider")
			}
			if err := s.SettleAppBrowser(ctx, in.Instance, in.ID, in.BrowserOwner, result); err != nil {
				t.Fatal("identical settlement retry failed", err)
			}
			reopened := NewService(store, nil, nil)
			if err := reopened.SettleAppBrowser(ctx, in.Instance, in.ID, in.BrowserOwner, result); err != nil {
				t.Fatal("durable settlement receipt was lost", err)
			}
			if err := s.SettleAppBrowser(ctx, in.Instance, in.ID, "other-session", result); !errors.Is(err, ErrAppTaskConflict) {
				t.Fatal("accepted another session", err)
			}
			result.Body = "Different result"
			if err := s.SettleAppBrowser(ctx, in.Instance, in.ID, in.BrowserOwner, result); !errors.Is(err, ErrAppTaskConflict) {
				t.Fatal("accepted changed settlement", err)
			}

		})
	}
}
func TestVerifiedAppTaskTimeoutAndFailedVerificationKeepOutputPrivate(t *testing.T) {
	s, store, upstream, in := appBrowserFixture(t, provider.PrivacyModePrivateTEE)
	ctx := t.Context()
	allow := func() error { return nil }
	s.secureTimeout = 25 * time.Millisecond
	if _, err := s.StartAppTask(ctx, in, allow); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for s.appTaskBusy() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	job, err := store.AppTask(ctx, in.Instance, in.ID)
	if err != nil || job.State != "failed" || job.Result != "" || upstream.calls() != 0 {
		t.Fatal(job, err)
	}
	in.ID = uuid.NewString()
	s.secureTimeout = time.Minute
	if _, err := s.StartAppTask(ctx, in, allow); err != nil {
		t.Fatal(err)
	}
	claim := uuid.NewString()
	if _, err := s.ClaimAppBrowser(in.Instance, in.ID, in.BrowserOwner, claim); err != nil {
		t.Fatal(err)
	}
	failed := DebateBrowserResult{ClaimID: claim, Body: "Unverified text", Verification: persistence.GenerationVerification{Status: persistence.VerificationFailed}}
	if err := s.SettleAppBrowser(ctx, in.Instance, in.ID, in.BrowserOwner, failed); err != nil {
		t.Fatal(err)
	}
	job, err = store.AppTask(ctx, in.Instance, in.ID)
	if err != nil || job.State != "failed" || job.Result != "" {
		t.Fatal(job, err)
	}
	in.ID = uuid.NewString()
	if _, err := s.StartAppTask(ctx, in, allow); err != nil {
		t.Fatal(err)
	}
	s.StopAppTask(in.Instance, in.ID)
	if _, err := s.ClaimAppBrowser(in.Instance, in.ID, in.BrowserOwner, claim); !errors.Is(err, ErrAppTaskConflict) {
		t.Fatal(err)
	}
}

func TestAcceptedBrowserSettlementRetryReleasesPendingAdmission(t *testing.T) {
	service, store, _, input := appBrowserFixture(t, provider.PrivacyModePrivateTEE)
	if _, err := service.StartAppTask(t.Context(), input, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	claim := uuid.NewString()
	if _, err := service.ClaimAppBrowser(input.Instance, input.ID, input.BrowserOwner, claim); err != nil {
		t.Fatal(err)
	}
	result := DebateBrowserResult{ClaimID: claim, Body: "Accepted result", Verification: verifiedSettlement("").Verification}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(append([]byte(input.Instance+"/"+input.ID+"/"+input.BrowserOwner+"/"), data...))
	// Simulate a committed result whose handler lost its response before releasing admission.
	if err := store.FinishBrowserAppTask(t.Context(), input.Instance, input.ID, "completed", result.Body, "", result.Verification, hex.EncodeToString(sum[:])); err != nil {
		t.Fatal(err)
	}
	if err := service.SettleAppBrowser(t.Context(), input.Instance, input.ID, input.BrowserOwner, result); err != nil {
		t.Fatal(err)
	}
	if service.appTaskBusy() {
		t.Fatal("accepted delivery retry retained the global generation slot")
	}
}
