package chat

import (
	"context"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type fixtureWebReader struct{ document documents.Prepared }

func (reader fixtureWebReader) Fetch(context.Context, string) (documents.Prepared, error) {
	return reader.document, nil
}

func TestWebSourcePreviewOwnershipExpiryAndImmutableGeneration(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "web.sqlite")
	store, err := persistence.OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	settings := persistence.Settings{Theme: "system", Locale: "en", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "a"}}}
	if err := store.UpdateSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation(ctx, "Web sources")
	if err != nil {
		t.Fatal(err)
	}
	upstream := &modelStreamsProvider{streams: map[string][]provider.CompletionStream{"a": {
		&fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "Answer"}, {Type: provider.EventCompleted}}},
		&fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "Retry"}, {Type: provider.EventCompleted}}},
		&fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "Branch"}, {Type: provider.EventCompleted}}},
	}}}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a"), upstream, store)
	document, err := documents.Parse(ctx, documents.Input{Name: "article.txt", Data: []byte("Saved webpage evidence")})
	if err != nil {
		t.Fatal(err)
	}
	document.Web = &documents.WebSource{OriginalURL: "https://fixture.example/article", FinalURL: "https://fixture.example/article", FetchedAt: time.Now().UTC().Format(time.RFC3339Nano), ContentSHA256: document.ID}
	service.webReader = fixtureWebReader{document}
	prepared, err := service.PrepareWebSource(ctx, "owner", document.Web.OriginalURL)
	if err != nil {
		t.Fatal(err)
	}
	if expires, err := time.Parse(time.RFC3339Nano, prepared.ExpiresAt); err != nil || !expires.After(time.Now()) {
		t.Fatal("prepared source did not expose a usable expiry")
	}
	input := SendInput{ConversationID: conversation.ID, Body: "Read this webpage", ClientRequestID: "web-input", WebSourceOwner: "other", WebSourceTokens: []string{prepared.SourceToken}}
	if _, err := service.PreviewGenerationContext(ctx, input); err == nil {
		t.Fatal("another session used the prepared source")
	}
	input.WebSourceOwner = "owner"
	preview, err := service.PreviewGenerationContext(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	started, err := service.StartGenerationBatch(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, started.Batch.ID)
	service.ReleaseWebSource(ctx, "owner", prepared.SourceToken)
	if _, err := service.PreviewGenerationContext(ctx, input); err == nil {
		t.Fatal("released draft remained usable")
	}
	repeated, err := service.StartGenerationBatch(ctx, input)
	if err != nil || repeated.Batch.ID != started.Batch.ID {
		t.Fatalf("idempotent delivery required a live preview: %v", err)
	}
	if _, err := service.RetryGenerationTarget(ctx, started.Batch.Targets[0].ID, "web-retry"); err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, started.Batch.ID)
	for _, messages := range upstream.messagesFor("a") {
		if !reflect.DeepEqual(messages, preview) {
			t.Fatal("generation or retry changed the previewed web source")
		}
	}
	branch, err := service.StartGenerationBatch(ctx, SendInput{ConversationID: conversation.ID, EditOfBatchID: started.Batch.ID, ClientRequestID: "web-branch", Body: "Explain the saved webpage"})
	if err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, branch.Batch.ID)
	if err := service.DeleteConversation(ctx, conversation.ID); err != nil {
		t.Fatal(err)
	}
	reopened, err := persistence.OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	saved, err := reopened.GetGenerationBatch(ctx, branch.Batch.ID)
	if err != nil || len(saved.Attachments) != 1 || saved.Attachments[0].Web == nil || !strings.Contains(saved.InputContent, "Saved webpage evidence") {
		t.Fatalf("branch lost webpage snapshot after deletion/restart: %v", err)
	}
	prepared, err = service.PrepareWebSource(ctx, "owner", document.Web.OriginalURL)
	if err != nil {
		t.Fatal(err)
	}
	service.webMu.Lock()
	entry := service.webSources[prepared.SourceToken]
	entry.expires = time.Now().Add(-time.Second)
	service.webSources[prepared.SourceToken] = entry
	service.webMu.Unlock()
	if _, err := service.preparedWebSources("owner", []string{prepared.SourceToken}); err == nil {
		t.Fatal("expired preview was accepted")
	}
}
