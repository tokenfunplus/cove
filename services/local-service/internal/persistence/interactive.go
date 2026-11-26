package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
)

var ErrCardConflict = errors.New("interactive card changed, was already submitted, or is no longer the current answer")

const interactiveMigration = `ALTER TABLE generation_batches ADD COLUMN interactive INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS interactive_runs (
 generation_id TEXT PRIMARY KEY REFERENCES generations(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 definition TEXT NOT NULL, values_json TEXT NOT NULL, checks_json TEXT NOT NULL DEFAULT '{}',
 revision INTEGER NOT NULL DEFAULT 0, submitted_batch_id TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL DEFAULT ''
);
PRAGMA user_version=29;`

type InteractiveStore interface {
	MaterializeCard(context.Context, string) (interactive.Run, error)
	SaveCard(context.Context, interactive.Submission) (interactive.Run, error)
	PrepareCard(context.Context, interactive.Submission, string) (string, string, error)
	CardReplay(context.Context, interactive.Submission, string, string) (GenerationBatch, bool, error)
}

func readCard(ctx context.Context, db batchReader, id string) (interactive.Run, error) {
	var r interactive.Run
	var definition, values, checks string
	err := db.QueryRowContext(ctx, `SELECT generation_id,definition,values_json,checks_json,revision,submitted_batch_id FROM interactive_runs WHERE generation_id=?`, id).Scan(&r.GenerationID, &definition, &values, &checks, &r.Revision, &r.SubmittedBatchID)
	if err != nil {
		return r, err
	}
	parsed, parseErr := interactive.Parse([]byte(definition))
	r.Definition = parsed
	if parseErr != nil || json.Unmarshal([]byte(values), &r.Values) != nil || json.Unmarshal([]byte(checks), &r.Checks) != nil {
		return r, interactive.ErrInvalid
	}
	return r, nil
}
func cardEligible(ctx context.Context, db batchReader, id string) bool {
	var source, selected, latest, state, verification string
	var enabled, targets int
	err := db.QueryRowContext(ctx, `SELECT g.generation_batch_id,b.selected_generation_id,b.interactive,g.state,g.verification_snapshot,(SELECT count(*) FROM generation_targets t WHERE t.generation_batch_id=b.id),(SELECT id FROM generation_batches WHERE conversation_id=g.conversation_id ORDER BY created_at DESC,id DESC LIMIT 1) FROM generations g JOIN generation_batches b ON b.id=g.generation_batch_id JOIN conversations c ON c.id=g.conversation_id WHERE g.id=? AND b.context_skipped=0 AND c.archived_at IS NULL`, id).Scan(&source, &selected, &enabled, &state, &verification, &targets, &latest)
	if err != nil || enabled != 1 || targets != 1 || selected != id || latest != source || state != string(GenerationCompleted) {
		return false
	}
	g, e := scanGeneration(db.QueryRowContext(ctx, generationQuery+` WHERE id=?`, id))
	return e == nil && generationSelectable(g)
}
func (s *SQLiteStore) MaterializeCard(ctx context.Context, id string) (interactive.Run, error) {
	if r, e := readCard(ctx, s.db, id); e == nil {
		r.CanContinue = r.Definition.HasContinuation() && r.SubmittedBatchID == "" && cardEligible(ctx, s.db, id)
		return r, nil
	} else if !errors.Is(e, sql.ErrNoRows) {
		return r, e
	}
	g, e := s.GetGeneration(ctx, id)
	if e != nil {
		return interactive.Run{}, e
	}
	b, e := s.GetGenerationBatch(ctx, g.GenerationBatchID)
	if e != nil {
		return interactive.Run{}, e
	}
	if !b.Interactive || len(b.Targets) != 1 || !generationSelectable(g) {
		return interactive.Run{}, interactive.ErrInvalid
	}
	var body string
	if e = s.db.QueryRowContext(ctx, `SELECT body FROM messages WHERE id=?`, g.AssistantMessageID).Scan(&body); e != nil {
		return interactive.Run{}, e
	}
	d, e := interactive.Extract(body)
	if e != nil {
		return interactive.Run{}, e
	}
	def, _ := json.Marshal(d)
	values, _ := json.Marshal(d.Spec.State)
	if _, e = s.db.ExecContext(ctx, `INSERT INTO interactive_runs(generation_id,conversation_id,definition,values_json) VALUES(?,?,?,?) ON CONFLICT(generation_id) DO NOTHING`, id, g.ConversationID, string(def), string(values)); e != nil {
		return interactive.Run{}, e
	}
	r, e := readCard(ctx, s.db, id)
	r.CanContinue = r.Definition.HasContinuation() && r.SubmittedBatchID == "" && cardEligible(ctx, s.db, id)
	return r, e
}
func (s *SQLiteStore) SaveCard(ctx context.Context, in interactive.Submission) (interactive.Run, error) {
	r, e := readCard(ctx, s.db, in.GenerationID)
	if e != nil {
		return r, e
	}
	if e = r.Definition.ValidateValues(in.Values, in.Checks, false); e != nil {
		return r, e
	}
	values, _ := json.Marshal(in.Values)
	checks, _ := json.Marshal(in.Checks)
	if in.Checks == nil {
		checks = []byte("{}")
	}
	result, e := s.db.ExecContext(ctx, `UPDATE interactive_runs SET values_json=?,checks_json=?,revision=revision+1 WHERE generation_id=? AND revision=? AND submitted_batch_id=''`, string(values), string(checks), in.GenerationID, in.Revision)
	if e != nil {
		return r, e
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return r, ErrCardConflict
	}
	r, e = readCard(ctx, s.db, in.GenerationID)
	r.CanContinue = r.Definition.HasContinuation() && cardEligible(ctx, s.db, in.GenerationID)
	return r, e
}
func (s *SQLiteStore) PrepareCard(ctx context.Context, in interactive.Submission, question string) (string, string, error) {
	r, e := readCard(ctx, s.db, in.GenerationID)
	if e != nil {
		return "", "", e
	}
	if !r.Definition.HasContinuation() {
		return "", "", interactive.ErrInvalid
	}
	if r.SubmittedBatchID != "" || r.Revision != in.Revision || !cardEligible(ctx, s.db, in.GenerationID) {
		return "", "", ErrCardConflict
	}
	if in.Intent == "discuss" {
		return r.Definition.DiscussInput(in.Values, in.Checks, question, in.GenerationID)
	}
	if in.Intent != "" {
		return "", "", interactive.ErrInvalid
	}
	return r.Definition.Input(in.Values, in.Checks, question, in.GenerationID)
}
func (s *SQLiteStore) CardReplay(ctx context.Context, in interactive.Submission, fingerprint, requestID string) (GenerationBatch, bool, error) {
	b, e := s.GetGenerationBatchByClientRequestID(ctx, requestID)
	if errors.Is(e, sql.ErrNoRows) {
		return b, false, nil
	}
	if e != nil {
		return b, false, e
	}
	if e = validateCardReplay(ctx, s.db, b.ID, in, fingerprint); e != nil {
		return GenerationBatch{}, false, e
	}
	return b, true, nil
}

