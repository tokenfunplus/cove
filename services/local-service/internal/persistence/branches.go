package persistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

var ErrInvalidBranch = errors.New("the edited turn must be terminal and belong to the source conversation")

func (store *SQLiteStore) loadConversationBranch(ctx context.Context, id string) (*ConversationBranch, error) {
	var branch ConversationBranch
	err := store.db.QueryRowContext(ctx, `SELECT source_conversation_id, source_batch_id, source_title FROM conversation_branches WHERE conversation_id = ?`, id).Scan(&branch.SourceConversationID, &branch.SourceBatchID, &branch.SourceTitle)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load conversation branch: %w", err)
	}
	return &branch, nil
}

// Copy the exact Selected Answers captured by the edited turn. All IDs and
// storage are independent so deleting or changing the source cannot alter it.
func forkConversationTx(ctx context.Context, tx *sql.Tx, conversationID, sourceBatchID string) (string, error) {
	source, err := getGenerationBatch(ctx, tx, sourceBatchID)
	if err != nil {
		return "", err
	}
	if source.ConversationID != conversationID || source.State == GenerationBatchPending || source.State == GenerationBatchStreaming {
		return "", ErrInvalidBranch
	}
	var title string
	if err := tx.QueryRowContext(ctx, `SELECT title FROM conversations WHERE id = ?`, conversationID).Scan(&title); err != nil {
		return "", err
	}
	items, err := loadGenerationBatchContext(ctx, tx, sourceBatchID)
	if err != nil {
		return "", err
	}
	id, err := newID()
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	branchTitle := "Branch: " + title
	if len([]rune(branchTitle)) > 120 {
		branchTitle = string([]rune(branchTitle)[:120])
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`, id, branchTitle, now.UnixNano(), now.UnixNano()); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO conversation_branches (conversation_id, source_conversation_id, source_batch_id, source_title) VALUES (?, ?, ?, ?)`, id, conversationID, sourceBatchID, title); err != nil {
		return "", err
	}
	for index, item := range items {
		if err := copyBranchTurnTx(ctx, tx, id, item, now.Add(time.Duration(index*2)*time.Nanosecond)); err != nil {
			return "", err
		}
	}
	return id, nil
}

func copyBranchTurnTx(ctx context.Context, tx *sql.Tx, conversationID string, item ContextItem, now time.Time) error {
	ids := make([]string, 5)
	for index := range ids {
		id, err := newID()
		if err != nil {
			return err
		}
		ids[index] = id
	}
	batchID, userID, answerID, targetID, generationID := ids[0], ids[1], ids[2], ids[3], ids[4]
	timestamp := now.UnixNano()
	generation, err := scanGeneration(tx.QueryRowContext(ctx, generationQuery+` WHERE id = ?`, item.SelectedGenerationID))
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO messages (id, conversation_id, role, body, provider_snapshot, created_at, reasoning, web_sources, context_body) SELECT ?, ?, role, body, provider_snapshot, ?, reasoning, web_sources, context_body FROM messages WHERE id = ?`, userID, conversationID, timestamp, item.UserMessageID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO messages (id, conversation_id, role, body, provider_snapshot, created_at, reasoning, web_sources, context_body) SELECT ?, ?, role, body, provider_snapshot, ?, reasoning, web_sources, context_body FROM messages WHERE id = ?`, answerID, conversationID, timestamp+1, generation.AssistantMessageID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO generation_batches (id, conversation_id, client_request_id, user_message_id, system_prompt, temperature, top_p, max_tokens, state, selected_generation_id, context_skipped, context_frozen, created_at, updated_at, input_content, attachments, attachment_data, web_search_policy)
 SELECT ?, ?, ?, ?, system_prompt, temperature, top_p, max_tokens, 'completed', ?, 0, 1, ?, ?, input_content, attachments, attachment_data, web_search_policy FROM generation_batches WHERE user_message_id = ?`, batchID, conversationID, "branch:"+batchID, userID, generationID, timestamp, timestamp, item.UserMessageID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO generation_targets (id, generation_batch_id, provider_id, model_id, position, latest_generation_id) VALUES (?, ?, ?, ?, 0, ?)`, targetID, batchID, generation.Snapshot.ProviderID, generation.Snapshot.ModelID, generationID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO generations (id, conversation_id, client_request_id, user_message_id, state, provider_snapshot, system_prompt, temperature, top_p, max_tokens, verification_snapshot, assistant_message_id, created_at, updated_at, generation_batch_id, generation_target_id, metrics, web_search_policy, web_search_run, web_search_info)
 SELECT ?, ?, ?, ?, 'completed', provider_snapshot, system_prompt, temperature, top_p, max_tokens, verification_snapshot, ?, ?, ?, ?, ?, metrics, web_search_policy, web_search_run, web_search_info FROM generations WHERE id = ?`, generationID, conversationID, "branch:"+generationID, userID, answerID, timestamp, timestamp, batchID, targetID, generation.ID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO batch_context_items (generation_batch_id, position, user_message_id, selected_generation_id) SELECT ?, ROW_NUMBER() OVER (ORDER BY created_at, id) - 1, user_message_id, selected_generation_id FROM generation_batches WHERE conversation_id = ? AND id != ?`, batchID, conversationID, batchID); err != nil {
		return err
	}
	return nil
}
