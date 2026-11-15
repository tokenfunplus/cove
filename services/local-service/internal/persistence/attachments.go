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
	return documents.Input{}, sql.ErrNoRows
}
