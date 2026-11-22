package persistence

import (
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
)

const localDocumentsMigration = `
CREATE TABLE IF NOT EXISTS local_documents(id TEXT PRIMARY KEY, snapshot TEXT NOT NULL, original BLOB NOT NULL, model_hash TEXT NOT NULL, index_version TEXT NOT NULL, indexed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS local_document_chunks(document_id TEXT NOT NULL REFERENCES local_documents(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, sections TEXT NOT NULL, text TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY(document_id,ordinal));
PRAGMA user_version=25;`

type LocalDocument struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Characters   int       `json:"characters"`
	Chunks       int       `json:"chunks"`
	ModelHash    string    `json:"model_sha256"`
	IndexVersion string    `json:"index_version"`
	IndexedAt    time.Time `json:"indexed_at"`
}
type LocalChunk struct {
	DocumentID string
	Ordinal    int
	Sections   []string
	Text       string
	Vector     []float32
}

func (store *SQLiteStore) ListLocalDocuments(ctx context.Context) ([]LocalDocument, error) {
	rows, err := store.db.QueryContext(ctx, `SELECT d.id,d.snapshot,d.model_hash,d.index_version,d.indexed_at,(SELECT count(*) FROM local_document_chunks c WHERE c.document_id=d.id) FROM local_documents d ORDER BY d.indexed_at DESC,d.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []LocalDocument{}
	for rows.Next() {
		var item LocalDocument
		var snapshot documents.Snapshot
		var encoded, timestamp string
		if err = rows.Scan(&item.ID, &encoded, &item.ModelHash, &item.IndexVersion, &timestamp, &item.Chunks); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(encoded), &snapshot); err != nil {
			return nil, err
		}
		item.Name = snapshot.Name
		item.Characters = snapshot.Characters
		item.IndexedAt, _ = time.Parse(time.RFC3339Nano, timestamp)
		result = append(result, item)
	}
	return result, rows.Err()
}
func (store *SQLiteStore) SaveLocalDocument(ctx context.Context, source documents.Prepared, modelHash, indexVersion string, chunks []LocalChunk) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM local_documents WHERE id<>?`, source.ID).Scan(&count); err != nil {
		return err
	}
	if count >= 32 {
		return errors.New("The local library supports up to 32 documents. Remove a document before adding another.")
	}
	snapshot, err := json.Marshal(source.Snapshot)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO local_documents(id,snapshot,original,model_hash,index_version,indexed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot,original=excluded.original,model_hash=excluded.model_hash,index_version=excluded.index_version,indexed_at=excluded.indexed_at`, source.ID, string(snapshot), source.Data, modelHash, indexVersion, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM local_document_chunks WHERE document_id=?`, source.ID); err != nil {
		return err
	}
	for _, chunk := range chunks {
		sections, _ := json.Marshal(chunk.Sections)
		vector := make([]byte, len(chunk.Vector)*4)
		for i, v := range chunk.Vector {
			binary.LittleEndian.PutUint32(vector[i*4:], math.Float32bits(v))
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO local_document_chunks(document_id,ordinal,sections,text,vector) VALUES(?,?,?,?,?)`, source.ID, chunk.Ordinal, string(sections), chunk.Text, vector); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (store *SQLiteStore) ReadLocalDocument(ctx context.Context, id string) (documents.Prepared, error) {
	var source documents.Prepared
	var encoded string
	if err := store.db.QueryRowContext(ctx, `SELECT snapshot,original FROM local_documents WHERE id=?`, id).Scan(&encoded, &source.Data); err != nil {
		return source, err
	}
	err := json.Unmarshal([]byte(encoded), &source.Snapshot)
	return source, err
}
func (store *SQLiteStore) ReadLocalChunks(ctx context.Context, id, hash, version string) ([]LocalChunk, error) {
	rows, err := store.db.QueryContext(ctx, `SELECT c.ordinal,c.sections,c.text,c.vector FROM local_document_chunks c JOIN local_documents d ON d.id=c.document_id WHERE d.id=? AND d.model_hash=? AND d.index_version=? ORDER BY c.ordinal`, id, hash, version)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []LocalChunk{}
	for rows.Next() {
		item := LocalChunk{DocumentID: id}
		var sections string
		var vector []byte
		if err = rows.Scan(&item.Ordinal, &sections, &item.Text, &vector); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(sections), &item.Sections); err != nil {
			return nil, err
		}
		if len(vector) != 512*4 {
			return nil, errors.New("The saved local index has an invalid vector dimension.")
		}
		item.Vector = make([]float32, 512)
		for i := range item.Vector {
			item.Vector[i] = math.Float32frombits(binary.LittleEndian.Uint32(vector[i*4:]))
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
func (store *SQLiteStore) DeleteLocalDocument(ctx context.Context, id string) error {
	result, err := store.db.ExecContext(ctx, `DELETE FROM local_documents WHERE id=?`, id)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
func (store *SQLiteStore) ClearLocalIndexes(ctx context.Context) error {
	_, err := store.db.ExecContext(ctx, `DELETE FROM project_source_indexes; DELETE FROM local_document_chunks; UPDATE local_documents SET model_hash='',index_version='';`)
	return err
}
