package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
)

func (store *SQLiteStore) LoadAttachmentData(ctx context.Context, batchID, documentID string) (documents.Input, error) {
	var snapshotsJSON, dataJSON string
	if err := store.db.QueryRowContext(ctx, `SELECT attachments, attachment_data FROM generation_batches WHERE id = ?`, batchID).Scan(&snapshotsJSON, &dataJSON); err != nil {
		return documents.Input{}, err
	}
	var snapshots []documents.Snapshot
	var data [][]byte
	if err := json.Unmarshal([]byte(snapshotsJSON), &snapshots); err != nil {
		return documents.Input{}, fmt.Errorf("decode attachment snapshots: %w", err)
	}
	if err := json.Unmarshal([]byte(dataJSON), &data); err != nil {
		return documents.Input{}, fmt.Errorf("decode attachment data: %w", err)
	}
	for index, snapshot := range snapshots {
		if snapshot.ID == documentID && index < len(data) {
			return documents.Input{Name: snapshot.Name, Data: data[index]}, nil
		}
	}
	rows, err := store.db.QueryContext(ctx, `SELECT web_search_run FROM generations WHERE generation_batch_id=?`, batchID)
	if err != nil {
		return documents.Input{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var encoded string
		if err := rows.Scan(&encoded); err != nil {
			return documents.Input{}, err
		}
		var run WebSearchRun
		if err := json.Unmarshal([]byte(encoded), &run); err != nil {
			return documents.Input{}, err
		}
		for _, source := range run.Sources {
			if source.ID == documentID {
				return documents.Input{Name: source.Name, Data: source.Data}, nil
			}
		}
	}
	if err := rows.Err(); err != nil {
		return documents.Input{}, err
	}
	return documents.Input{}, sql.ErrNoRows
}

func (store *SQLiteStore) LoadBatchAttachments(ctx context.Context, batchID string) ([]documents.Prepared, error) {
	var snapshotsJSON, dataJSON string
	if err := store.db.QueryRowContext(ctx, `SELECT attachments, attachment_data FROM generation_batches WHERE id = ?`, batchID).Scan(&snapshotsJSON, &dataJSON); err != nil {
		return nil, err
	}
	var snapshots []documents.Snapshot
	var data [][]byte
	if err := json.Unmarshal([]byte(snapshotsJSON), &snapshots); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(dataJSON), &data); err != nil {
		return nil, err
	}
	if len(snapshots) != len(data) {
		return nil, fmt.Errorf("saved attachment snapshots are inconsistent")
	}
	result := make([]documents.Prepared, len(snapshots))
	for i, snapshot := range snapshots {
		result[i] = documents.Prepared{Snapshot: snapshot, Data: data[i]}
	}
	return result, nil
}
