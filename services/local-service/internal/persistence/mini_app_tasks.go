package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

type AppTask struct {
	Inputs       json.RawMessage         `json:"inputs,omitempty"`
	Destination  string                  `json:"destination,omitempty"`
	Browser      bool                    `json:"browser,omitempty"`
	Verification *GenerationVerification `json:"verification,omitempty"`
	Snapshot     *ProviderSnapshot       `json:"snapshot,omitempty"`
	Action       string                  `json:"action,omitempty"`
	Surface      string                  `json:"surface,omitempty"`
	ProviderID   string                  `json:"providerId,omitempty"`
	ModelID      string                  `json:"modelId,omitempty"`
	ID           string                  `json:"id"`
	State        string                  `json:"state"`
	Result       string                  `json:"result,omitempty"`
	Error        string                  `json:"error,omitempty"`
	Fingerprint  string                  `json:"-"`
}

// ProposalRevision is present in every persisted proposal, including v1 rows.
const generationTaskPredicate = " AND state!='expired' AND json_type(request,'$.ProposalRevision') IS NULL"

func (s *SQLiteStore) AppTask(ctx context.Context, instance, id string) (AppTask, error) {
	return s.appTask(ctx, instance, id, true)
}

func (s *SQLiteStore) appTask(ctx context.Context, instance, id string, generationOnly bool) (AppTask, error) {
	var t AppTask
	var verification, snapshot, inputs string
	query := "SELECT id,state,result,detail,fingerprint,verification,snapshot,coalesce(json_extract(request,'$.Target.input'),''),coalesce(json_extract(request,'$.Target.destination'),''),coalesce(json_extract(request,'$.Target.modelId'),'') FROM mini_app_tasks WHERE instance_id=? AND id=?"
	if generationOnly {
		query += generationTaskPredicate
	}
	err := s.db.QueryRowContext(ctx, query, instance, id).Scan(&t.ID, &t.State, &t.Result, &t.Error, &t.Fingerprint, &verification, &snapshot, &inputs, &t.Destination, &t.ModelID)
	if err == nil && inputs != "" {
		t.Inputs = json.RawMessage(inputs)
	}
	if err == nil && snapshot != "" {
		t.Browser = true
		err = json.Unmarshal([]byte(snapshot), &t.Snapshot)
	}
	if err == nil && verification != "" {
		err = json.Unmarshal([]byte(verification), &t.Verification)
	}
	return t, err
}

func (s *SQLiteStore) BeginAppTask(ctx context.Context, instance, id, fingerprint, frozen string) error {
	return s.MiniAppTransaction(ctx, func(tx *MiniAppStore) error {
		if _, err := tx.tx.ExecContext(ctx, "INSERT INTO mini_app_tasks(instance_id,id,fingerprint,request,state,created_at) VALUES(?,?,?,?,'running',unixepoch())", instance, id, fingerprint, frozen); err != nil {
			return err
		}
		return tx.recordAppTaskActivity(instance, id, "running")
	})
}

func (s *SQLiteStore) FinishAppTask(ctx context.Context, instance, id, state, result, detail string) error {
	return s.MiniAppTransaction(ctx, func(tx *MiniAppStore) error {
		res, err := tx.tx.ExecContext(ctx, "UPDATE mini_app_tasks SET state=?,result=?,detail=? WHERE instance_id=? AND id=? AND state='running'", state, result, detail, instance, id)
		if err != nil {
			return err
		}
		count, err := res.RowsAffected()
		if err != nil || count == 0 {
			return err
		}
		// Capture the frozen action before retention may discard the task request.
		if err := tx.recordAppTaskActivity(instance, id, state); err != nil {
			return err
		}
		_, err = tx.tx.ExecContext(ctx, compactTasks, instance)
		return err
	})
}

func (tx *MiniAppStore) recordAppTaskActivity(instance, id, status string) error {
	var request, release string
	if err := tx.tx.QueryRowContext(tx.ctx, "SELECT t.request,i.release_id FROM mini_app_tasks t JOIN mini_app_instances i ON i.id=t.instance_id WHERE t.instance_id=? AND t.id=?", instance, id).Scan(&request, &release); err != nil {
		return err
	}
	var saved struct {
		Release string
		Target  struct{ Action, Surface string }
	}
	_ = json.Unmarshal([]byte(request), &saved)
	if saved.Release != "" {
		release = saved.Release
	}
	action := saved.Target.Action
	if action == "" {
		action = "ai.propose"
	}
	surface := saved.Target.Surface
	if surface == "" {
		surface = "page"
	}
	return tx.RecordActivity(instance, id, release, action, surface, status)
}

