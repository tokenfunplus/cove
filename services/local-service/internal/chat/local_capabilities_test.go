package chat

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"github.com/tokenfunplus/cove/services/local-service/internal/retrieval"
)

type countedLocalProfiles struct {
	fakeProviderSource
	checks int
}

func (profiles *countedLocalProfiles) ValidateSelection(ctx context.Context, id, model string) error {
	profiles.checks++
	return profiles.fakeProviderSource.ValidateSelection(ctx, id, model)
}

func TestLocalOnlyRejectsRemoteAndResearchBeforeProviderResolution(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(ctx, "Policy fixture")
	if err != nil {
		t.Fatal(err)
	}
	profiles := &countedLocalProfiles{fakeProviderSource: fakeProviderSource{profile: testProfile()}}
	upstream := &fakeProvider{}
	service := NewService(store, profiles, upstream)
	for _, research := range []bool{false, true} {
		_, err = service.StartGenerationBatch(ctx, SendInput{ConversationID: conversation.ID, ClientRequestID: "local-policy", ProviderID: "remote", ModelID: "remote-model", Body: "Keep this local", LocalOnly: true, WebSearchEnabled: research})
		if !errors.Is(err, ErrLocalOnly) {
			t.Fatalf("local policy was not enforced: %v", err)
		}
	}
	if profiles.checks != 0 || upstream.calls != 0 {
		t.Fatal("rejected local-only input contacted the Provider")
	}
	view, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil || len(view.Messages) != 0 {
		t.Fatal("rejected policy saved a partial turn", err)
	}
}

func TestLocalOnlyIsSavedWithTheAcceptedBatch(t *testing.T) {
	for _, id := range []string{localmodels.ChatID, localmodels.Qwen3AbliteratedID} {
		t.Run(id, func(t *testing.T) { testLocalOnlySavedBatch(t, id) })
	}
}

func testLocalOnlySavedBatch(t *testing.T, modelID string) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conversation, err := store.CreateConversation(ctx, "Local policy fixture")
	if err != nil {
		t.Fatal(err)
	}
	profile := testProfile()
	profile.ID = localmodels.ProviderID
	profile.Kind = provider.KindLocal
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "Local fixture"}, {Type: provider.EventCompleted}}}}
	service := NewService(store, fakeProviderSource{profile: profile}, upstream)
	started, err := service.StartGenerationBatch(ctx, SendInput{ConversationID: conversation.ID, ClientRequestID: "local-only-accepted", ProviderID: localmodels.ProviderID, ModelID: modelID, Body: "Fixture", LocalOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		batch, e := store.GetGenerationBatch(ctx, started.Batch.ID)
		if e != nil {
			t.Fatal(e)
		}
		if !batch.LocalOnly {
			t.Fatal("accepted batch lost its execution policy")
		}
		if batch.State == persistence.GenerationBatchCompleted {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("local fixture did not finish")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestProjectSearchPreservesFixedInputsAndRejectsOtherScopes(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store, nil, nil)
	service.localDocuments = store
	service.retrieval = retrieval.New(store, localFixtureEngine{})
	project, err := store.SaveProject(ctx, "", persistence.ProjectInput{Name: "Scoped project"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := documents.Parse(ctx, documents.Input{Name: "policy.txt", Data: []byte("Backups last thirty days.")})
	if err != nil {
		t.Fatal(err)
	}
	project, err = store.AddProjectSource(ctx, project.ID, project.Revision, source)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateProjectConversation(ctx, "Scoped chat", project.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	before, _, err := store.PreviewProjectContext(ctx, conversation.ID)
	if err != nil || len(before.Sources) != 1 {
		t.Fatal("existing material was not always included", err)
	}
	project, err = service.SetProjectSourceUsage(ctx, project.ID, project.Sources[0].ID, project.Revision, "search")
	if err != nil {
		t.Fatal(err)
	}
	after, _, err := store.PreviewProjectContext(ctx, conversation.ID)
	if err != nil || len(after.Sources) != 0 || strings.Contains(after.ReferencePrefix, source.Sections[0].Text) {
		t.Fatal("search-only source leaked into fixed input", err)
	}
	result, err := service.SearchProjectDocuments(ctx, project.ID, []string{source.ID}, "backups")
	if err != nil || len(result.Hits) != 1 {
		t.Fatal("scoped search failed", err)
	}
	selected, err := service.PrepareProjectSources(ctx, project.ID, "owner", []retrieval.Selection{{DocumentID: source.ID, Ordinal: 0}})
	if err != nil {
		t.Fatal(err)
	}
	if selected[0].Snapshot.Retrieval.ProjectID != project.ID || selected[0].Snapshot.Sections[0] != source.Sections[0] {
		t.Fatal("project retrieval lost scope or source fidelity")
	}
	if global, err := store.ListLocalDocuments(ctx); err != nil || len(global) != 0 {
		t.Fatal("project material was copied into the global library", err)
	}
	other, err := store.SaveProject(ctx, "", persistence.ProjectInput{Name: "Other project"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.SearchProjectDocuments(ctx, other.ID, []string{source.ID}, "backups"); err == nil {
		t.Fatal("search read another project's source")
	}
	unrelated, err := store.CreateConversation(ctx, "Unrelated chat")
	if err != nil {
		t.Fatal(err)
	}
	input := SendInput{ConversationID: unrelated.ID, Body: "Question", WebSourceOwner: "owner", WebSourceTokens: []string{selected[0].SourceToken}}
	if _, _, err = service.prepareAttachments(ctx, input, ""); err == nil {
		t.Fatal("project source token entered an unrelated chat")
	}
	input.ConversationID = conversation.ID
	if _, _, err = service.prepareAttachments(ctx, input, ""); err != nil {
		t.Fatal(err)
	}
	_, err = service.SetProjectSourceUsage(ctx, project.ID, project.Sources[0].ID, project.Revision, "always")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.preparedWebSources("owner", input.WebSourceTokens); err == nil {
		t.Fatal("changed source usage retained pending retrieval tokens")
	}
	if _, err = service.SetProjectSourceUsage(ctx, project.ID, project.Sources[0].ID, project.Revision, "search"); !errors.Is(err, persistence.ErrProjectChanged) {
		t.Fatal("stale usage change bypassed revision admission", err)
	}
}