func validateCardReplay(ctx context.Context, db batchReader, batchID string, in interactive.Submission, fingerprint string) error {
	var savedFingerprint, generation string
	err := db.QueryRowContext(ctx, `SELECT generation_id,fingerprint FROM interactive_runs WHERE submitted_batch_id=?`, batchID).Scan(&generation, &savedFingerprint)
	if err != nil || generation != in.GenerationID || savedFingerprint != fingerprint {
		return ErrCardConflict
	}
	return nil
}
func admitCardTx(ctx context.Context, tx *sql.Tx, input BeginGenerationBatchInput, batchID string) error {
	if input.Card == nil {
		return nil
	}
	in := *input.Card
	r, e := readCard(ctx, tx, in.GenerationID)
	if e != nil {
		return e
	}
	var owner string
	if e = tx.QueryRowContext(ctx, `SELECT conversation_id FROM interactive_runs WHERE generation_id=?`, in.GenerationID).Scan(&owner); e != nil {
		return e
	}
	if !r.Definition.HasContinuation() {
		return interactive.ErrInvalid
	}
	if owner != input.ConversationID || r.Revision != in.Revision || r.SubmittedBatchID != "" || !cardEligible(ctx, tx, in.GenerationID) {
		return ErrCardConflict
	}
	if in.Intent != "" && in.Intent != "discuss" {
		return interactive.ErrInvalid
	}
	if e = r.Definition.ValidateValues(in.Values, in.Checks, in.Intent != "discuss"); e != nil {
		return e
	}
	values, _ := json.Marshal(in.Values)
	checks, _ := json.Marshal(in.Checks)
	if in.Checks == nil {
		checks = []byte("{}")
	}
	result, e := tx.ExecContext(ctx, `UPDATE interactive_runs SET values_json=?,checks_json=?,revision=revision+1,submitted_batch_id=?,fingerprint=? WHERE generation_id=? AND revision=? AND submitted_batch_id=''`, string(values), string(checks), batchID, input.CardFingerprint, in.GenerationID, in.Revision)
	if e != nil {
		return e
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return ErrCardConflict
	}
	return nil
}
func migrateInteractive(tx *sql.Tx) error {
	// Unreleased interactive previews used schema 28 before main reserved it for
	// project search snapshots. Preserve those previews while completing main's schema.
	projectRows, projectErr := tx.Query(`SELECT source_snapshot FROM project_source_indexes LIMIT 0`)
	if projectErr == nil {
		projectRows.Close()
	} else {
		if _, err := tx.Exec(`ALTER TABLE project_source_indexes ADD COLUMN source_snapshot TEXT`); err != nil {
			return err
		}
	}
	rows, e := tx.Query(`SELECT interactive FROM generation_batches LIMIT 0`)
	migration := interactiveMigration
	if e == nil {
		rows.Close()
		migration = strings.Replace(migration, "ALTER TABLE generation_batches ADD COLUMN interactive INTEGER NOT NULL DEFAULT 0;", "", 1)
	}
	_, e = tx.Exec(migration)
	return e
}
