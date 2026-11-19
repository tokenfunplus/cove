package persistence

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func TestHistoryFiltersApplyBeforeSearchLimitAndRetainDebateMetadata(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "history.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	old, err := store.CreateDebate(ctx, DebateSession{ClientRequestID: "older-debate", Topic: "Needle older debate", Status: "paused", Round: 4})
	if err != nil {
		t.Fatal(err)
	}
	cutoff := time.Now().UTC().Add(-24 * time.Hour)
	if _, err = store.db.Exec(`UPDATE conversations SET updated_at=? WHERE id=?`, cutoff.Add(-time.Nanosecond).UnixNano(), old.ID); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 60; i++ {
		if _, err = store.CreateConversation(ctx, fmt.Sprintf("Needle newer chat %02d", i)); err != nil {
			t.Fatal(err)
		}
	}
	matched, err := store.SearchFilteredConversations(ctx, "Needle", false, ConversationSearchFilter{Kind: "debate"})
	if err != nil || len(matched) != 1 || matched[0].ID != old.ID || matched[0].DebateID != old.ID || matched[0].DebateStatus != "paused" || matched[0].DebateRound != 4 {
		t.Fatal("type filtering lost an older result or its status", err)
	}
	matched, err = store.SearchFilteredConversations(ctx, "Needle", false, ConversationSearchFilter{Kind: "debate", UpdatedAfter: &cutoff})
	if err != nil || len(matched) != 0 {
		t.Fatal("activity filter included an older debate", err)
	}
	if _, err = store.db.Exec(`UPDATE conversations SET updated_at=? WHERE id=?`, cutoff.UnixNano(), old.ID); err != nil {
		t.Fatal(err)
	}
	matched, err = store.SearchFilteredConversations(ctx, "Needle", false, ConversationSearchFilter{Kind: "debate", UpdatedAfter: &cutoff})
	if err != nil || len(matched) != 1 {
		t.Fatal("activity cutoff must be inclusive", err)
	}
	matched, err = store.SearchFilteredConversations(ctx, "Needle", false, ConversationSearchFilter{Kind: "chat", UpdatedAfter: &cutoff})
	if err != nil || len(matched) != 50 {
		t.Fatal("chat search lost its bounded result cap", err)
	}
	for _, item := range matched {
		if item.DebateID != "" {
			t.Fatal("chat filter included a debate")
		}
	}
	if err = store.SetConversationArchived(ctx, old.ID, true); err != nil {
		t.Fatal(err)
	}
	matched, err = store.SearchFilteredConversations(ctx, "Needle", true, ConversationSearchFilter{Kind: "debate", UpdatedAfter: &cutoff})
	if err != nil || len(matched) != 1 || !matched[0].Archived {
		t.Fatal("archive filters did not compose", err)
	}
	old.Status, old.Round = "running", 8
	if err = store.SaveDebate(ctx, old); err != nil {
		t.Fatal(err)
	}
	listed, err := store.ListArchivedConversations(ctx)
	if err != nil || len(listed) != 1 || listed[0].DebateStatus != "running" || listed[0].DebateRound != 8 {
		t.Fatal("list metadata did not reflect current Debate state", err)
	}
}

func TestHistoryTypeFilterAlsoAppliesToMessageBodySearch(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "body.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(ctx, "A title without the search phrase")
	if err != nil {
		t.Fatal(err)
	}
	message, err := store.AddMessage(ctx, conversation.ID, MessageInput{Role: "user", Body: "A matching phrase in the body"})
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"chat", "debate"} {
		matched, err := store.SearchFilteredConversations(ctx, "matching phrase", false, ConversationSearchFilter{Kind: kind})
		if err != nil {
			t.Fatal(err)
		}
		if kind == "debate" && len(matched) != 0 {
			t.Fatal("message search escaped its type scope")
		}
		if kind == "chat" && (len(matched) != 1 || matched[0].MessageID != message.ID) {
			t.Fatal("filtered phrase search lost its original message reference")
		}
	}
}
