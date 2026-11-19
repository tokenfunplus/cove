package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const debateMigration = `
CREATE TABLE debate_sessions (
 id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
 client_request_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL,
 record TEXT NOT NULL
);
CREATE UNIQUE INDEX one_running_debate ON debate_sessions((1)) WHERE status IN ('running', 'pausing');
CREATE TABLE debate_turns (
 id TEXT PRIMARY KEY,
 debate_id TEXT NOT NULL REFERENCES debate_sessions(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL,
 record TEXT NOT NULL,
 UNIQUE(debate_id, sequence)
);
CREATE TABLE debate_interventions (
 id TEXT PRIMARY KEY,
 debate_id TEXT NOT NULL REFERENCES debate_sessions(id) ON DELETE CASCADE,
 client_request_id TEXT NOT NULL,
 applied_round INTEGER NOT NULL DEFAULT 0,
 record TEXT NOT NULL,
 UNIQUE(debate_id, client_request_id)
);
PRAGMA user_version = 20;
`

// Debate records are separate from ordinary comparison context and Selected Answers.
type DebateRules struct {
	Version         int    `json:"version"`
	Text            string `json:"text"`
	MaxTokens       int    `json:"max_tokens"`
	CheckpointEvery int    `json:"checkpoint_every"`
	Rotate          bool   `json:"rotate"`
}

type DebateSeat struct {
	ProviderID string `json:"provider_id"`
	ModelID    string `json:"model_id"`
	Role       string `json:"role"`
}

type DebateRate struct {
	InputPerMillion  *float64 `json:"input_per_million,omitempty"`
	OutputPerMillion *float64 `json:"output_per_million,omitempty"`
}

type DebateControls struct {
	Version       int          `json:"version"`
	SummaryEvery  int          `json:"summary_every"`
	SummarySeat   int          `json:"summary_seat"`
	TurnDelayMS   *int64       `json:"turn_delay_ms,omitempty"`
	TokenBudget   *int64       `json:"token_budget,omitempty"`
	CostBudgetUSD *float64     `json:"cost_budget_usd,omitempty"`
	AutoPause     bool         `json:"auto_pause"`
	Rates         []DebateRate `json:"rates,omitempty"`
}

type DebateSummaryReference struct {
	TurnID   string `json:"turn_id"`
	Sequence int64  `json:"sequence"`
	Seat     int    `json:"seat"`
}

type DebateSummaryPoint struct {
	Text    string                   `json:"text"`
	Sources []DebateSummaryReference `json:"sources"`
}

type DebateStageSummary struct {
	TurnID          string               `json:"turn_id"`
	FromRound       int                  `json:"from_round"`
	ThroughRound    int                  `json:"through_round"`
	Seat            int                  `json:"seat"`
	NewIdeas        []DebateSummaryPoint `json:"new_ideas"`
	PositionChanges []DebateSummaryPoint `json:"position_changes"`
	OpenQuestions   []DebateSummaryPoint `json:"open_questions"`
	CreatedAt       time.Time            `json:"created_at"`
}

type DebateSeatUsage struct {
	Seat              int   `json:"seat"`
	Calls             int64 `json:"calls"`
	SummaryCalls      int64 `json:"summary_calls"`
	ActiveCalls       int64 `json:"active_calls"`
	InputTokens       int64 `json:"input_tokens"`
	OutputTokens      int64 `json:"output_tokens"`
	MissingUsageCalls int64 `json:"missing_usage_calls"`
}

type DebateUsage struct {
	Calls             int64   `json:"calls"`
	SummaryCalls      int64   `json:"summary_calls"`
	ActiveCalls       int64   `json:"active_calls"`
	InputTokens       int64   `json:"input_tokens"`
	OutputTokens      int64   `json:"output_tokens"`
	MissingUsageCalls int64   `json:"missing_usage_calls"`
	UnpricedCalls     int64   `json:"unpriced_calls"`
	EstimatedCostUSD  float64 `json:"estimated_cost_usd"`
	CostComplete      bool    `json:"cost_complete"`
	BudgetStatus      string  `json:"budget_status,omitempty"`
}

type DebatePosition struct {
	TurnID   string `json:"turn_id"`
	Sequence int64  `json:"sequence"`
	Seat     int    `json:"seat"`
	Body     string `json:"body"`
}

