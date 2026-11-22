package chat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type ProjectPreview struct {
	Messages []provider.ProviderMessage
	Project  *persistence.ProjectContext
	Expected persistence.ProjectExpectation
}

func (s *Service) PreviewProjectGenerationContext(ctx context.Context, input SendInput) (ProjectPreview, error) {
	p, x, e := s.PreviewProjectContext(ctx, input.ConversationID)
	if e != nil {
		return ProjectPreview{}, e
	}
	input.PreviewOnly = true
	input.previewProject = p
	input.previewProjectSet = true
	messages, e := s.PreviewGenerationContext(ctx, input)
	return ProjectPreview{Messages: messages, Project: p, Expected: x}, e
}

type ProjectChat interface {
	ListProjectConversations(context.Context, bool, string) ([]persistence.Conversation, error)
	PreviewProjectGenerationContext(context.Context, SendInput) (ProjectPreview, error)
	ListProjects(context.Context) ([]persistence.Project, error)
	GetProject(context.Context, string) (persistence.Project, error)
	SaveProject(context.Context, string, persistence.ProjectInput) (persistence.Project, error)
	AddProjectSource(context.Context, string, int64, documents.Input, string, string) (persistence.Project, error)
	RemoveProjectSource(context.Context, string, string, int64) (persistence.Project, error)
	CreateProjectConversation(context.Context, string, string, string) (persistence.Conversation, error)
	MoveProjectConversation(context.Context, string, string, int64) error
	DeleteProject(context.Context, string, int64, bool, string) error
	PreviewProjectContext(context.Context, string) (*persistence.ProjectContext, persistence.ProjectExpectation, error)
}

