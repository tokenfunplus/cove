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

type ConversationSearchFilter struct {
	ProjectID    *string
	Kind         string
	UpdatedAfter *time.Time
}

type FilteredConversationSearcher interface {
	SearchFilteredConversations(context.Context, string, bool, ConversationSearchFilter) ([]ConversationSearchResult, error)
}

const conversationSearchMigration = `
CREATE INDEX generations_assistant_message_idx ON generations(assistant_message_id) WHERE assistant_message_id IS NOT NULL;
CREATE VIEW message_search_content AS SELECT rowid, cove_search_text(CAST(body AS BLOB)) AS body FROM messages;
CREATE VIRTUAL TABLE message_search USING fts5(body, content='message_search_content', content_rowid='rowid', tokenize='trigram case_sensitive 1');
CREATE TRIGGER messages_search_insert AFTER INSERT ON messages BEGIN
  INSERT INTO message_search(rowid, body) VALUES (new.rowid, cove_search_text(CAST(new.body AS BLOB)));
END;
CREATE TRIGGER messages_search_delete AFTER DELETE ON messages BEGIN
  INSERT INTO message_search(message_search, rowid, body) VALUES ('delete', old.rowid, cove_search_text(CAST(old.body AS BLOB)));
END;
CREATE TRIGGER messages_search_update AFTER UPDATE ON messages BEGIN
  INSERT INTO message_search(message_search, rowid, body) VALUES ('delete', old.rowid, cove_search_text(CAST(old.body AS BLOB)));
  INSERT INTO message_search(rowid, body) VALUES (new.rowid, cove_search_text(CAST(new.body AS BLOB)));
END;
INSERT INTO message_search(message_search) VALUES ('rebuild');
PRAGMA user_version = 16;
`

func init() {
	// Normalize both index input and literal verification with the same Unicode rules.
	// Blob arguments preserve embedded NULs across the SQLite scalar-function bridge.
	sqlite.MustRegisterDeterministicScalarFunction("cove_search_text", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		body, _ := args[0].([]byte)
		return strings.ReplaceAll(strings.ToLower(string(body)), "\x00", "\ufffd"), nil
	})
	sqlite.MustRegisterDeterministicScalarFunction("cove_contains", 2, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		body, _ := args[0].([]byte)
		query, _ := args[1].([]byte)
		if strings.Contains(strings.ToLower(string(body)), string(query)) {
			return int64(1), nil
		}
		return int64(0), nil
	})
}

func (store *SQLiteStore) SearchConversations(ctx context.Context, query string, archived bool) ([]ConversationSearchResult, error) {
	return store.SearchFilteredConversations(ctx, query, archived, ConversationSearchFilter{})
}

func (store *SQLiteStore) SearchFilteredConversations(ctx context.Context, query string, archived bool, filter ConversationSearchFilter) ([]ConversationSearchResult, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	results := make([]ConversationSearchResult, 0)
	if query == "" {
		return results, nil
	}
	statement, args := conversationSearchQuery(query, archived, filter)
	rows, err := store.db.QueryContext(ctx, statement, args...)
	if err != nil {
		return nil, fmt.Errorf("search conversations: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var item ConversationSearchResult
		var createdAt, updatedAt int64
		var messageID, role, body, turnMessageID sql.NullString
		if err := rows.Scan(&item.ID, &item.Title, &item.Pinned, &item.Archived, &createdAt, &updatedAt, &item.DebateID, &item.DebateStatus, &item.DebateRound, &item.ProjectID, &item.MembershipRevision, &item.ProjectRevision, &messageID, &role, &body, &turnMessageID); err != nil {
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

func conversationSearchQuery(query string, archived bool, filters ...ConversationSearchFilter) (string, []any) {
	filter := ConversationSearchFilter{}
	if len(filters) > 0 {
		filter = filters[0]
	}
	filterSQL, filterArgs := conversationSearchFilterSQL(filter)
	predicate := "cove_contains(CAST(body AS BLOB), CAST(? AS BLOB)) = 1"
	args := []any{archived}
	args = append(args, filterArgs...)
	// Trigrams cannot represent one/two-rune queries or NUL-delimited text.
	if utf8.RuneCountInString(query) >= 3 && !strings.ContainsRune(query, 0) {
		predicate = "rowid IN (SELECT rowid FROM message_search WHERE message_search MATCH ?) AND " + predicate
		args = append(args, `"`+strings.ReplaceAll(query, `"`, `""`)+`"`)
	}
	args = append(args, query, archived)
	args = append(args, filterArgs...)
	args = append(args, query)
	order := "c.pinned_at IS NULL, c.pinned_at DESC, c.updated_at DESC, c.id DESC"
	if archived {
		order = "c.archived_at DESC, c.updated_at DESC, c.id DESC"
	}
	return `
WITH matching_messages AS MATERIALIZED (
  SELECT id, conversation_id, created_at FROM messages
  WHERE conversation_id IN (SELECT c.id FROM conversations c WHERE (c.archived_at IS NOT NULL) = ?` + filterSQL + `)
    AND role IN ('user', 'assistant') AND ` + predicate + `
)
SELECT c.id, c.title, c.pinned_at IS NOT NULL, c.archived_at IS NOT NULL, c.created_at, c.updated_at,
       COALESCE(d.id,''), COALESCE(d.status,''), COALESCE(json_extract(d.record,'$.round'),0), COALESCE(c.project_id,''), c.membership_revision, COALESCE((SELECT revision FROM projects WHERE id=c.project_id),0),
       m.id, m.role, m.body,
       COALESCE((SELECT user_message_id FROM generations WHERE assistant_message_id = m.id LIMIT 1), CASE WHEN m.role = 'user' THEN m.id END)
FROM conversations c
LEFT JOIN debate_sessions d ON d.id = c.id
LEFT JOIN messages m ON m.id = (
  SELECT id FROM matching_messages WHERE conversation_id = c.id
  ORDER BY created_at, id LIMIT 1
)
WHERE (c.archived_at IS NOT NULL) = ?` + filterSQL + ` AND (cove_contains(CAST(c.title AS BLOB), CAST(? AS BLOB)) = 1 OR m.id IS NOT NULL)
ORDER BY ` + order + ` LIMIT 50`, args
}

// Apply filters before the result cap so older matching history is not hidden
// behind fifty unrelated conversations. All values remain SQL parameters.
func conversationSearchFilterSQL(filter ConversationSearchFilter) (string, []any) {
	condition := ""
	args := []any{}
	if filter.ProjectID != nil {
		condition += " AND COALESCE(c.project_id,'')=?"
		args = append(args, *filter.ProjectID)
	}
	if filter.Kind == "chat" {
		condition += " AND NOT EXISTS (SELECT 1 FROM debate_sessions WHERE id=c.id)"
	}
	if filter.Kind == "debate" {
		condition += " AND EXISTS (SELECT 1 FROM debate_sessions WHERE id=c.id)"
	}
	if filter.UpdatedAfter != nil {
		condition += " AND c.updated_at >= ?"
		args = append(args, filter.UpdatedAfter.UnixNano())
	}
	return condition, args
}

func searchExcerpt(body, query string) string {
	lowered := strings.ToLower(body)
	position := strings.Index(lowered, query)
	if position < 0 {
		return ""
	}
	// Lowercasing preserves rune positions even when UTF-8 byte lengths change.
	start := max(0, utf8.RuneCountInString(lowered[:position])-60)
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