// Checkpoints contain attributed answer excerpts, never an inferred truth score.
type DebateCheckpoint struct {
	Round     int              `json:"round"`
	Positions []DebatePosition `json:"positions"`
	CreatedAt time.Time        `json:"created_at"`
}

type DebateSession struct {
	ID               string              `json:"id"`
	ClientRequestID  string              `json:"client_request_id"`
	Topic            string              `json:"topic"`
	Seats            []DebateSeat        `json:"seats"`
	Rules            DebateRules         `json:"rules"`
	PendingRules     *DebateRules        `json:"pending_rules,omitempty"`
	Status           string              `json:"status"`
	Round            int                 `json:"round"`
	Position         int                 `json:"position"`
	OpeningDone      []bool              `json:"opening_done"`
	TotalTurns       int64               `json:"total_turns"`
	BrowserRequired  bool                `json:"browser_required,omitempty"`
	Checkpoint       *DebateCheckpoint   `json:"checkpoint,omitempty"`
	Controls         DebateControls      `json:"controls"`
	LastSummaryRound int                 `json:"last_summary_round,omitempty"`
	Summary          *DebateStageSummary `json:"summary,omitempty"`
	NextTurnAt       *time.Time          `json:"next_turn_at,omitempty"`
	Notice           string              `json:"notice,omitempty"`
	CreatedAt        time.Time           `json:"created_at"`
	UpdatedAt        time.Time           `json:"updated_at"`
}

type DebateContextMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type DebateTurn struct {
	ID               string                          `json:"id"`
	DebateID         string                          `json:"debate_id"`
	Sequence         int64                           `json:"sequence"`
	Round            int                             `json:"round"`
	Seat             int                             `json:"seat"`
	Role             string                          `json:"role"`
	RuleVersion      int                             `json:"rule_version"`
	State            string                          `json:"state"`
	Kind             string                          `json:"kind,omitempty"`
	UsageExpected    bool                            `json:"usage_expected"`
	Summary          *DebateStageSummary             `json:"summary,omitempty"`
	SummaryFromRound int                             `json:"summary_from_round,omitempty"`
	Execution        string                          `json:"execution,omitempty"`
	Phase            string                          `json:"phase,omitempty"`
	Verification     *GenerationVerification         `json:"verification,omitempty"`
	Body             string                          `json:"body"`
	Reasoning        string                          `json:"reasoning,omitempty"`
	Snapshot         ProviderSnapshot                `json:"snapshot"`
	Configuration    GenerationConfigurationSnapshot `json:"configuration"`
	Context          []DebateContextMessage          `json:"-"`
	ContextIDs       []string                        `json:"context_ids"`
	Metrics          *GenerationMetrics              `json:"metrics,omitempty"`
	ErrorCode        string                          `json:"error_code,omitempty"`
	ErrorMessage     string                          `json:"error_message,omitempty"`
	CreatedAt        time.Time                       `json:"created_at"`
	UpdatedAt        time.Time                       `json:"updated_at"`
}

// Keep immutable request context on disk, but do not repeat it in every read response.
type storedDebateTurn struct {
	DebateTurn
	Messages []DebateContextMessage `json:"messages"`
}

type DebateIntervention struct {
	ID              string    `json:"id"`
	ClientRequestID string    `json:"client_request_id"`
	Body            string    `json:"body"`
	AppliedRound    int       `json:"applied_round"`
	CreatedAt       time.Time `json:"created_at"`
}

type DebateView struct {
	ContextTurns  []DebateTurn         `json:"-"`
	Session       DebateSession        `json:"session"`
	Turns         []DebateTurn         `json:"turns"`
	Interventions []DebateIntervention `json:"interventions"`
	HasMore       bool                 `json:"has_more"`
	Usage         *DebateUsage         `json:"usage,omitempty"`
}