func (s *Service) projectStore() (persistence.ProjectStore, error) {
	p, ok := s.store.(persistence.ProjectStore)
	if !ok {
		return nil, errors.New("project storage is unavailable")
	}
	return p, nil
}
func (s *Service) ListProjectConversations(ctx context.Context, archived bool, id string) ([]persistence.Conversation, error) {
	p, e := s.projectStore()
	if e != nil {
		return nil, e
	}
	return p.ListProjectConversations(ctx, archived, id)
}
func (s *Service) ListProjects(ctx context.Context) ([]persistence.Project, error) {
	p, e := s.projectStore()
	if e != nil {
		return nil, e
	}
	return p.ListProjects(ctx)
}
func (s *Service) GetProject(ctx context.Context, id string) (persistence.Project, error) {
	p, e := s.projectStore()
	if e != nil {
		return persistence.Project{}, e
	}
	return p.GetProject(ctx, id)
}
func (s *Service) SaveProject(ctx context.Context, id string, in persistence.ProjectInput) (persistence.Project, error) {
	p, e := s.projectStore()
	if e != nil {
		return persistence.Project{}, e
	}
	return p.SaveProject(ctx, id, in)
}
func (s *Service) AddProjectSource(ctx context.Context, id string, rev int64, input documents.Input, owner, token string) (persistence.Project, error) {
	p, e := s.projectStore()
	if e != nil {
		return persistence.Project{}, e
	}
	var source documents.Prepared
	if token != "" {
		if len(input.Data) > 0 {
			return persistence.Project{}, persistence.ErrInvalidProject
		}
		items, err := s.preparedWebSources(owner, []string{token})
		if err != nil {
			return persistence.Project{}, err
		}
		source = items[0]
	} else {
		source, e = s.parseAttachment(ctx, input)
		if e != nil {
			return persistence.Project{}, e
		}
	}
	result, e := p.AddProjectSource(ctx, id, rev, source)
	if e == nil && token != "" {
		s.ReleaseWebSource(ctx, owner, token)
	}
	return result, e
}
func (s *Service) RemoveProjectSource(ctx context.Context, id, source string, rev int64) (persistence.Project, error) {
	p, e := s.projectStore()
	if e != nil {
		return persistence.Project{}, e
	}
	var result persistence.Project
	change := func() error {
		var err error
		result, err = p.RemoveProjectSource(ctx, id, source, rev)
		if err == nil {
			s.invalidateLocalSources("")
		}
		return err
	}
	if s.retrieval != nil {
		e = s.retrieval.Exclusive(ctx, change)
	} else {
		e = change()
	}
	return result, e
}
func (s *Service) CreateProjectConversation(ctx context.Context, title, project, source string) (persistence.Conversation, error) {
	p, e := s.projectStore()
	if e != nil {
		return persistence.Conversation{}, e
	}
	return p.CreateProjectConversation(ctx, title, project, source)
}
func (s *Service) PreviewProjectContext(ctx context.Context, id string) (*persistence.ProjectContext, persistence.ProjectExpectation, error) {
	p, ok := s.store.(persistence.ProjectStore)
	if !ok {
		return nil, persistence.ProjectExpectation{}, nil
	}
	return p.PreviewProjectContext(ctx, id)
}
func (s *Service) MoveProjectConversation(ctx context.Context, id, project string, rev int64) error {
	s.startMu.Lock()
	defer s.startMu.Unlock()
	if e := s.requireGenerationIdle(ctx); e != nil {
		return e
	}
	p, e := s.projectStore()
	if e != nil {
		return e
	}
	return p.MoveConversation(ctx, id, project, rev)
}
func (s *Service) DeleteProject(ctx context.Context, id string, rev int64, removeConversations bool, membershipToken string) error {
	s.startMu.Lock()
	defer s.startMu.Unlock()
	p, e := s.projectStore()
	if e != nil {
		return e
	}
	current, e := p.GetProject(ctx, id)
	if e != nil {
		return e
	}
	if current.Revision != rev || (removeConversations && current.MembershipToken != membershipToken) {
		return persistence.ErrProjectChanged
	}
	if !removeConversations {
		if e = s.requireGenerationIdle(ctx); e != nil {
			return e
		}
	} else {
		for _, archived := range []bool{false, true} {
			items, err := p.ListProjectConversations(ctx, archived, id)
			if err != nil {
				return err
			}
			for _, c := range items {
				if err = s.stopConversationWork(ctx, c.ID); err != nil {
					return err
				}
			}
		}
	}
	return p.DeleteProject(ctx, id, rev, removeConversations, membershipToken)
}
func projectInstructions(base string, p *persistence.ProjectContext) string {
	if p == nil || p.Instructions == "" {
		return base
	}
	if base == "" {
		return p.Instructions
	}
	return base + "\n\nProject instructions:\n" + p.Instructions
}
func projectUserContent(body string, p *persistence.ProjectContext) string {
	if p == nil {
		return body
	}
	return p.ReferencePrefix + body
}
func validateMessages(messages []provider.ProviderMessage) error {
	n := 0
	for _, m := range messages {
		n += utf8.RuneCountInString(m.Content)
	}
	if n > documents.MaxContextCharacters {
		return documents.ErrContextLimit
	}
	return nil
}
func (s *Service) projectForInput(ctx context.Context, input SendInput, attachments []documents.Prepared, content, base string) (*persistence.ProjectContext, error) {
	p := input.previewProject
	var e error
	if !input.previewProjectSet {
		p, _, e = s.PreviewProjectContext(ctx, input.ConversationID)
	}
	if e != nil {
		return nil, e
	}
	count, chars := len(attachments), 0
	for _, a := range attachments {
		chars += a.Characters
	}
	if p != nil {
		for _, a := range p.Sources {
			for _, attachment := range attachments {
				if a.Snapshot.ID == attachment.ID {
					return nil, fmt.Errorf("%w: This source is already included by the project. Change its use to Search when needed before attaching selected passages.", documents.ErrInvalidDocument)
				}
			}
			count++
			chars += a.Snapshot.Characters
		}
	}
	if count > documents.MaxFiles || chars > documents.MaxSourceCharacters {
		return nil, fmt.Errorf("%w: Fixed project sources and turn attachments must fit within four sources and 120,000 extracted characters.", documents.ErrInvalidDocument)
	}
	var items []persistence.ContextItem
	if input.EditOfBatchID != "" {
		items, e = s.store.LoadGenerationBatchContext(ctx, input.EditOfBatchID)
	} else {
		items, e = s.store.LoadBatchContext(ctx, input.ConversationID)
	}
	if e != nil {
		return nil, e
	}
	batch := persistence.GenerationBatch{ProjectContext: p}
	messages := messagesFromBatchContext(batch, content, persistence.GenerationConfigurationSnapshot{SystemPrompt: base}, items)
	if input.PreviewOnly {
		return p, nil
	}
	return p, validateMessages(messages)
}
func readProjectAttachment(ctx context.Context, store persistence.ChatStore, batch, document string) (documents.Input, error) {
	p, ok := store.(interface {
		ReadBatchProjectOriginal(context.Context, string, string) (documents.Input, error)
	})
	if !ok {
		return documents.Input{}, sql.ErrNoRows
	}
	return p.ReadBatchProjectOriginal(ctx, batch, document)
}
