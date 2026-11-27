package chat

import (
	"context"
	"errors"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

// There is at most one unsaved result. App model admission stops until its owner
// saves it, while ordinary conversations can continue using the released slot.
var ErrAppTaskSavePending = errors.New("a Mini App result is waiting to be saved; retry saving it before starting another app model task")

type appTaskSettlement struct {
	instance, id, state, result, detail string
	verification                        *persistence.GenerationVerification
	receipt                             string
}

const appTaskSaveTimeout = 3 * time.Second

func finishAppTaskWithRetry(ctx context.Context, store AppTaskStore, saved appTaskSettlement) error {
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		if err = ctx.Err(); err != nil {
			return err
		}
		if saved.verification != nil {
			browser, ok := store.(browserAppStore)
			if !ok {
				return ErrAppBrowserModel
			}
			if accepted, checkErr := browser.AppBrowserSettlement(ctx, saved.instance, saved.id, saved.receipt); checkErr == nil && accepted {
				return nil
			}
			err = browser.FinishBrowserAppTask(ctx, saved.instance, saved.id, saved.state, saved.result, saved.detail, *saved.verification, saved.receipt)
			if err != nil {
				if accepted, checkErr := browser.AppBrowserSettlement(ctx, saved.instance, saved.id, saved.receipt); checkErr == nil && accepted {
					return nil
				}
			}
		} else {
			err = store.FinishAppTask(ctx, saved.instance, saved.id, saved.state, saved.result, saved.detail)
		}
		if err == nil {
			return nil
		}
		if attempt == 2 {
			break
		}
		timer := time.NewTimer(time.Duration(attempt+1) * 50 * time.Millisecond)
		select {
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		}
	}
	return err
}

// The worker lock is held until the terminal state is saved or its exact frozen
// result has a live pending owner. Never replay inference to recover a DB write.
func (s *Service) settleAppTaskLocked(store AppTaskStore, saved appTaskSettlement) error {
	ctx, cancel := context.WithTimeout(context.Background(), appTaskSaveTimeout)
	defer cancel()
	if err := finishAppTaskWithRetry(ctx, store, saved); err != nil {
		s.appTask.pending = &saved
		return err
	}
	return nil
}

func (s *Service) hasPendingAppTaskSave() bool {
	s.appTask.Lock()
	defer s.appTask.Unlock()
	return s.appTask.pending != nil
}

// ProjectAppTask is called only after the API checks the stored task's ordinary
// visibility. Unsaved output stays in memory and never pretends to be durable.
func (s *Service) ProjectAppTask(instance string, task persistence.AppTask) persistence.AppTask {
	s.appTask.Lock()
	defer s.appTask.Unlock()
	pending := s.appTask.pending
	if pending == nil || pending.instance != instance || pending.id != task.ID {
		return task
	}
	task.State = "save_failed"
	task.Result = pending.result
	task.Verification = pending.verification
	task.PendingSave = true
	task.Error = "Cove could not save this task. Its final state and any result are only in memory. Retry saving before restarting Cove; the model will not run again."
	return task
}

// RetryAppTaskSave is an owner-requested retry of a previous settlement. It
// neither reads new app data nor invokes a provider and is idempotent once saved.
func (s *Service) RetryAppTaskSave(ctx context.Context, instance, id string) error {
	store, ok := s.store.(AppTaskStore)
	if !ok {
		return ErrAppTaskConflict
	}
	s.appTask.Lock()
	defer s.appTask.Unlock()
	pending := s.appTask.pending
	if pending == nil || pending.instance != instance || pending.id != id {
		task, found, err := store.FindAppTask(ctx, instance, id)
		if err != nil {
			return err
		}
		if !found || task.State == "running" {
			return ErrAppTaskConflict
		}
		return nil
	}
	if _, found, err := store.FindAppTask(ctx, instance, id); err != nil {
		return err
	} else if !found {
		s.appTask.pending = nil
		return ErrAppTaskConflict
	}
	bounded, cancel := context.WithTimeout(ctx, appTaskSaveTimeout)
	defer cancel()
	if err := finishAppTaskWithRetry(bounded, store, *pending); err != nil {
		return ErrAppTaskSavePending
	}
	s.appTask.pending = nil
	return nil
}

// DiscardAppTaskResult drops only an explicitly selected unsaved output. The
// cancellation must be durable before admission is released; a saved result is
// never replaced, even if an earlier save lost its acknowledgment.
func (s *Service) DiscardAppTaskResult(ctx context.Context, instance, id string) error {
	store, ok := s.store.(AppTaskStore)
	if !ok {
		return ErrAppTaskConflict
	}
	s.appTask.Lock()
	defer s.appTask.Unlock()
	pending := s.appTask.pending
	task, found, err := store.FindAppTask(ctx, instance, id)
	if err != nil {
		return err
	}
	if !found {
		return ErrAppTaskConflict
	}
	if pending == nil || pending.instance != instance || pending.id != id {
		if task.State == "cancelled" {
			return nil
		}
		return ErrAppTaskConflict
	}
	if task.State != "running" {
		// A terminal write may have committed before the connection failed.
		s.appTask.pending = nil
		return nil
	}
	bounded, cancel := context.WithTimeout(ctx, appTaskSaveTimeout)
	defer cancel()
	discarded := appTaskSettlement{instance: instance, id: id, state: "cancelled", detail: "The owner discarded this unsaved result."}
	if err := finishAppTaskWithRetry(bounded, store, discarded); err != nil {
		return ErrAppTaskSavePending
	}
	s.appTask.pending = nil
	return nil
}

// Grant changes retain an already completed unsaved result. Explicit deletion
// releases its memory, and stopping or shutdown makes one bounded save attempt.
func (s *Service) flushPendingAppTaskOnStop(instance, id string) {
	store, ok := s.store.(AppTaskStore)
	if !ok {
		return
	}
	s.appTask.Lock()
	defer s.appTask.Unlock()
	pending := s.appTask.pending
	if pending == nil || instance != "" && pending.instance != instance || id != "" && pending.id != id {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), appTaskSaveTimeout)
	defer cancel()
	if _, found, err := store.FindAppTask(ctx, pending.instance, pending.id); err != nil {
		return
	} else if !found {
		s.appTask.pending = nil
		return
	}
	if finishAppTaskWithRetry(ctx, store, *pending) == nil {
		s.appTask.pending = nil
	}
}