type DebateStore interface {
	ReadDebateUsage(context.Context, string) ([]DebateSeatUsage, error)
	LoadDebateSummaryContext(context.Context, string, int, int) ([]DebateTurn, error)
	LoadDebateContext(context.Context, string) ([]DebateTurn, error)
	CreateDebate(context.Context, DebateSession) (DebateSession, error)
	FindDebateRequest(context.Context, string) (DebateSession, error)
	GetDebate(context.Context, string) (DebateSession, error)
	SaveDebate(context.Context, DebateSession) error
	ReadDebate(context.Context, string, int64) (DebateView, error)
	BeginDebateTurn(context.Context, DebateTurn) (DebateTurn, error)
	SaveDebateTurn(context.Context, DebateTurn) error
	FinishDebateTurn(context.Context, DebateTurn, DebateSession) error
	ReadDebateTurn(context.Context, string, string) (DebateTurn, error)
	AddDebateIntervention(context.Context, string, DebateIntervention) (DebateIntervention, error)
	FindDebateIntervention(context.Context, string, string) (DebateIntervention, error)
	InterruptDebate(context.Context, string, string) error
	AdvanceDebateRound(context.Context, DebateSession) (DebateSession, error)
}

func (store *SQLiteStore) CreateDebate(ctx context.Context, session DebateSession) (DebateSession, error) {
	id, err := newID()
	if err != nil {
		return DebateSession{}, err
	}
	session.ID, session.CreatedAt, session.UpdatedAt = id, time.Now().UTC(), time.Now().UTC()
	data, err := json.Marshal(session)
	if err != nil {
		return DebateSession{}, err
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return DebateSession{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT INTO conversations(id,title,created_at,updated_at) VALUES(?,?,?,?)`, id, conversationTitleFromMessage(session.Topic), session.CreatedAt.UnixNano(), session.UpdatedAt.UnixNano()); err != nil {
		return DebateSession{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO debate_sessions(id,client_request_id,status,record) VALUES(?,?,?,?)`, id, session.ClientRequestID, session.Status, string(data)); err != nil {
		return DebateSession{}, err
	}
	return session, tx.Commit()
}

func (store *SQLiteStore) FindDebateRequest(ctx context.Context, requestID string) (DebateSession, error) {
	return scanDebate(store.db.QueryRowContext(ctx, `SELECT record FROM debate_sessions WHERE client_request_id=?`, requestID))
}

func scanDebate(row rowScanner) (DebateSession, error) {
	var data string
	if err := row.Scan(&data); err != nil {
		return DebateSession{}, err
	}
	var session DebateSession
	err := json.Unmarshal([]byte(data), &session)
	return session, err
}

func (store *SQLiteStore) GetDebate(ctx context.Context, id string) (DebateSession, error) {
	return scanDebate(store.db.QueryRowContext(ctx, `SELECT record FROM debate_sessions WHERE id=?`, id))
}

func saveDebateTx(ctx context.Context, tx *sql.Tx, session DebateSession) error {
	session.UpdatedAt = time.Now().UTC()
	data, err := json.Marshal(session)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `UPDATE debate_sessions SET status=?, record=? WHERE id=?`, session.Status, string(data), session.ID)
	if err != nil {
		return err
	}
	if count, err := result.RowsAffected(); err != nil {
		return err
	} else if count != 1 {
		return sql.ErrNoRows
	}
	_, err = tx.ExecContext(ctx, `UPDATE conversations SET updated_at=? WHERE id=?`, session.UpdatedAt.UnixNano(), session.ID)
	return err
}

func (store *SQLiteStore) SaveDebate(ctx context.Context, session DebateSession) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := saveDebateTx(ctx, tx, session); err != nil {
		return err
	}
	return tx.Commit()
}

func decodeDebateTurn(data string) (DebateTurn, error) {
	var stored storedDebateTurn
	err := json.Unmarshal([]byte(data), &stored)
	stored.Context = stored.Messages
	return stored.DebateTurn, err
}

