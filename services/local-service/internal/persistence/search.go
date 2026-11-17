package persistence

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"modernc.org/sqlite"
)

type ConversationSearchResult struct {
	Conversation
	MessageID     string `json:"message_id,omitempty"`
	TurnMessageID string `json:"turn_message_id,omitempty"`
	Role          string `json:"role,omitempty"`
	Excerpt       string `json:"excerpt,omitempty"`
}

func init() {
	// SQLite's built-in lower/LIKE only fold ASCII. Keep substring matching
	// Unicode-aware without duplicating message bodies into a search index.
	sqlite.MustRegisterDeterministicScalarFunction("cove_contains", 2, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		body, _ := args[0].(string)
		query, _ := args[1].(string)
		if strings.Contains(strings.ToLower(body), query) {
			return int64(1), nil
		}
		return int64(0), nil
	})
}

func (store *SQLiteStore) SearchConversations(ctx context.Context, query string, archived bool) ([]ConversationSearchResult, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	results := make([]ConversationSearchResult, 0)
	if query == "" {
		return results, nil
	}
	rows, err := store.db.QueryContext(ctx, `
SELECT c.id, c.title, c.pinned_at IS NOT NULL, c.archived_at IS NOT NULL, c.created_at, c.updated_at,
       m.id, m.role, m.body,
       COALESCE((SELECT user_message_id FROM generations WHERE assistant_message_id = m.id LIMIT 1), CASE WHEN m.role = 'user' THEN m.id END)
FROM conversations c
LEFT JOIN messages m ON m.id = (
  SELECT id FROM messages
  WHERE conversation_id = c.id AND role IN ('user', 'assistant') AND cove_contains(body, ?) = 1
  ORDER BY created_at, id LIMIT 1
)
WHERE (c.archived_at IS NOT NULL) = ? AND (cove_contains(c.title, ?) = 1 OR m.id IS NOT NULL)
ORDER BY c.pinned_at IS NULL, c.pinned_at DESC, c.updated_at DESC, c.id DESC
LIMIT 50`, query, archived, query)
	if err != nil {
		return nil, fmt.Errorf("search conversations: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var item ConversationSearchResult
		var createdAt, updatedAt int64
		var messageID, role, body, turnMessageID sql.NullString
		if err := rows.Scan(&item.ID, &item.Title, &item.Pinned, &item.Archived, &createdAt, &updatedAt, &messageID, &role, &body, &turnMessageID); err != nil {
			return nil, fmt.Errorf("read conversation search result: %w", err)
		}
		item.CreatedAt, item.UpdatedAt = time.Unix(0, createdAt).UTC(), time.Unix(0, updatedAt).UTC()
		item.MessageID, item.Role = messageID.String, role.String
		item.TurnMessageID = turnMessageID.String
		if body.Valid {
			item.Excerpt = searchExcerpt(body.String, query)
		}
		results = append(results, item)
	}
	return results, rows.Err()
}

func searchExcerpt(body, query string) string {
	position := strings.Index(strings.ToLower(body), query)
	if position < 0 {
		return ""
	}
	// Lowercasing preserves rune positions even when UTF-8 byte lengths change.
	start := max(0, utf8.RuneCountInString(strings.ToLower(body)[:position])-60)
	characters := []rune(body)
	end := min(len(characters), start+min(400, max(200, utf8.RuneCountInString(query)+60)))
	excerpt := strings.Join(strings.Fields(string(characters[start:end])), " ")
	if start > 0 {
		excerpt = "…" + excerpt
	}
	if end < len(characters) {
		excerpt += "…"
	}
	return excerpt
}
