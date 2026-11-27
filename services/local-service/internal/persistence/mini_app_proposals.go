package persistence

import (
	"context"
	"database/sql"
	"errors"
)

// AppProposalTask excludes generation tasks and proposals for withdrawn grants
// or older app rules. The frozen revision is scoped to the enabled instance.
func (s *SQLiteStore) AppProposalTask(ctx context.Context, instance, id string) (AppTask, error) {
	var t AppTask
	err := s.db.QueryRowContext(ctx, `SELECT t.id,t.state,t.result,t.detail FROM mini_app_tasks t JOIN mini_app_instances i ON i.id=t.instance_id
WHERE i.id=? AND t.id=? AND i.enabled=1 AND i.revision=json_extract(t.request,'$.ProposalRevision') AND i.release_id=json_extract(t.request,'$.Release')`, instance, id).Scan(&t.ID, &t.State, &t.Result, &t.Error)
	return t, err
}

// LatestAppProposal lets a returning picker finish or cancel the most recent
// proposal on the same surface. A package upgrade or grant change invalidates it.
func (s *SQLiteStore) LatestAppProposal(ctx context.Context, instance, surface string) (*AppTask, error) {
	var t AppTask
	err := s.db.QueryRowContext(ctx, `SELECT t.id,t.state,t.result,t.detail FROM mini_app_tasks t JOIN mini_app_instances i ON i.id=t.instance_id
WHERE i.id=? AND i.enabled=1 AND i.revision=json_extract(t.request,'$.ProposalRevision')
AND i.release_id=json_extract(t.request,'$.Release') AND ?=json_extract(t.request,'$.Target.surface')
ORDER BY t.rowid DESC LIMIT 1`, instance, surface).Scan(&t.ID, &t.State, &t.Result, &t.Error)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &t, err
}
