package chat

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

func TestProjectInputIsFrozenButNeverReplayedAsHistoricalUserInput(t *testing.T) {
	ctx := context.Background()
	store, e := persistence.OpenSQLite(filepath.Join(t.TempDir(), "project-chat.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	settings := persistence.Settings{Theme: "system", Locale: "en", SystemPrompt: "Base original", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "a"}, {ProviderID: "provider-a", ModelID: "b"}}}
	if e = store.UpdateSettings(ctx, settings); e != nil {
		t.Fatal(e)
	}
	upstream := &modelStreamsProvider{streams: map[string][]provider.CompletionStream{}}
	for _, model := range []string{"a", "b"} {
		for range 4 {
			upstream.streams[model] = append(upstream.streams[model], &fakeStream{events: []provider.Event{{Type: provider.EventStarted}, {Type: provider.EventDelta, Delta: "Answer"}, {Type: provider.EventCompleted}}})
		}
	}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a"), upstream, store)
	p, e := service.SaveProject(ctx, "", persistence.ProjectInput{Name: "Fixture", Instructions: "Original project instructions", Background: "Original project reference"})
	if e != nil {
		t.Fatal(e)
	}
	p, e = service.AddProjectSource(ctx, p.ID, p.Revision, documents.Input{Name: "source.md", Data: []byte("Fixed source text")}, "", "")
	if e != nil {
		t.Fatal(e)
	}
	c, e := service.CreateProjectConversation(ctx, "", p.ID, "")
	if e != nil {
		t.Fatal(e)
	}
	preview, e := service.PreviewProjectGenerationContext(ctx, SendInput{ConversationID: c.ID, Body: "First question"})
	if e != nil {
		t.Fatal(e)
	}
	first, e := service.StartGenerationBatch(ctx, SendInput{ConversationID: c.ID, ClientRequestID: "first", Body: "First question", ExpectedProject: &preview.Expected})
	if e != nil {
		t.Fatal(e)
	}
	waitFileBatch(t, service, first.Batch.ID)
	if strings.Contains(first.Batch.InputContent, "Original project reference") || len(first.Batch.Attachments) != 0 {
		t.Fatal("project data polluted replayable turn input")
	}
	upstream.mu.Lock()
	actual := upstream.messages["a"][0]
	other := upstream.messages["b"][0]
	upstream.mu.Unlock()
	if !reflect.DeepEqual(actual, preview.Messages) || !reflect.DeepEqual(actual, other) {
		t.Fatal("preview and model inputs differ")
	}
	if len(actual) != 2 || actual[0].Role != "system" || actual[1].Role != "user" || !strings.Contains(actual[1].Content, "First question") {
		t.Fatal("invalid role sequence")
	}
	if e = service.SelectGenerationAnswer(ctx, first.Batch.Targets[0].Generation.ID); e != nil {
		t.Fatal(e)
	}
	p, e = service.SaveProject(ctx, p.ID, persistence.ProjectInput{Name: p.Name, Revision: p.Revision, Instructions: "Changed project instructions", Background: "Changed reference"})
	if e != nil {
		t.Fatal(e)
	}
	settings.SystemPrompt = "Base changed"
	if e = store.UpdateSettings(ctx, settings); e != nil {
		t.Fatal(e)
	}
	_, expect, e := service.PreviewProjectContext(ctx, c.ID)
	if e != nil {
		t.Fatal(e)
	}
	follow, e := service.StartGenerationBatch(ctx, SendInput{ConversationID: c.ID, ClientRequestID: "follow", Body: "Second question", ExpectedProject: &expect})
	if e != nil {
		t.Fatal(e)
	}
	waitFileBatch(t, service, follow.Batch.ID)
	upstream.mu.Lock()
	messages := upstream.messages["a"][1]
	upstream.mu.Unlock()
	if len(messages) != 4 || messages[1].Content != "First question" || strings.Contains(messages[3].Content, "Original project reference") {
		t.Fatalf("old project input leaked through history: %#v", messages)
	}
	retry, e := service.RetryGenerationTarget(ctx, first.Batch.Targets[0].ID, "retry")
	if e != nil {
		t.Fatal(e)
	}
	waitForGeneration(t, store, retry.Generation.ID, persistence.GenerationCompleted)
	upstream.mu.Lock()
	messages = upstream.messages["a"][2]
	upstream.mu.Unlock()
	if messages[0].Content != "Base changed\n\nProject instructions:\nOriginal project instructions" || !strings.Contains(messages[1].Content, "Original project reference") {
		t.Fatal("retry did not preserve project input and current base settings separately")
	}
}
func TestProjectPreviewReportsOversizeWhileAdmissionRejectsIt(t *testing.T) {
	ctx := context.Background()
	store, e := persistence.OpenSQLite(filepath.Join(t.TempDir(), "oversize.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a"), &modelStreamsProvider{}, store)
	if e = store.UpdateSettings(ctx, persistence.Settings{Theme: "system", Locale: "en", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "a"}}}); e != nil {
		t.Fatal(e)
	}
	p, _ := store.SaveProject(ctx, "", persistence.ProjectInput{Name: "Large", Background: strings.Repeat("x", 100000)})
	c, _ := store.CreateProjectConversation(ctx, "", p.ID, "")
	preview, e := service.PreviewProjectGenerationContext(ctx, SendInput{ConversationID: c.ID, Body: strings.Repeat("q", 150000)})
	if e != nil {
		t.Fatal(e)
	}
	if validateMessages(preview.Messages) == nil {
		t.Fatal("oversized preview was silently truncated")
	}
	if _, e = store.SaveProject(ctx, p.ID, persistence.ProjectInput{Name: p.Name, Revision: p.Revision, Background: strings.Repeat("x", 110000)}); e != nil {
		t.Fatal(e)
	}
	if _, e = service.StartGenerationBatch(ctx, SendInput{ConversationID: c.ID, ClientRequestID: "stale-oversize", Body: strings.Repeat("q", 150000), ExpectedProject: &preview.Expected}); !errors.Is(e, persistence.ErrProjectChanged) {
		t.Fatalf("stale project was reported as a size error: %v", e)
	}
	preview, e = service.PreviewProjectGenerationContext(ctx, SendInput{ConversationID: c.ID, Body: strings.Repeat("q", 150000)})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = service.StartGenerationBatch(ctx, SendInput{ConversationID: c.ID, ClientRequestID: "oversize", Body: strings.Repeat("q", 150000), ExpectedProject: &preview.Expected}); !errors.Is(e, documents.ErrContextLimit) {
		t.Fatalf("oversized admission was not rejected: %v", e)
	}
	view, e := store.LoadConversation(ctx, c.ID)
	if e != nil || len(view.Messages) != 0 || len(view.GenerationBatches) != 0 {
		t.Fatal("oversized admission created partial history")
	}
	side, e := service.CreateProjectConversation(ctx, "Side", "", c.ID)
	if e != nil || side.ProjectID != p.ID {
		t.Fatal("side membership was not resolved from its origin")
	}
}

