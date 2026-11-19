package persistence

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestConversationSearchFindsTitlesAndUnicodeMessageBodiesLocally(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "search.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, _ := store.CreateConversation(ctx, "Project planning")
	user, err := store.AddMessage(ctx, conversation.ID, MessageInput{Role: "user", Body: strings.Repeat("\u4e2d", 100) + "SQLite migration checklist \u00c4PFEL \u4f60\u597d \U0001f30a 100%_literal'"})
	if err != nil {
		t.Fatal(err)
	}
	assistant, _ := store.CreateConversation(ctx, "Answers")
	answer, err := store.AddMessage(ctx, assistant.ID, MessageInput{Role: "assistant", Body: "Only an assistant knows this phrase"})
	if err != nil {
		t.Fatal(err)
	}
	archived, _ := store.CreateConversation(ctx, "Archived checklist")
	if err := store.SetConversationArchived(ctx, archived.ID, true); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct {
		query, id, message string
		archived           bool
	}{
		{"planning", conversation.ID, "", false},
		{"sqlite migration checklist", conversation.ID, user.ID, false},
		{"\u00e4pfel", conversation.ID, user.ID, false},
		{"\u4f60\u597d \U0001f30a", conversation.ID, user.ID, false},
		{"100%_literal'", conversation.ID, user.ID, false},
		{"assistant knows", assistant.ID, answer.ID, false},
		{"checklist", archived.ID, "", true},
	} {
		results, err := store.SearchConversations(ctx, scenario.query, scenario.archived)
		if err != nil {
			t.Fatal(err)
		}
		if len(results) != 1 || results[0].ID != scenario.id || results[0].MessageID != scenario.message {
			t.Fatalf("search %q = %#v", scenario.query, results)
		}
		if scenario.message != "" && (!utf8.ValidString(results[0].Excerpt) || utf8.RuneCountInString(results[0].Excerpt) > 402) {
			t.Fatal("invalid or unbounded excerpt")
		}
	}
	results, err := store.SearchConversations(ctx, "migration checklist", false)
	if err != nil || !strings.Contains(results[0].Excerpt, "SQLite migration checklist") {
		t.Fatal("matching text must appear in the excerpt")
	}
	if err := store.DeleteConversation(ctx, conversation.ID); err != nil {
		t.Fatal(err)
	}
	results, err = store.SearchConversations(ctx, "migration checklist", false)
	if err != nil || len(results) != 0 {
		t.Fatal("deleted messages remain searchable")
	}
}

func dropConversationSearchIndex(t testing.TB, store *SQLiteStore) {
	t.Helper()
	if _, err := store.db.Exec(`DROP TRIGGER messages_search_insert; DROP TRIGGER messages_search_update; DROP TRIGGER messages_search_delete; DROP TABLE message_search; DROP VIEW message_search_content; DROP INDEX generations_assistant_message_idx;`); err != nil {
		t.Fatal(err)
	}
}

func TestSearchIndexMigratesExistingHistoryAndTracksUpdatesAndDeletes(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "migration.sqlite")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	conversation, _ := store.CreateConversation(ctx, "Kept history")
	message, err := store.AddMessage(ctx, conversation.ID, MessageInput{Role: "assistant", Body: "Original \u00c4PFEL and quoted \"phrase\""})
	if err != nil {
		t.Fatal(err)
	}
	dropConversationSearchIndex(t, store)
	if _, err := store.db.Exec(`DROP TABLE debate_turns; DROP TABLE debate_interventions; DROP TABLE debate_sessions; DROP TABLE conversation_branches; ALTER TABLE messages DROP COLUMN reasoning; ALTER TABLE generations DROP COLUMN metrics; PRAGMA user_version = 15`); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	check := func(query string, count int) {
		t.Helper()
		results, err := store.SearchConversations(ctx, query, false)
		if err != nil || len(results) != count {
			t.Fatalf("query %q: count=%d, err=%v", query, len(results), err)
		}
	}
	for _, query := range []string{"\u00e4pfel", `quoted "phrase"`, "\u00e4", "\u00e4p"} {
		check(query, 1)
	}
	if _, err := store.db.Exec(`UPDATE messages SET body = ? WHERE id = ?`, "Replacement needle after\x00delimiter", message.ID); err != nil {
		t.Fatal(err)
	}
	check("original", 0)
	check("replacement needle", 1)
	check("delimiter", 1)
	check("after\x00delimiter", 1)
	if _, err := store.db.Exec(`INSERT INTO message_search(message_search, rank) VALUES ('integrity-check', 1)`); err != nil {
		t.Fatal(err)
	}
	if err := store.ClearChatData(ctx); err != nil {
		t.Fatal(err)
	}
	check("replacement needle", 0)
	if _, err := store.db.Exec(`INSERT INTO message_search(message_search, rank) VALUES ('integrity-check', 1)`); err != nil {
		t.Fatal(err)
	}
}