func (store *SQLiteStore) ReadDebate(ctx context.Context, id string, before int64) (DebateView, error) {
	session, err := store.GetDebate(ctx, id)
	if err != nil {
		return DebateView{}, err
	}
	view := DebateView{Session: session, Turns: []DebateTurn{}, Interventions: []DebateIntervention{}}
	rows, err := store.db.QueryContext(ctx, `SELECT json_remove(record,'$.messages','$.verification.evidence','$.verification.signature','$.verification.signed_message') FROM debate_turns WHERE debate_id=? AND (?=0 OR sequence<?) ORDER BY sequence DESC LIMIT 50`, id, before, before)
	if err != nil {
		return view, err
	}
	for rows.Next() {
		var data string
		if err = rows.Scan(&data); err != nil {
			break
		}
		var turn DebateTurn
		turn, err = decodeDebateTurn(data)
		if err != nil {
			break
		}
		view.Turns = append(view.Turns, turn)
	}
	rowErr := rows.Err()
	rows.Close()
	if err != nil {
		return view, err
	}
	if rowErr != nil {
		return view, rowErr
	}
	for i, j := 0, len(view.Turns)-1; i < j; i, j = i+1, j-1 {
		view.Turns[i], view.Turns[j] = view.Turns[j], view.Turns[i]
	}
	if len(view.Turns) > 0 {
		view.HasMore = view.Turns[0].Sequence > 1
	}
	rows, err = store.db.QueryContext(ctx, `SELECT record,applied_round FROM debate_interventions WHERE debate_id=? ORDER BY rowid DESC LIMIT 64`, id)
	if err != nil {
		return view, err
	}
	defer rows.Close()
	for rows.Next() {
		var data string
		var round int
		var intervention DebateIntervention
		if err := rows.Scan(&data, &round); err != nil {
			return view, err
		}
		if err := json.Unmarshal([]byte(data), &intervention); err != nil {
			return view, err
		}
		intervention.AppliedRound = round
		view.Interventions = append(view.Interventions, intervention)
	}
	return view, rows.Err()
}

func (store *SQLiteStore) BeginDebateTurn(ctx context.Context, turn DebateTurn) (DebateTurn, error) {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return turn, err
	}
	defer tx.Rollback()
	turn.ID, err = newID()
	if err != nil {
		return turn, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(sequence),0)+1 FROM debate_turns WHERE debate_id=?`, turn.DebateID).Scan(&turn.Sequence); err != nil {
		return turn, err
	}
	turn.CreatedAt, turn.UpdatedAt = time.Now().UTC(), time.Now().UTC()
	data, err := json.Marshal(storedDebateTurn{DebateTurn: turn, Messages: turn.Context})
	if err != nil {
		return turn, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO debate_turns(id,debate_id,sequence,record) VALUES(?,?,?,?)`, turn.ID, turn.DebateID, turn.Sequence, string(data))
	if err != nil {
		return turn, err
	}
	return turn, tx.Commit()
}