type projectWorkStore struct{ *persistence.SQLiteStore }

func (s projectWorkStore) LoadConversation(ctx context.Context, id string) (persistence.ConversationView, error) {
	v, e := s.SQLiteStore.LoadConversation(ctx, id)
	v.ActiveGenerationBatch = nil
	return v, e
}
func TestProjectDeletionStopsBrowserRetryWithoutActiveBatchProjection(t *testing.T) {
	service, store, c := secureWatchdogFixture(t)
	service.store = projectWorkStore{store}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	p, e := service.SaveProject(ctx, "", persistence.ProjectInput{Name: "Active project"})
	if e != nil {
		t.Fatal(e)
	}
	if e = store.MoveConversation(ctx, c.ID, p.ID, c.MembershipRevision); e != nil {
		t.Fatal(e)
	}
	_, expected, e := service.PreviewProjectContext(ctx, c.ID)
	if e != nil {
		t.Fatal(e)
	}
	start, e := service.StartGenerationBatch(ctx, SendInput{ConversationID: c.ID, ClientRequestID: "project-browser", ProviderID: "nearai", ModelID: "model-a", Body: "Question", ExpectedProject: &expected})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = service.CancelGenerationBatch(ctx, start.Batch.ID); e != nil {
		t.Fatal(e)
	}
	retry, e := service.RetryGenerationTarget(ctx, start.Batch.Targets[0].ID, "project-browser-retry")
	if e != nil {
		t.Fatal(e)
	}
	prepareSecureResponse(t, service, retry.Generation.ID)
	events, e := service.SubscribeGenerationBatch(ctx, start.Batch.ID, "")
	if e != nil {
		t.Fatal(e)
	}
	if e = service.DeleteProject(ctx, p.ID, p.Revision, false, ""); !errors.Is(e, ErrGenerationBatchInProgress) {
		t.Fatalf("dissolve did not reject active work: %v", e)
	}
	g, e := store.GetGeneration(ctx, retry.Generation.ID)
	if e != nil || g.State != persistence.GenerationVerifyingResponse {
		t.Fatal("dissolve stopped active work")
	}
	if e = service.DeleteProject(ctx, p.ID, p.Revision, true, projectDeletionToken(t, store, p.ID)); e != nil {
		t.Fatal(e)
	}
	stopped := 0
	for event := range events {
		if event.GenerationID == retry.Generation.ID && event.Type == EventStopped {
			stopped++
		}
	}
	if stopped != 1 {
		t.Fatalf("retry stopped events: %d", stopped)
	}
	service.activeMu.Lock()
	remaining := len(service.secureActive)
	service.activeMu.Unlock()
	if remaining != 0 {
		t.Fatal("browser watchdog survived project deletion")
	}
	if _, e = store.LoadConversation(ctx, c.ID); !errors.Is(e, sql.ErrNoRows) {
		t.Fatal("project member survived deletion")
	}
}
func TestProjectDeletionPreservesRecordsWhenCancellationCannotSettle(t *testing.T) {
	store, e := persistence.OpenSQLite(filepath.Join(t.TempDir(), "cancel-project.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	service := NewService(store, nil, nil)
	p, e := store.SaveProject(context.Background(), "", persistence.ProjectInput{Name: "Keep project"})
	if e != nil {
		t.Fatal(e)
	}
	c, e := store.CreateProjectConversation(context.Background(), "Keep conversation", p.ID, "")
	if e != nil {
		t.Fatal(e)
	}
	_, expected, e := store.PreviewProjectContext(context.Background(), c.ID)
	if e != nil {
		t.Fatal(e)
	}
	b, e := store.BeginGenerationBatch(context.Background(), persistence.BeginGenerationBatchInput{ConversationID: c.ID, ClientRequestID: "cannot-stop", Body: "Question", ExpectedProject: &expected, Targets: []persistence.GenerationTargetInput{{ProviderID: "fixture", ModelID: "model", Snapshot: persistence.ProviderSnapshot{ProviderID: "fixture", ModelID: "model"}}}})
	if e != nil {
		t.Fatal(e)
	}
	service.active[b.Targets[0].Generation.ID] = &activeGeneration{cancel: func() {}, done: make(chan struct{})}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if e = service.DeleteProject(ctx, p.ID, p.Revision, true, projectDeletionToken(t, store, p.ID)); !errors.Is(e, context.DeadlineExceeded) {
		t.Fatalf("unsettled work was deleted: %v", e)
	}
	if _, e = store.GetProject(context.Background(), p.ID); e != nil {
		t.Fatal(e)
	}
	if _, e = store.LoadConversation(context.Background(), c.ID); e != nil {
		t.Fatal(e)
	}
}

func TestProjectDeletionStopsOrdinaryArchivedRetry(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	store, e := persistence.OpenSQLite(filepath.Join(t.TempDir(), "ordinary-delete.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	upstream := &modelStreamsProvider{streams: map[string][]provider.CompletionStream{"a": {&fakeStream{events: []provider.Event{{Type: provider.EventCompleted}}}, &blockingStream{}}}}
	service := NewService(projectWorkStore{store}, fakeProviderProfiles("provider-a"), upstream)
	p, e := service.SaveProject(ctx, "", persistence.ProjectInput{Name: "Delete active project"})
	if e != nil {
		t.Fatal(e)
	}
	c, e := service.CreateProjectConversation(ctx, "", p.ID, "")
	if e != nil {
		t.Fatal(e)
	}
	_, expected, e := service.PreviewProjectContext(ctx, c.ID)
	if e != nil {
		t.Fatal(e)
	}
	b, e := service.StartGenerationBatch(ctx, SendInput{ConversationID: c.ID, ClientRequestID: "ordinary-first", ProviderID: "provider-a", ModelID: "a", Body: "Question", ExpectedProject: &expected})
	if e != nil {
		t.Fatal(e)
	}
	waitFileBatch(t, service, b.Batch.ID)
	if e = store.SetConversationArchived(ctx, c.ID, true); e != nil {
		t.Fatal(e)
	}
	retry, e := service.RetryGenerationTarget(ctx, b.Batch.Targets[0].ID, "ordinary-retry")
	if e != nil {
		t.Fatal(e)
	}
	events, e := service.SubscribeGenerationBatch(ctx, b.Batch.ID, "")
	if e != nil {
		t.Fatal(e)
	}
	if e = service.DeleteProject(ctx, p.ID, p.Revision, true, projectDeletionToken(t, store, p.ID)); e != nil {
		t.Fatal(e)
	}
	stopped := 0
	for event := range events {
		if event.GenerationID == retry.Generation.ID && event.Type == EventStopped {
			stopped++
		}
	}
	if stopped != 1 {
		t.Fatalf("ordinary retry was not stopped before deletion: %d", stopped)
	}
	service.activeMu.Lock()
	remaining := len(service.active)
	service.activeMu.Unlock()
	if remaining != 0 {
		t.Fatal("ordinary request survived project deletion")
	}
}

func TestProjectWebSourceOwnershipRemovalAndFrozenRetry(t *testing.T) {
	ctx := context.Background()
	store, e := persistence.OpenSQLite(filepath.Join(t.TempDir(), "project-web.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	if e = store.UpdateSettings(ctx, persistence.Settings{Theme: "system", Locale: "en", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "a"}}}); e != nil {
		t.Fatal(e)
	}
	upstream := &modelStreamsProvider{streams: map[string][]provider.CompletionStream{"a": {
		&fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "First answer"}, {Type: provider.EventCompleted}}},
		&fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "Follow answer"}, {Type: provider.EventCompleted}}},
		&fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "Retry answer"}, {Type: provider.EventCompleted}}},
	}}}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a"), upstream, store)
	document, e := documents.Parse(ctx, documents.Input{Name: "article.txt", Data: []byte("Frozen fixed webpage evidence.")})
	if e != nil {
		t.Fatal(e)
	}
	document.Web = &documents.WebSource{OriginalURL: "https://fixture.example/article", FinalURL: "https://fixture.example/article", FetchedAt: time.Now().UTC().Format(time.RFC3339Nano), ContentSHA256: document.ID}
	service.webReader = fixtureWebReader{document}
	p, e := service.SaveProject(ctx, "", persistence.ProjectInput{Name: "Web project", Background: "Web project background"})
	if e != nil {
		t.Fatal(e)
	}
	prepared, e := service.PrepareWebSource(ctx, "owner", document.Web.OriginalURL)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = service.AddProjectSource(ctx, p.ID, p.Revision, documents.Input{}, "another-session", prepared.SourceToken); e == nil {
		t.Fatal("another session pinned the prepared webpage")
	}
	p, e = service.AddProjectSource(ctx, p.ID, p.Revision, documents.Input{}, "owner", prepared.SourceToken)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.Sources) != 1 || p.Sources[0].Snapshot.Web.FinalURL != document.Web.FinalURL {
		t.Fatal("project did not retain webpage provenance")
	}
	if _, e = service.AddProjectSource(ctx, p.ID, p.Revision, documents.Input{}, "owner", prepared.SourceToken); e == nil {
		t.Fatal("saved webpage preview token was not consumed")
	}
	c, e := service.CreateProjectConversation(ctx, "", p.ID, "")
	if e != nil {
		t.Fatal(e)
	}
	_, expected, e := service.PreviewProjectContext(ctx, c.ID)
	if e != nil {
		t.Fatal(e)
	}
	first, e := service.StartGenerationBatch(ctx, SendInput{ConversationID: c.ID, ClientRequestID: "web-project-first", Body: "First question", ExpectedProject: &expected})
	if e != nil {
		t.Fatal(e)
	}
	waitFileBatch(t, service, first.Batch.ID)
	p, e = service.RemoveProjectSource(ctx, p.ID, p.Sources[0].ID, p.Revision)
	if e != nil {
		t.Fatal(e)
	}
	_, expected, e = service.PreviewProjectContext(ctx, c.ID)
	if e != nil {
		t.Fatal(e)
	}
	follow, e := service.StartGenerationBatch(ctx, SendInput{ConversationID: c.ID, ClientRequestID: "web-project-follow", Body: "Follow question", ExpectedProject: &expected})
	if e != nil {
		t.Fatal(e)
	}
	waitFileBatch(t, service, follow.Batch.ID)
	if e = service.DeleteProject(ctx, p.ID, p.Revision, false, ""); e != nil {
		t.Fatal(e)
	}
	retry, e := service.RetryGenerationTarget(ctx, first.Batch.Targets[0].ID, "web-project-retry")
	if e != nil {
		t.Fatal(e)
	}
	waitForGeneration(t, store, retry.Generation.ID, persistence.GenerationCompleted)
	messages := upstream.messagesFor("a")
	if !strings.Contains(messages[0][len(messages[0])-1].Content, "Frozen fixed webpage evidence.") {
		t.Fatal("saved webpage was absent from first request")
	}
	if strings.Contains(messages[1][len(messages[1])-1].Content, "Frozen fixed webpage evidence.") {
		t.Fatal("removed webpage was injected into a new batch")
	}
	if !reflect.DeepEqual(messages[0], messages[2]) {
		t.Fatal("retry changed fixed webpage input after project dissolution")
	}
	original, e := service.ReadAttachment(ctx, first.Batch.ID, document.ID)
	if e != nil || string(original.Data) != string(document.Data) {
		t.Fatal("historical webpage original was lost")
	}
}

func projectDeletionToken(t *testing.T, store *persistence.SQLiteStore, id string) string {
	t.Helper()
	p, err := store.GetProject(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return p.MembershipToken
}