func (s *SQLiteStore) RecoverAppTasks(ctx context.Context) error {
	return s.MiniAppTransaction(ctx, func(tx *MiniAppStore) error {
		rows, err := tx.tx.QueryContext(ctx, "SELECT instance_id,id FROM mini_app_tasks WHERE state='running'")
		if err != nil {
			return err
		}
		type interruptedTask struct{ instance, id string }
		var interrupted []interruptedTask
		for rows.Next() {
			var task interruptedTask
			if err := rows.Scan(&task.instance, &task.id); err != nil {
				rows.Close()
				return err
			}
			interrupted = append(interrupted, task)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if _, err := tx.tx.ExecContext(ctx, "UPDATE mini_app_tasks SET state='failed',detail='Cove stopped before the task completed.' WHERE state='running'"); err != nil {
			return err
		}
		for _, task := range interrupted {
			if err := tx.recordAppTaskActivity(task.instance, task.id, "failed"); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *SQLiteStore) FindAppTask(ctx context.Context, instance, id string) (AppTask, bool, error) {
	task, err := s.appTask(ctx, instance, id, false)
	if errors.Is(err, sql.ErrNoRows) {
		return AppTask{}, false, nil
	}
	return task, err == nil, err
}

func (s *SQLiteStore) ListAppTasks(ctx context.Context, instance string) ([]AppTask, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,state,result,detail,
 coalesce(json_extract(request,'$.Target.action'),''),
 coalesce(json_extract(request,'$.Target.surface'),''),
 coalesce(json_extract(request,'$.Target.providerId'),''),
 coalesce(json_extract(request,'$.Target.modelId'),'')
 FROM mini_app_tasks WHERE instance_id=?`+generationTaskPredicate+` ORDER BY rowid DESC LIMIT 30`, instance)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tasks := []AppTask{}
	for rows.Next() {
		var t AppTask
		if err := rows.Scan(&t.ID, &t.State, &t.Result, &t.Error, &t.Action, &t.Surface, &t.ProviderID, &t.ModelID); err != nil {
			return nil, err
		}
		tasks = append(tasks, t)
	}
	return tasks, rows.Err()
}

func (s *SQLiteStore) BeginBrowserAppTask(ctx context.Context, instance, id, fingerprint, frozen string, snapshot ProviderSnapshot) error {
	data, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	return s.MiniAppTransaction(ctx, func(tx *MiniAppStore) error {
		if _, err := tx.tx.ExecContext(ctx, "INSERT INTO mini_app_tasks(instance_id,id,fingerprint,request,state,snapshot,created_at) VALUES(?,?,?,?,'running',?,unixepoch())", instance, id, fingerprint, frozen, string(data)); err != nil {
			return err
		}
		return tx.recordAppTaskActivity(instance, id, "running")
	})
}
func (s *SQLiteStore) FinishBrowserAppTask(ctx context.Context, instance, id, state, body, detail string, v GenerationVerification, receipt string) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return s.MiniAppTransaction(ctx, func(tx *MiniAppStore) error {
		res, err := tx.tx.ExecContext(ctx, "UPDATE mini_app_tasks SET state=?,result=?,detail=?,verification=?,request=json_set(request,'$.BrowserSettlement',?) WHERE instance_id=? AND id=? AND state='running'", state, body, detail, string(data), receipt, instance, id)
		if err != nil {
			return err
		}
		count, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if count == 0 {
			return sql.ErrNoRows
		}
		if err := tx.recordAppTaskActivity(instance, id, state); err != nil {
			return err
		}
		_, err = tx.tx.ExecContext(ctx, compactTasks, instance)
		return err
	})
}

// A delivery retry succeeds only for the identical settlement from the same browser claim.
func (s *SQLiteStore) AppBrowserSettlement(ctx context.Context, instance, id, receipt string) (bool, error) {
	var accepted bool
	err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM mini_app_tasks WHERE instance_id=? AND id=? AND state IN ('completed','failed') AND json_extract(request,'$.BrowserSettlement')=?)", instance, id, receipt).Scan(&accepted)
	return accepted, err
}