func (store *SQLiteStore) SaveDebateTurn(ctx context.Context, turn DebateTurn) error {
	turn.UpdatedAt = time.Now().UTC()
	data, err := json.Marshal(storedDebateTurn{DebateTurn: turn, Messages: turn.Context})
	if err != nil {
		return err
	}
	result, err := store.db.ExecContext(ctx, `UPDATE debate_turns SET record=? WHERE id=? AND debate_id=?`, string(data), turn.ID, turn.DebateID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count != 1 {
		return sql.ErrNoRows
	}
	return err
}

func (store *SQLiteStore) FinishDebateTurn(ctx context.Context, turn DebateTurn, session DebateSession) error {
	if err := validateGenerationMetrics(turn.Metrics); err != nil {
		return err
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	turn.UpdatedAt = time.Now().UTC()
	data, err := json.Marshal(storedDebateTurn{DebateTurn: turn, Messages: turn.Context})
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE debate_turns SET record=? WHERE id=? AND debate_id=?`, string(data), turn.ID, turn.DebateID); err != nil {
		return err
	}
	if err = saveDebateTx(ctx, tx, session); err != nil {
		return err
	}
	return tx.Commit()
}

func (store *SQLiteStore) ReadDebateTurn(ctx context.Context, id, turnID string) (DebateTurn, error) {
	var data string
	if err := store.db.QueryRowContext(ctx, `SELECT record FROM debate_turns WHERE debate_id=? AND id=?`, id, turnID).Scan(&data); err != nil {
		return DebateTurn{}, err
	}
	return decodeDebateTurn(data)
}

func (store *SQLiteStore) AddDebateIntervention(ctx context.Context, id string, input DebateIntervention) (DebateIntervention, error) {
	existing, err := store.FindDebateIntervention(ctx, id, input.ClientRequestID)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return input, err
	}
	input.ID, err = newID()
	if err != nil {
		return input, err
	}
	input.CreatedAt = time.Now().UTC()
	payload, err := json.Marshal(input)
	if err != nil {
		return input, err
	}
	_, err = store.db.ExecContext(ctx, `INSERT INTO debate_interventions(id,debate_id,client_request_id,record) VALUES(?,?,?,?)`, input.ID, id, input.ClientRequestID, string(payload))
	return input, err
}

func (store *SQLiteStore) FindDebateIntervention(ctx context.Context, id, requestID string) (DebateIntervention, error) {
	var input DebateIntervention
	var data string
	var round int
	err := store.db.QueryRowContext(ctx, `SELECT record,applied_round FROM debate_interventions WHERE debate_id=? AND client_request_id=?`, id, requestID).Scan(&data, &round)
	if err == nil {
		err = json.Unmarshal([]byte(data), &input)
		input.AppliedRound = round
		return input, err
	}
	return input, err
}

// Reconcile abandoned turns against the committed cursor, never an unsaved answer.
func (store *SQLiteStore) InterruptDebate(ctx context.Context, id, notice string) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE debate_turns SET record=json_set(json_remove(record,'$.verification','$.metrics'),'$.state',CASE WHEN (SELECT status FROM debate_sessions WHERE id=?)='stopped' THEN 'stopped' ELSE 'failed' END,'$.body','','$.reasoning','','$.error_code','interrupted','$.error_message','The turn was interrupted before completion.') WHERE debate_id=? AND json_extract(record,'$.state')='streaming'`, id, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE debate_sessions SET status='paused',record=json_set(record,'$.status','paused','$.notice',?) WHERE id=? AND status!='stopped'`, notice, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (store *SQLiteStore) AdvanceDebateRound(ctx context.Context, session DebateSession) (DebateSession, error) {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return session, err
	}
	defer tx.Rollback()
	session.Round++
	session.Position = 0
	if session.PendingRules != nil {
		session.Rules = *session.PendingRules
		session.PendingRules = nil
	}
	if _, err = tx.ExecContext(ctx, `UPDATE debate_interventions SET applied_round=? WHERE debate_id=? AND applied_round=0`, session.Round, session.ID); err != nil {
		return session, err
	}
	if err = saveDebateTx(ctx, tx, session); err != nil {
		return session, err
	}
	return session, tx.Commit()
}

func recoverDebatesTx(ctx context.Context, tx *sql.Tx) error {
	// JSON state and indexed state change together in the same recovery transaction.
	_, err := tx.ExecContext(ctx, `UPDATE debate_sessions SET status='paused',record=json_set(record,'$.status','paused','$.notice','The Local Service restarted. Resume to continue.') WHERE status IN ('running','pausing')`)
	if err != nil {
		return fmt.Errorf("recover debate sessions: %w", err)
	}
	_, err = tx.ExecContext(ctx, `UPDATE debate_turns SET record=json_set(record,'$.state','failed','$.body','','$.reasoning','','$.error_code','interrupted','$.error_message','The Local Service restarted before this turn completed.') WHERE json_extract(record,'$.state')='streaming'`)
	return err
}

var _ DebateStore = (*SQLiteStore)(nil)

func (store *SQLiteStore) LoadDebateContext(ctx context.Context, id string) ([]DebateTurn, error) {
	rows, err := store.db.QueryContext(ctx, `SELECT json_remove(record,'$.messages','$.reasoning','$.verification') FROM debate_turns WHERE debate_id=? AND json_extract(record,'$.state')='completed' AND COALESCE(json_extract(record,'$.kind'),'')!='summary' ORDER BY sequence DESC LIMIT 12`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	turns := []DebateTurn{}
	for rows.Next() {
		var data string
		if err = rows.Scan(&data); err != nil {
			return nil, err
		}
		turn, err := decodeDebateTurn(data)
		if err != nil {
			return nil, err
		}
		turns = append(turns, turn)
	}
	for i, j := 0, len(turns)-1; i < j; i, j = i+1, j-1 {
		turns[i], turns[j] = turns[j], turns[i]
	}
	return turns, rows.Err()
}
