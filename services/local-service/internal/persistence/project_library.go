package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
)

const localCapabilitiesMigration = `
ALTER TABLE generation_batches ADD COLUMN local_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_sources ADD COLUMN usage TEXT NOT NULL DEFAULT 'always' CHECK(usage IN ('always','search'));
CREATE TABLE project_source_indexes(source_id TEXT PRIMARY KEY REFERENCES project_sources(id) ON DELETE CASCADE, model_hash TEXT NOT NULL,index_version TEXT NOT NULL,chunks TEXT NOT NULL,indexed_at TEXT NOT NULL);
PRAGMA user_version=26;`

// ProjectLibrary adapts explicitly searchable project sources to local retrieval.
// Originals remain in the existing project blob store rather than being copied.
type ProjectLibrary struct {
	store *SQLiteStore
	id    string
}

func (s *SQLiteStore) ProjectLibrary(id string) *ProjectLibrary {
	return &ProjectLibrary{store: s, id: id}
}

func (s *SQLiteStore) SetProjectSourceUsage(ctx context.Context, project, source string, revision int64, usage string) (Project, error) {
	if usage != "always" && usage != "search" {
		return Project{}, ErrInvalidProject
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, err
	}
	defer tx.Rollback()
	if _, err = checkProjectRevision(ctx, tx, project, revision); err != nil {
		return Project{}, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE project_sources SET usage=? WHERE project_id=? AND id=?`, usage, project, source)
	if err != nil {
		return Project{}, err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return Project{}, sql.ErrNoRows
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM project_source_indexes WHERE source_id=?`, source); err != nil {
		return Project{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE projects SET revision=revision+1,updated_at=? WHERE id=?`, time.Now().UTC().UnixNano(), project); err != nil {
		return Project{}, err
	}
	if err = tx.Commit(); err != nil {
		return Project{}, err
	}
	return s.GetProject(ctx, project)
}

func (library *ProjectLibrary) ListLocalDocuments(ctx context.Context) ([]LocalDocument, error) {
	project, err := library.store.GetProject(ctx, library.id)
	if err != nil {
		return nil, err
	}
	result := []LocalDocument{}
	for _, source := range project.Sources {
		if source.Usage != "search" {
			continue
		}
		item := LocalDocument{ID: source.Snapshot.ID, Name: source.Snapshot.Name, Characters: source.Snapshot.Characters}
		var raw, stamp string
		err = library.store.db.QueryRowContext(ctx, `SELECT model_hash,index_version,chunks,indexed_at FROM project_source_indexes WHERE source_id=?`, source.ID).Scan(&item.ModelHash, &item.IndexVersion, &raw, &stamp)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if err == nil {
			var chunks []LocalChunk
			if err = json.Unmarshal([]byte(raw), &chunks); err != nil {
				return nil, err
			}
			item.Chunks = len(chunks)
			item.IndexedAt, _ = time.Parse(time.RFC3339Nano, stamp)
		}
		result = append(result, item)
	}
	return result, nil
}

func (library *ProjectLibrary) ReadLocalDocument(ctx context.Context, id string) (documents.Prepared, error) {
	var result documents.Prepared
	var raw string
	err := library.store.db.QueryRowContext(ctx, `SELECT s.snapshot,b.data FROM project_sources s JOIN project_source_blobs b ON b.hash=s.blob_hash WHERE s.project_id=? AND json_extract(s.snapshot,'$.id')=? AND s.usage='search'`, library.id, id).Scan(&raw, &result.Data)
	if err != nil {
		return result, err
	}
	err = json.Unmarshal([]byte(raw), &result.Snapshot)
	return result, err
}

func (library *ProjectLibrary) SaveLocalDocument(ctx context.Context, source documents.Prepared, hash, version string, chunks []LocalChunk) error {
	raw, err := json.Marshal(chunks)
	if err != nil {
		return err
	}
	result, err := library.store.db.ExecContext(ctx, `INSERT INTO project_source_indexes(source_id,model_hash,index_version,chunks,indexed_at) SELECT id,?,?,?,? FROM project_sources WHERE project_id=? AND json_extract(snapshot,'$.id')=? AND usage='search' ON CONFLICT(source_id) DO UPDATE SET model_hash=excluded.model_hash,index_version=excluded.index_version,chunks=excluded.chunks,indexed_at=excluded.indexed_at`, hash, version, string(raw), time.Now().UTC().Format(time.RFC3339Nano), library.id, source.ID)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return sql.ErrNoRows
	}
	return nil
}

func (library *ProjectLibrary) ReadLocalChunks(ctx context.Context, id, hash, version string) ([]LocalChunk, error) {
	var raw string
	err := library.store.db.QueryRowContext(ctx, `SELECT i.chunks FROM project_source_indexes i JOIN project_sources s ON s.id=i.source_id WHERE s.project_id=? AND json_extract(s.snapshot,'$.id')=? AND s.usage='search' AND i.model_hash=? AND i.index_version=?`, library.id, id, hash, version).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return []LocalChunk{}, nil
	}
	if err != nil {
		return nil, err
	}
	var chunks []LocalChunk
	if err = json.Unmarshal([]byte(raw), &chunks); err != nil {
		return nil, err
	}
	for _, chunk := range chunks {
		if chunk.DocumentID != id || len(chunk.Vector) != 512 {
			return nil, errors.New("The project search index is invalid. Index the document again.")
		}
	}
	return chunks, nil
}

func (library *ProjectLibrary) DeleteLocalDocument(context.Context, string) error {
	return errors.New("Manage project materials from the project editor.")
}
func (library *ProjectLibrary) ClearLocalIndexes(ctx context.Context) error {
	_, err := library.store.db.ExecContext(ctx, `DELETE FROM project_source_indexes WHERE source_id IN (SELECT id FROM project_sources WHERE project_id=?)`, library.id)
	return err
}
