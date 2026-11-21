package chat

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

// The browser owns inference, but its disappearance must not hold the global
// Batch slot forever. The deadline includes grace for browser timeout settlement.
// Repeated phase commands do not renew it.
func (service *Service) trackSecureGeneration(id string) {
	service.activeMu.Lock()
	defer service.activeMu.Unlock()
	if _, exists := service.secureActive[id]; exists {
		return
	}
	service.secureActive[id] = time.AfterFunc(service.secureTimeout, func() {
		service.expireSecureGeneration(id)
	})
}

func (service *Service) finishSecureGeneration(id string) {
	service.activeMu.Lock()
	defer service.activeMu.Unlock()
	if timer, exists := service.secureActive[id]; exists {
		timer.Stop()
		delete(service.secureActive, id)
	}
}

func (service *Service) expireSecureGeneration(id string) {
	service.cancelWebTools(id)
	service.secureMu.Lock()
	defer service.secureMu.Unlock()
	service.activeMu.Lock()
	_, active := service.secureActive[id]
	service.activeMu.Unlock()
	if !active {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	generation, err := service.store.GetGeneration(ctx, id)
	if err == nil {
		// No browser evidence arrived. Do not infer verified lanes from the
		// timeout code or from the last reported inference phase.
		lanes := &persistence.VerificationLanes{Gateway: persistence.VerificationLaneFailed, Response: persistence.VerificationLaneFailed}
		if generation.Snapshot.PrivacyMode == provider.PrivacyModePrivateTEE {
			lanes.Model = persistence.VerificationLaneFailed
		}
		_, err = service.settleSecureGeneration(ctx, persistence.SecureGenerationSettlementInput{
			GenerationID: id,
			Verification: persistence.GenerationVerification{
				Status:          persistence.VerificationFailed,
				FailureCode:     "timeout",
				EvidenceSummary: "The browser did not settle the Generation before its deadline.",
				Lanes:           lanes,
			},
		})
	}
	if errors.Is(err, sql.ErrNoRows) {
		service.finishSecureGeneration(id)
	} else if err != nil {
		// A transient storage error must not permanently disable the watchdog.
		service.activeMu.Lock()
		if _, exists := service.secureActive[id]; exists {
			service.secureActive[id] = time.AfterFunc(time.Second, func() {
				service.expireSecureGeneration(id)
			})
		}
		service.activeMu.Unlock()
	}
}
