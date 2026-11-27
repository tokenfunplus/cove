package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

type AppTask struct {
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

func (s *SQLiteStore) AppTask(ctx context.Context, instance, id string) (AppTask, error) {
	var t AppTask
	var verification, snapshot string
	err := s.db.QueryRowContext(ctx, "SELECT id,state,result,detail,fingerprint,verification,snapshot FROM mini_app_tasks WHERE instance_id=? AND id=?", instance, id).Scan(&t.ID, &t.State, &t.Result, &t.Error, &t.Fingerprint, &verification, &snapshot)
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
	_, err := s.db.ExecContext(ctx, "INSERT INTO mini_app_tasks(instance_id,id,fingerprint,request,state) VALUES(?,?,?,?,'running')", instance, id, fingerprint, frozen)
	return err
}

func (s *SQLiteStore) FinishAppTask(ctx context.Context, instance, id, state, result, detail string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE mini_app_tasks SET state=?,result=?,detail=? WHERE instance_id=? AND id=? AND state='running'", state, result, detail, instance, id)
	return err
}

func (s *SQLiteStore) RecoverAppTasks(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, "UPDATE mini_app_tasks SET state='failed',detail='Cove stopped before the task completed.' WHERE state='running'")
	return err
}

func (s *SQLiteStore) FindAppTask(ctx context.Context, instance, id string) (AppTask, bool, error) {
	task, err := s.AppTask(ctx, instance, id)
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
 FROM mini_app_tasks WHERE instance_id=? ORDER BY rowid DESC LIMIT 30`, instance)
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
	_, err = s.db.ExecContext(ctx, "INSERT INTO mini_app_tasks(instance_id,id,fingerprint,request,state,snapshot) VALUES(?,?,?,?,'running',?)", instance, id, fingerprint, frozen, string(data))
	return err
}
func (s *SQLiteStore) FinishBrowserAppTask(ctx context.Context, instance, id, state, body, detail string, v GenerationVerification) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx, "UPDATE mini_app_tasks SET state=?,result=?,detail=?,verification=? WHERE instance_id=? AND id=? AND state='running'", state, body, detail, string(data), instance, id)
	if err != nil {
		return err
	}
	count, err := res.RowsAffected()
	if err == nil && count == 0 {
		return sql.ErrNoRows
	}
	return err
}
