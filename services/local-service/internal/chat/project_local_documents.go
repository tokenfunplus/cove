package chat

import (
	"context"
	"errors"

	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/retrieval"
)

func (service *Service) projectLibrary(id string) (*persistence.ProjectLibrary, error) {
	store, ok := service.localDocuments.(interface {
		ProjectLibrary(string) *persistence.ProjectLibrary
	})
	if !ok || service.retrieval == nil || id == "" {
		return nil, errors.New("Project document search is unavailable.")
	}
	return store.ProjectLibrary(id), nil
}

func (service *Service) ListProjectDocuments(ctx context.Context, id string) ([]persistence.LocalDocument, error) {
	library, err := service.projectLibrary(id)
	if err != nil {
		return nil, err
	}
	return library.ListLocalDocuments(ctx)
}

func (service *Service) ReindexProjectDocument(ctx context.Context, project, id string) error {
	library, err := service.projectLibrary(project)
	if err != nil {
		return err
	}
	return service.retrieval.Exclusive(ctx, func() error { return service.retrieval.WithStore(library).Reindex(ctx, id) })
}

func (service *Service) SearchProjectDocuments(ctx context.Context, project string, ids []string, query string) (retrieval.Results, error) {
	library, err := service.projectLibrary(project)
	if err != nil {
		return retrieval.Results{}, err
	}
	var result retrieval.Results
	err = service.retrieval.Exclusive(ctx, func() error {
		if len(ids) == 0 || len(ids) > 4 {
			return errors.New("Select one to four project materials.")
		}
		engine := service.retrieval.WithStore(library)
		model, _ := localmodels.Lookup(localmodels.EmbeddingID)
		for _, id := range ids {
			chunks, e := library.ReadLocalChunks(ctx, id, model.SHA256, retrieval.IndexVersion)
			if e != nil {
				return e
			}
			if len(chunks) == 0 {
				if e = engine.Reindex(ctx, id); e != nil {
					return e
				}
			}
		}
		var e error
		result, e = engine.Search(ctx, ids, query)
		return e
	})
	return result, err
}

func (service *Service) PrepareProjectSources(ctx context.Context, project, owner string, selections []retrieval.Selection) ([]PreparedWebSource, error) {
	library, err := service.projectLibrary(project)
	if err != nil {
		return nil, err
	}
	var result []PreparedWebSource
	err = service.retrieval.Exclusive(ctx, func() error {
		var e error
		result, e = service.prepareRetrievalSources(ctx, owner, selections, service.retrieval.WithStore(library), project)
		return e
	})
	return result, err
}

func (service *Service) SetProjectSourceUsage(ctx context.Context, project, source string, revision int64, usage string) (persistence.Project, error) {
	store, ok := service.store.(interface {
		SetProjectSourceUsage(context.Context, string, string, int64, string) (persistence.Project, error)
	})
	if !ok {
		return persistence.Project{}, errors.New("Project materials are unavailable.")
	}
	var result persistence.Project
	change := func() error {
		var e error
		result, e = store.SetProjectSourceUsage(ctx, project, source, revision, usage)
		if e == nil {
			service.invalidateLocalSources("")
		}
		return e
	}
	var err error
	if service.retrieval != nil {
		err = service.retrieval.Exclusive(ctx, change)
	} else {
		err = change()
	}
	return result, err
}
