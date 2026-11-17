package persistence

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
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
