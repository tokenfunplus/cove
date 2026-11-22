package chat

import (
	"context"
	"errors"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"github.com/tokenfunplus/cove/services/local-service/internal/speech"
	"testing"
	"time"
)

type cancellationSpeech struct {
	*speech.Manager
	canceled []string
	failure  error
}

func (s *cancellationSpeech) CancelConversation(_ context.Context, id string) error {
	s.canceled = append(s.canceled, id)
	return s.failure
}

func TestProjectConversationDeletionCancelsSpeechBeforeRemovingHistory(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "cleanup", true: "cleanup_failure"}[fail], func(t *testing.T) {
			ctx := context.Background()
			store, err := persistence.OpenSQLite(":memory:")
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			service := NewService(store, nil, nil)
			project, err := store.SaveProject(ctx, "", persistence.ProjectInput{Name: "Speech ownership"})
			if err != nil {
				t.Fatal(err)
			}
			conversation, err := store.CreateProjectConversation(ctx, "", project.ID, "")
			if err != nil {
				t.Fatal(err)
			}
			project, err = store.GetProject(ctx, project.ID)
			if err != nil {
				t.Fatal(err)
			}
			voices := &cancellationSpeech{}
			if fail {
				voices.failure = errors.New("cleanup fixture failure")
			}
			service.speech = voices
			err = service.DeleteProject(ctx, project.ID, project.Revision, true, project.MembershipToken)
			if len(voices.canceled) != 1 || voices.canceled[0] != conversation.ID {
				t.Fatal("project deletion bypassed speech ownership cleanup")
			}
			_, readErr := store.LoadConversation(ctx, conversation.ID)
			if fail {
				if err == nil || readErr != nil {
					t.Fatal("cleanup failure deleted history", err, readErr)
				}
			} else if err != nil || readErr == nil {
				t.Fatal("cleaned project history remained", err, readErr)
			}
		})
	}
}

type committedProjectStore struct {
	*persistence.SQLiteStore
	reloadFailure bool
}

func (s *committedProjectStore) RemoveProjectSource(ctx context.Context, p, id string, rev int64) (persistence.Project, error) {
	v, e := s.SQLiteStore.RemoveProjectSource(ctx, p, id, rev)
	if e == nil && s.reloadFailure {
		return v, context.Canceled
	}
	return v, e
}
func (s *committedProjectStore) SetProjectSourceUsage(ctx context.Context, p, id string, rev int64, use string) (persistence.Project, error) {
	v, e := s.SQLiteStore.SetProjectSourceUsage(ctx, p, id, rev, use)
	if e == nil && s.reloadFailure {
		return v, context.Canceled
	}
	return v, e
}

func TestProjectSourceMutationInvalidatesOnlyItsOwnPreparedPassages(t *testing.T) {
	for _, remove := range []bool{false, true} {
		for _, reloadFailure := range []bool{false, true} {
			t.Run(map[bool]string{false: "usage", true: "remove"}[remove]+map[bool]string{false: "", true: "_reload_error"}[reloadFailure], func(t *testing.T) {
				ctx := context.Background()
				sqlite, err := persistence.OpenSQLite(":memory:")
				if err != nil {
					t.Fatal(err)
				}
				defer sqlite.Close()
				store := &committedProjectStore{SQLiteStore: sqlite, reloadFailure: reloadFailure}
				service := NewService(store, nil, nil)
				p, _ := store.SaveProject(ctx, "", persistence.ProjectInput{Name: "One"})
				p, err = service.AddProjectSource(ctx, p.ID, p.Revision, documents.Input{Name: "a.txt", Data: []byte("Source A")}, "", "")
				if err != nil {
					t.Fatal(err)
				}
				p, err = service.AddProjectSource(ctx, p.ID, p.Revision, documents.Input{Name: "b.txt", Data: []byte("Source B")}, "", "")
				if err != nil {
					t.Fatal(err)
				}
				a, b := p.Sources[0], p.Sources[1]
				for _, item := range []struct{ token, project, snapshot string }{{"affected", p.ID, a.Snapshot.ID}, {"same-project", p.ID, b.Snapshot.ID}, {"other-project", "other", a.Snapshot.ID}, {"library", "", a.Snapshot.ID}} {
					service.webSources[item.token] = preparedWebSource{owner: "owner", expires: time.Now().Add(time.Hour), document: documents.Prepared{Snapshot: documents.Snapshot{ID: item.snapshot, Retrieval: &documents.Retrieval{ProjectID: item.project}}}}
				}
				if remove {
					_, err = service.RemoveProjectSource(ctx, p.ID, a.ID, p.Revision)
				} else {
					_, err = service.SetProjectSourceUsage(ctx, p.ID, a.ID, p.Revision, "search")
				}
				if (err != nil) != reloadFailure {
					t.Fatal("unexpected mutation result", err)
				}
				if _, ok := service.webSources["affected"]; ok {
					t.Fatal("affected prepared source survived a committed mutation")
				}
				for _, token := range []string{"same-project", "other-project", "library"} {
					if _, ok := service.webSources[token]; !ok {
						t.Fatalf("unrelated %s preview was invalidated", token)
					}
				}
			})
		}
	}
}

