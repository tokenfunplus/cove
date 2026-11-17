package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
)

var ErrContextDispositionRequired = errors.New("each earlier Generation Batch needs a Selected Answer or context skip")
var ErrContextDispositionFrozen = errors.New("a later Generation Batch has already captured this context disposition")

func (store *SQLiteStore) BeginGenerationBatch(ctx context.Context, input BeginGenerationBatchInput) (GenerationBatch, error) {
	input.ClientRequestID = strings.TrimSpace(input.ClientRequestID)
	input.Body = strings.TrimSpace(input.Body)
	if input.ConversationID == "" || input.ClientRequestID == "" || input.Body == "" {
		return GenerationBatch{}, errors.New("generation batch conversation, client request ID, and body are required")
	}
	if len(input.Targets) == 0 || len(input.Targets) > 4 {
		return GenerationBatch{}, errors.New("a generation batch requires between one and four targets")
	}
	configuration := GenerationConfigurationSnapshot{SystemPrompt: input.SystemPrompt, GenerationParameters: input.GenerationParameters}
	if err := validateGenerationConfigurationSnapshot(configuration); err != nil {
		return GenerationBatch{}, err
	}
	seen := make(map[string]struct{}, len(input.Targets))
	for index := range input.Targets {
		target := &input.Targets[index]
		target.ProviderID = strings.TrimSpace(target.ProviderID)
		target.ModelID = strings.TrimSpace(target.ModelID)
		key := target.ProviderID + "\x00" + target.ModelID
		if target.ProviderID == "" || target.ModelID == "" || target.Snapshot.ProviderID == "" || target.Snapshot.ModelID == "" {
			return GenerationBatch{}, errors.New("generation batch targets require a provider, model, and snapshot")
		}
		if _, exists := seen[key]; exists {
			return GenerationBatch{}, errors.New("a generation batch cannot include the same target twice")
		}
		seen[key] = struct{}{}
	}

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return GenerationBatch{}, fmt.Errorf("begin generation batch: %w", err)
	}
	defer tx.Rollback()
	if existing, err := getGenerationBatchByRequestTx(ctx, tx, input.ClientRequestID); err == nil {
		if err := tx.Commit(); err != nil {
			return GenerationBatch{}, fmt.Errorf("commit idempotent generation batch: %w", err)
		}
		return store.GetGenerationBatch(ctx, existing.ID)
	} else if !errors.Is(err, sql.ErrNoRows) {
		return GenerationBatch{}, err
	}
	if input.EditOfBatchID != "" {
		branchID, err := forkConversationTx(ctx, tx, input.ConversationID, input.EditOfBatchID)
		if err != nil {
			return GenerationBatch{}, err
		}
		input.ConversationID = branchID
	}
	if err := ensureContextDispositionTx(ctx, tx, input.ConversationID); err != nil {
		return GenerationBatch{}, err
	}
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM conversations WHERE id = ?`, input.ConversationID).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return GenerationBatch{}, fmt.Errorf("conversation %q: %w", input.ConversationID, sql.ErrNoRows)
	} else if err != nil {
		return GenerationBatch{}, fmt.Errorf("check generation batch conversation: %w", err)
	}
	batchID, err := newID()
	if err != nil {
		return GenerationBatch{}, fmt.Errorf("create generation batch ID: %w", err)
	}
	userMessageID, err := newID()
	if err != nil {
		return GenerationBatch{}, fmt.Errorf("create generation batch user message ID: %w", err)
	}
	now := time.Now().UTC()
	if err := deriveConversationTitle(ctx, tx, input.ConversationID, input.Body); err != nil {
		return GenerationBatch{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO messages (id, conversation_id, role, body, provider_snapshot, created_at) VALUES (?, ?, 'user', ?, NULL, ?)`, userMessageID, input.ConversationID, input.Body, now.UnixNano()); err != nil {
		return GenerationBatch{}, fmt.Errorf("save generation batch user message: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO generation_batches (id, conversation_id, client_request_id, user_message_id, system_prompt, temperature, top_p, max_tokens, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, batchID, input.ConversationID, input.ClientRequestID, userMessageID, input.SystemPrompt, input.GenerationParameters.Temperature, input.GenerationParameters.TopP, input.GenerationParameters.MaxTokens, GenerationBatchPending, now.UnixNano(), now.UnixNano()); err != nil {
		return GenerationBatch{}, fmt.Errorf("save generation batch: %w", err)
	}
	if len(input.Attachments) > 0 {
		snapshots := make([]documents.Snapshot, 0, len(input.Attachments))
		data := make([][]byte, 0, len(input.Attachments))
		for _, attachment := range input.Attachments {
			snapshots = append(snapshots, attachment.Snapshot)
			data = append(data, attachment.Data)
		}
		metadata, err := json.Marshal(snapshots)
		if err != nil {
			return GenerationBatch{}, err
		}
		originals, err := json.Marshal(data)
		if err != nil {
			return GenerationBatch{}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE generation_batches SET input_content = ?, attachments = ?, attachment_data = ? WHERE id = ?`, input.InputContent, string(metadata), string(originals), batchID); err != nil {
			return GenerationBatch{}, fmt.Errorf("save attachment snapshots: %w", err)
		}
	}
	if err := saveContextItemsTx(ctx, tx, batchID, input.ConversationID); err != nil {
		return GenerationBatch{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE generation_batches SET context_frozen = 1 WHERE conversation_id = ? AND id != ?`, input.ConversationID, batchID); err != nil {
		return GenerationBatch{}, fmt.Errorf("freeze earlier generation batch dispositions: %w", err)
	}
	for position, inputTarget := range input.Targets {
		targetID, err := newID()
		if err != nil {
			return GenerationBatch{}, fmt.Errorf("create generation target ID: %w", err)
		}
		generationID, err := newID()
		if err != nil {
			return GenerationBatch{}, fmt.Errorf("create generation ID: %w", err)
		}
		snapshot, err := json.Marshal(inputTarget.Snapshot)
		if err != nil {
			return GenerationBatch{}, fmt.Errorf("encode generation snapshot: %w", err)
		}
		requestID := input.ClientRequestID + ":" + targetID
		if _, err := tx.ExecContext(ctx, `INSERT INTO generation_targets (id, generation_batch_id, provider_id, model_id, position, latest_generation_id) VALUES (?, ?, ?, ?, ?, ?)`, targetID, batchID, inputTarget.ProviderID, inputTarget.ModelID, position, generationID); err != nil {
			return GenerationBatch{}, fmt.Errorf("save generation target: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO generations (id, conversation_id, client_request_id, user_message_id, state, provider_snapshot, system_prompt, temperature, top_p, max_tokens, created_at, updated_at, generation_batch_id, generation_target_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, generationID, input.ConversationID, requestID, userMessageID, GenerationPending, snapshot, configuration.SystemPrompt, configuration.Temperature, configuration.TopP, configuration.MaxTokens, now.UnixNano(), now.UnixNano(), batchID, targetID); err != nil {
			return GenerationBatch{}, fmt.Errorf("save target generation: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE conversations SET updated_at = ? WHERE id = ?`, now.UnixNano(), input.ConversationID); err != nil {
		return GenerationBatch{}, fmt.Errorf("update generation batch conversation timestamp: %w", err)
	}
	batch, err := getGenerationBatch(ctx, tx, batchID)
	if err != nil {
		return GenerationBatch{}, err
	}
	batch.ContextItems, err = loadGenerationBatchContext(ctx, tx, batchID)
	if err != nil {
		return GenerationBatch{}, err
	}
	if err := tx.Commit(); err != nil {
		return GenerationBatch{}, fmt.Errorf("commit generation batch: %w", err)
	}
	return batch, nil
}

func (store *SQLiteStore) GetGenerationBatch(ctx context.Context, id string) (GenerationBatch, error) {
	return getGenerationBatch(ctx, store.db, id)
}

type batchReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func getGenerationBatch(ctx context.Context, db batchReader, id string) (GenerationBatch, error) {
	row := db.QueryRowContext(ctx, `SELECT id, conversation_id, client_request_id, user_message_id, system_prompt, temperature, top_p, max_tokens, state, selected_generation_id, context_skipped, context_frozen, created_at, updated_at, input_content, attachments FROM generation_batches WHERE id = ?`, id)
	batch, err := scanGenerationBatch(row)
	if errors.Is(err, sql.ErrNoRows) {
		return GenerationBatch{}, fmt.Errorf("generation batch %q: %w", id, sql.ErrNoRows)
	}
	if err != nil {
		return GenerationBatch{}, fmt.Errorf("get generation batch: %w", err)
	}
	return populateGenerationBatchTargets(ctx, db, batch)
}

func (store *SQLiteStore) GetGenerationBatchByClientRequestID(ctx context.Context, clientRequestID string) (GenerationBatch, error) {
	row := store.db.QueryRowContext(ctx, `SELECT id, conversation_id, client_request_id, user_message_id, system_prompt, temperature, top_p, max_tokens, state, selected_generation_id, context_skipped, context_frozen, created_at, updated_at, input_content, attachments FROM generation_batches WHERE client_request_id = ?`, strings.TrimSpace(clientRequestID))
	batch, err := scanGenerationBatch(row)
	if errors.Is(err, sql.ErrNoRows) {
		return GenerationBatch{}, fmt.Errorf("generation batch request %q: %w", clientRequestID, sql.ErrNoRows)
	}
	if err != nil {
		return GenerationBatch{}, fmt.Errorf("get generation batch by client request ID: %w", err)
	}
	return populateGenerationBatchTargets(ctx, store.db, batch)
}

func populateGenerationBatchTargets(ctx context.Context, db batchReader, batch GenerationBatch) (GenerationBatch, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, generation_batch_id, provider_id, model_id, position, latest_generation_id FROM generation_targets WHERE generation_batch_id = ? ORDER BY position ASC`, batch.ID)
	if err != nil {
		return GenerationBatch{}, fmt.Errorf("list generation targets: %w", err)
	}
	defer rows.Close()
	type pendingTarget struct {
		target       GenerationTarget
		generationID string
	}
	pending := make([]pendingTarget, 0)
	for rows.Next() {
		var target GenerationTarget
		var generationID string
		if err := rows.Scan(&target.ID, &target.BatchID, &target.ProviderID, &target.ModelID, &target.Position, &generationID); err != nil {
			return GenerationBatch{}, fmt.Errorf("scan generation target: %w", err)
		}
		pending = append(pending, pendingTarget{target: target, generationID: generationID})
	}
	if err := rows.Err(); err != nil {
		return GenerationBatch{}, fmt.Errorf("iterate generation targets: %w", err)
	}
	if err := rows.Close(); err != nil {
		return GenerationBatch{}, fmt.Errorf("close generation targets: %w", err)
	}
	batch.Targets = make([]GenerationTarget, 0, len(pending))
	var selected Generation
	for _, item := range pending {
		generation, err := scanGeneration(db.QueryRowContext(ctx, generationQuery+` WHERE id = ?`, item.generationID))
		if err != nil {
			return GenerationBatch{}, fmt.Errorf("load target generation: %w", err)
		}
		item.target.Generation = generation
		if generation.ID == batch.SelectedGenerationID {
			selected = generation
		}
		batch.Targets = append(batch.Targets, item.target)
	}
	if batch.SelectedGenerationID != "" {
		if selected.ID == "" {
			selected, err = scanGeneration(db.QueryRowContext(ctx, generationQuery+` WHERE id = ?`, batch.SelectedGenerationID))
			if err != nil {
				return GenerationBatch{}, fmt.Errorf("load selected answer: %w", err)
			}
		}
		batch.SelectedAnswer = &SelectedAnswer{
			GenerationID: selected.ID, AssistantMessageID: selected.AssistantMessageID,
			ProviderName: selected.Snapshot.ProviderName, ModelID: selected.Snapshot.ModelID,
		}
	}
	return batch, nil
}

func (store *SQLiteStore) GetGenerationTarget(ctx context.Context, id string) (GenerationTarget, error) {
	row := store.db.QueryRowContext(ctx, `SELECT id, generation_batch_id, provider_id, model_id, position, latest_generation_id FROM generation_targets WHERE id = ?`, id)
	var target GenerationTarget
	var generationID string
	if err := row.Scan(&target.ID, &target.BatchID, &target.ProviderID, &target.ModelID, &target.Position, &generationID); errors.Is(err, sql.ErrNoRows) {
		return GenerationTarget{}, fmt.Errorf("generation target %q: %w", id, sql.ErrNoRows)
	} else if err != nil {
		return GenerationTarget{}, fmt.Errorf("get generation target: %w", err)
	}
	generation, err := store.GetGeneration(ctx, generationID)
	if err != nil {
		return GenerationTarget{}, err
	}
	target.Generation = generation
	return target, nil
}

func (store *SQLiteStore) BeginGenerationAttempt(ctx context.Context, input BeginGenerationAttemptInput) (Generation, error) {
	input.TargetID = strings.TrimSpace(input.TargetID)
	input.ClientRequestID = strings.TrimSpace(input.ClientRequestID)
	if input.TargetID == "" || input.ClientRequestID == "" || input.Snapshot.ProviderID == "" || input.Snapshot.ModelID == "" {
		return Generation{}, errors.New("generation attempt target, request ID, and snapshot are required")
	}
	if err := validateGenerationConfigurationSnapshot(input.ConfigurationSnapshot); err != nil {
		return Generation{}, err
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return Generation{}, fmt.Errorf("begin generation attempt: %w", err)
	}
	defer tx.Rollback()
	var targetID, batchID, providerID, modelID, userMessageID, latestID string
	if err := tx.QueryRowContext(ctx, `SELECT t.id, t.generation_batch_id, t.provider_id, t.model_id, b.user_message_id, t.latest_generation_id FROM generation_targets t JOIN generation_batches b ON b.id = t.generation_batch_id WHERE t.id = ?`, input.TargetID).Scan(&targetID, &batchID, &providerID, &modelID, &userMessageID, &latestID); errors.Is(err, sql.ErrNoRows) {
		return Generation{}, fmt.Errorf("generation target %q: %w", input.TargetID, sql.ErrNoRows)
	} else if err != nil {
		return Generation{}, fmt.Errorf("load generation target for retry: %w", err)
	}
	if existing, err := getGenerationTx(ctx, tx, input.ClientRequestID); err == nil {
		if existing.GenerationTargetID != targetID {
			return Generation{}, errors.New("generation retry request ID belongs to another target")
		}
		if err := tx.Commit(); err != nil {
			return Generation{}, fmt.Errorf("commit idempotent generation attempt: %w", err)
		}
		return existing, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Generation{}, err
	}
	latest, err := getGenerationByIDTx(ctx, tx, latestID)
	if err != nil {
		return Generation{}, err
	}
	if !isTerminalGenerationState(latest.State) {
		return Generation{}, errors.New("generation target is still active")
	}
	generationID, err := newID()
	if err != nil {
		return Generation{}, fmt.Errorf("create retry generation ID: %w", err)
	}
	snapshot, err := json.Marshal(input.Snapshot)
	if err != nil {
		return Generation{}, fmt.Errorf("encode retry snapshot: %w", err)
	}
	now := time.Now().UTC()
	generation := Generation{ID: generationID, GenerationBatchID: batchID, GenerationTargetID: targetID, ConversationID: latest.ConversationID, ClientRequestID: input.ClientRequestID, UserMessageID: userMessageID, State: GenerationPending, Snapshot: input.Snapshot, ConfigurationSnapshot: input.ConfigurationSnapshot, CreatedAt: now, UpdatedAt: now}
	if input.Failure != nil {
		generation.State = GenerationFailed
		generation.ErrorCode = input.Failure.Code
		generation.ErrorMessage = input.Failure.Message
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO generations (id, conversation_id, client_request_id, user_message_id, state, provider_snapshot, system_prompt, temperature, top_p, max_tokens, created_at, updated_at, generation_batch_id, generation_target_id, error_code, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''))`, generation.ID, generation.ConversationID, generation.ClientRequestID, generation.UserMessageID, generation.State, snapshot, generation.ConfigurationSnapshot.SystemPrompt, generation.ConfigurationSnapshot.Temperature, generation.ConfigurationSnapshot.TopP, generation.ConfigurationSnapshot.MaxTokens, now.UnixNano(), now.UnixNano(), batchID, targetID, generation.ErrorCode, generation.ErrorMessage); err != nil {
		return Generation{}, fmt.Errorf("save retry generation: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE generation_targets SET latest_generation_id = ? WHERE id = ?`, generation.ID, targetID); err != nil {
		return Generation{}, fmt.Errorf("update retry generation target: %w", err)
	}
	if err := refreshGenerationBatchTx(ctx, tx, batchID); err != nil {
		return Generation{}, err
	}
	if err := tx.Commit(); err != nil {
		return Generation{}, fmt.Errorf("commit generation attempt: %w", err)
	}
	return generation, nil
}

func (store *SQLiteStore) SelectGenerationAnswer(ctx context.Context, generationID string) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin answer selection: %w", err)
	}
	defer tx.Rollback()
	generation, err := getGenerationByIDTx(ctx, tx, generationID)
	if err != nil {
		return err
	}
	if generation.GenerationBatchID == "" || !generationSelectable(generation) {
		return errors.New("only a completed batch generation can be selected")
	}
	if generation.GenerationTargetID != "" {
		var latestID string
		if err := tx.QueryRowContext(ctx, `SELECT latest_generation_id FROM generation_targets WHERE id = ?`, generation.GenerationTargetID).Scan(&latestID); err != nil {
			return err
		}
		if latestID != generation.ID {
			return errors.New("only the latest Generation attempt can be selected")
		}
	}
	var frozen bool
	if err := tx.QueryRowContext(ctx, `SELECT context_frozen FROM generation_batches WHERE id = ?`, generation.GenerationBatchID).Scan(&frozen); err != nil {
		return err
	}
	if frozen {
		return ErrContextDispositionFrozen
	}
	result, err := tx.ExecContext(ctx, `UPDATE generation_batches SET selected_generation_id = ?, context_skipped = 0, updated_at = ?
WHERE id = ? AND context_frozen = 0 AND (? = '' OR EXISTS (
  SELECT 1 FROM generation_targets WHERE id = ? AND latest_generation_id = ?
))`, generation.ID, time.Now().UTC().UnixNano(), generation.GenerationBatchID, generation.GenerationTargetID, generation.GenerationTargetID, generation.ID)
	if err != nil {
		return fmt.Errorf("select generation answer: %w", err)
	}
	if count, err := result.RowsAffected(); err != nil || count != 1 {
		return fmt.Errorf("select generation answer: %w", sql.ErrNoRows)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit answer selection: %w", err)
	}
	return nil
}

func (store *SQLiteStore) SkipGenerationBatchContext(ctx context.Context, batchID string) error {
	batch, err := store.GetGenerationBatch(ctx, batchID)
	if err != nil {
		return err
	}
	if !isTerminalBatchState(batch.State) {
		return errors.New("an active generation batch cannot be context-skipped")
	}
	if batch.ContextFrozen {
		return ErrContextDispositionFrozen
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE generation_batches SET selected_generation_id = NULL, context_skipped = 1, updated_at = ? WHERE id = ?`, time.Now().UTC().UnixNano(), batch.ID); err != nil {
		return fmt.Errorf("skip generation batch context: %w", err)
	}
	return nil
}

func (store *SQLiteStore) LoadBatchContext(ctx context.Context, conversationID string) ([]ContextItem, error) {
	rows, err := store.db.QueryContext(ctx, `
SELECT b.user_message_id, b.selected_generation_id, COALESCE(NULLIF(b.input_content, ''), user_message.body), assistant_message.body
FROM generation_batches b
JOIN messages user_message ON user_message.id = b.user_message_id
JOIN generations selected_generation ON selected_generation.id = b.selected_generation_id
JOIN messages assistant_message ON assistant_message.id = selected_generation.assistant_message_id
WHERE b.conversation_id = ? AND b.context_skipped = 0 AND b.selected_generation_id IS NOT NULL
ORDER BY b.created_at ASC, b.id ASC`, conversationID)
	if err != nil {
		return nil, fmt.Errorf("load batch context: %w", err)
	}
	defer rows.Close()
	items := make([]ContextItem, 0)
	for rows.Next() {
		var item ContextItem
		if err := rows.Scan(&item.UserMessageID, &item.SelectedGenerationID, &item.UserBody, &item.AssistantBody); err != nil {
			return nil, fmt.Errorf("scan batch context: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *SQLiteStore) LoadGenerationBatchContext(ctx context.Context, batchID string) ([]ContextItem, error) {
	return loadGenerationBatchContext(ctx, store.db, batchID)
}

func loadGenerationBatchContext(ctx context.Context, db batchReader, batchID string) ([]ContextItem, error) {
	rows, err := db.QueryContext(ctx, `
SELECT item.user_message_id, item.selected_generation_id, COALESCE(NULLIF(source_batch.input_content, ''), user_message.body), assistant_message.body
FROM batch_context_items item
JOIN messages user_message ON user_message.id = item.user_message_id
LEFT JOIN generation_batches source_batch ON source_batch.user_message_id = item.user_message_id
JOIN generations selected_generation ON selected_generation.id = item.selected_generation_id
JOIN messages assistant_message ON assistant_message.id = selected_generation.assistant_message_id
WHERE item.generation_batch_id = ?
ORDER BY item.position ASC`, batchID)
	if err != nil {
		return nil, fmt.Errorf("load saved generation batch context: %w", err)
	}
	defer rows.Close()
	items := make([]ContextItem, 0)
	for rows.Next() {
		var item ContextItem
		if err := rows.Scan(&item.UserMessageID, &item.SelectedGenerationID, &item.UserBody, &item.AssistantBody); err != nil {
			return nil, fmt.Errorf("scan saved generation batch context: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func refreshGenerationBatchTx(ctx context.Context, tx *sql.Tx, batchID string) error {
	if batchID == "" {
		return nil
	}
	batch, err := getGenerationBatch(ctx, tx, batchID)
	if err != nil {
		return err
	}
	state := deriveGenerationBatchState(batch.Targets)
	selectedID := ""
	if len(batch.Targets) == 1 && generationSelectable(batch.Targets[0].Generation) && batch.SelectedGenerationID == "" && !batch.ContextFrozen {
		selectedID = batch.Targets[0].Generation.ID
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE generation_batches SET state = ?,
  selected_generation_id = COALESCE(NULLIF(?, ''), selected_generation_id),
  context_skipped = CASE WHEN ? != '' THEN 0 ELSE context_skipped END,
  updated_at = ? WHERE id = ?`, state, selectedID, selectedID, time.Now().UTC().UnixNano(), batch.ID); err != nil {
		return fmt.Errorf("refresh generation batch: %w", err)
	}
	return nil
}

func generationSelectable(generation Generation) bool {
	if generation.State != GenerationCompleted {
		return false
	}
	if generation.Snapshot.IsNearAI() {
		return generation.Verification.Status == VerificationModel && generation.AssistantMessageID != ""
	}
	return generation.AssistantMessageID != ""
}

func deriveGenerationBatchState(targets []GenerationTarget) GenerationBatchState {
	if len(targets) == 0 {
		return GenerationBatchPending
	}
	states := make(map[GenerationState]int)
	for _, target := range targets {
		states[target.Generation.State]++
	}
	if states[GenerationVerifyingEnvironment] > 0 {
		return GenerationBatchPending
	}
	if states[GenerationStreaming] > 0 || states[GenerationVerifyingResponse] > 0 {
		return GenerationBatchStreaming
	}
	if states[GenerationPending] > 0 {
		return GenerationBatchPending
	}
	if states[GenerationCompleted] == len(targets) {
		return GenerationBatchCompleted
	}
	if states[GenerationFailed] == len(targets) {
		return GenerationBatchFailed
	}
	if states[GenerationStopped] == len(targets) {
		return GenerationBatchStopped
	}
	return GenerationBatchCompletedWithErrors
}

func isTerminalGenerationState(state GenerationState) bool {
	return state == GenerationCompleted || state == GenerationFailed || state == GenerationStopped
}

func isTerminalBatchState(state GenerationBatchState) bool {
	return state == GenerationBatchCompleted || state == GenerationBatchCompletedWithErrors || state == GenerationBatchStopped || state == GenerationBatchFailed
}

func scanGenerationBatch(row rowScanner) (GenerationBatch, error) {
	var batch GenerationBatch
	var attachmentsJSON string
	var selected sql.NullString
	var temperature, topP sql.NullFloat64
	var maxTokens sql.NullInt64
	var skipped, frozen int
	var createdAt, updatedAt int64
	if err := row.Scan(&batch.ID, &batch.ConversationID, &batch.ClientRequestID, &batch.UserMessageID, &batch.SystemPrompt, &temperature, &topP, &maxTokens, &batch.State, &selected, &skipped, &frozen, &createdAt, &updatedAt, &batch.InputContent, &attachmentsJSON); err != nil {
		return GenerationBatch{}, err
	}
	if err := json.Unmarshal([]byte(attachmentsJSON), &batch.Attachments); err != nil {
		return GenerationBatch{}, fmt.Errorf("decode attachments: %w", err)
	}
	if temperature.Valid {
		batch.GenerationParameters.Temperature = &temperature.Float64
	}
	if topP.Valid {
		batch.GenerationParameters.TopP = &topP.Float64
	}
	if maxTokens.Valid {
		value := int(maxTokens.Int64)
		batch.GenerationParameters.MaxTokens = &value
	}
	batch.SelectedGenerationID = selected.String
	batch.ContextSkipped = skipped != 0
	batch.ContextFrozen = frozen != 0
	batch.CreatedAt = time.Unix(0, createdAt).UTC()
	batch.UpdatedAt = time.Unix(0, updatedAt).UTC()
	return batch, nil
}

func getGenerationBatchByRequestTx(ctx context.Context, tx *sql.Tx, clientRequestID string) (GenerationBatch, error) {
	return scanGenerationBatch(tx.QueryRowContext(ctx, `SELECT id, conversation_id, client_request_id, user_message_id, system_prompt, temperature, top_p, max_tokens, state, selected_generation_id, context_skipped, context_frozen, created_at, updated_at, input_content, attachments FROM generation_batches WHERE client_request_id = ?`, clientRequestID))
}

func ensureContextDispositionTx(ctx context.Context, tx *sql.Tx, conversationID string) error {
	var unresolved int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM generation_batches WHERE conversation_id = ? AND selected_generation_id IS NULL AND context_skipped = 0`, conversationID).Scan(&unresolved); err != nil {
		return fmt.Errorf("check generation batch context disposition: %w", err)
	}
	if unresolved > 0 {
		return ErrContextDispositionRequired
	}
	return nil
}

func saveContextItemsTx(ctx context.Context, tx *sql.Tx, batchID, conversationID string) error {
	rows, err := tx.QueryContext(ctx, `SELECT user_message_id, selected_generation_id FROM generation_batches WHERE conversation_id = ? AND selected_generation_id IS NOT NULL AND context_skipped = 0 ORDER BY created_at ASC, id ASC`, conversationID)
	if err != nil {
		return fmt.Errorf("load generation batch context items: %w", err)
	}
	defer rows.Close()
	position := 0
	for rows.Next() {
		var userMessageID, generationID string
		if err := rows.Scan(&userMessageID, &generationID); err != nil {
			return fmt.Errorf("scan generation batch context item: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO batch_context_items (generation_batch_id, position, user_message_id, selected_generation_id) VALUES (?, ?, ?, ?)`, batchID, position, userMessageID, generationID); err != nil {
			return fmt.Errorf("save generation batch context item: %w", err)
		}
		position++
	}
	return rows.Err()
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