func TestArchivedSearchUsesArchiveListOrder(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "ordering.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for index := range 3 {
		conversation, err := store.CreateConversation(ctx, fmt.Sprintf("Search order %d", index))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.db.Exec(`UPDATE conversations SET archived_at = ?, pinned_at = ?, updated_at = ? WHERE id = ?`, index+1, 3-index, 3-index, conversation.ID); err != nil {
			t.Fatal(err)
		}
	}
	listed, err := store.ListArchivedConversations(ctx)
	if err != nil {
		t.Fatal(err)
	}
	matched, err := store.SearchConversations(ctx, "Search order", true)
	if err != nil || len(matched) != len(listed) {
		t.Fatal("archive search lost conversations", err)
	}
	for index := range listed {
		if matched[index].ID != listed[index].ID {
			t.Fatal("search does not follow archive list order")
		}
	}
}

func TestPhraseSearchUsesTheTrigramIndex(t *testing.T) {
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "plan.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	statement, args := conversationSearchQuery("specific phrase", false)
	rows, err := store.db.Query("EXPLAIN QUERY PLAN "+statement, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(detail, "message_search VIRTUAL TABLE INDEX") {
			found = true
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("phrase search is not using the full-text index")
	}
}

func BenchmarkConversationSearchIndexed(b *testing.B) {
	store, err := OpenSQLite(filepath.Join(b.TempDir(), "history.sqlite"))
	if err != nil {
		b.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	conversation, err := store.CreateConversation(ctx, "Large local history")
	if err != nil {
		b.Fatal(err)
	}
	tx, err := store.db.Begin()
	if err != nil {
		b.Fatal(err)
	}
	defer tx.Rollback()
	body := strings.Repeat("Synthetic history content for search. ", 900)
	for index := range 1000 {
		text := body
		if index == 999 {
			text += "rare searchable needle"
		}
		if _, err := tx.Exec(`INSERT INTO messages(id, conversation_id, role, body, created_at) VALUES (?, ?, 'assistant', ?, ?)`, fmt.Sprintf("message-%d", index), conversation.ID, text, index); err != nil {
			b.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for b.Loop() {
		ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		results, err := store.SearchConversations(ctx, "rare searchable needle", false)
		cancel()
		if err != nil || len(results) != 1 {
			b.Fatal("indexed search failed", err)
		}
	}
}

func TestConversationSearchIsBoundedAndTreatsPatternsAsLiteralText(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "bounded.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for index := range 55 {
		if _, err := store.CreateConversation(ctx, fmt.Sprintf("Match %d", index)); err != nil {
			t.Fatal(err)
		}
	}
	results, err := store.SearchConversations(ctx, "Match", false)
	if err != nil || len(results) != 50 {
		t.Fatalf("bounded result count = %d, error=%v", len(results), err)
	}
	for _, query := range []string{"", "  ", "%", "' OR 1=1 --"} {
		results, err = store.SearchConversations(ctx, query, false)
		if err != nil || len(results) != 0 {
			t.Fatalf("query %q unexpectedly matched", query)
		}
	}
}