func TestCurrentLocalOnlyRetryRejectsRemoteBeforeResolution(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	c, _ := store.CreateConversation(ctx, "Retry consent")
	profiles := &countedLocalProfiles{fakeProviderSource: fakeProviderSource{profile: testProfile()}}
	upstream := &fakeProvider{stream: &fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "Saved answer"}, {Type: provider.EventCompleted}}}}
	service := NewService(store, profiles, upstream)
	batch, err := service.StartGenerationBatch(ctx, SendInput{ConversationID: c.ID, ClientRequestID: "first", ProviderID: testProfile().ID, ModelID: testProfile().Model, Body: "Remote turn"})
	if err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, batch.Batch.ID)
	checks, calls := profiles.checks, upstream.calls
	_, err = service.RetryGenerationTarget(ctx, batch.Batch.Targets[0].ID, "restricted-retry", true)
	if !errors.Is(err, ErrLocalOnly) || profiles.checks != checks || upstream.calls != calls {
		t.Fatal("restricted retry crossed Provider resolution", err)
	}
	if _, err = store.GetGenerationByClientRequestID(ctx, "restricted-retry"); err == nil {
		t.Fatal("rejected retry saved an attempt")
	}
}

func TestEditedBranchRetainsAttachmentsLaterAddedAsProjectMaterial(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.UpdateSettings(ctx, persistence.Settings{Theme: "system", Locale: "en", ActiveModelSet: []persistence.ActiveModelTarget{{ProviderID: "provider-a", ModelID: "a"}}}); err != nil {
		t.Fatal(err)
	}
	upstream := &modelStreamsProvider{streams: map[string][]provider.CompletionStream{"a": {&fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "First"}, {Type: provider.EventCompleted}}}, &fakeStream{events: []provider.Event{{Type: provider.EventDelta, Delta: "Edited"}, {Type: provider.EventCompleted}}}}}}
	service := NewServiceWithSettings(store, fakeProviderProfiles("provider-a"), upstream, store)
	p, err := service.SaveProject(ctx, "", persistence.ProjectInput{Name: "Attachment provenance"})
	if err != nil {
		t.Fatal(err)
	}
	c, err := service.CreateProjectConversation(ctx, "", p.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	file := documents.Input{Name: "guide.txt", Data: []byte("The original attached source.")}
	input := SendInput{ConversationID: c.ID, ClientRequestID: "original", Body: "Original question", Attachments: []documents.Input{file}}
	preview, err := service.PreviewProjectGenerationContext(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	input.ExpectedProject = &preview.Expected
	first, err := service.StartGenerationBatch(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, first.Batch.ID)
	p, err = service.AddProjectSource(ctx, p.ID, p.Revision, file, "", "")
	if err != nil {
		t.Fatal(err)
	}
	input = SendInput{ConversationID: c.ID, ClientRequestID: "edited", EditOfBatchID: first.Batch.ID, Body: "Edited question"}
	preview, err = service.PreviewProjectGenerationContext(ctx, input)
	if err != nil {
		t.Fatal("inherited attachment was rejected", err)
	}
	input.ExpectedProject = &preview.Expected
	branch, err := service.StartGenerationBatch(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	waitFileBatch(t, service, branch.Batch.ID)
	if branch.Batch.ConversationID == c.ID || len(branch.Batch.Attachments) != 1 || branch.Batch.Attachments[0].ID != first.Batch.Attachments[0].ID {
		t.Fatal("branch did not retain its immutable attachment snapshot")
	}
}
