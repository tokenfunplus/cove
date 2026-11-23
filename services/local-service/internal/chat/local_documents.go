package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/retrieval"
	"github.com/tokenfunplus/cove/services/local-service/internal/speech"
)

func (service *Service) SetLocalModels(models *localmodels.Manager, store retrieval.Store) {
	service.localModels = models
	service.localDocuments = store
	service.retrieval = retrieval.New(store, models)
}
func (service *Service) LocalModels() ([]localmodels.Status, error) {
	if service.localModels == nil && service.speech == nil {
		return nil, errors.New("Local models are unavailable.")
	}
	statuses := []localmodels.Status{}
	if service.localModels != nil {
		statuses = service.localModels.Statuses()
	}
	if service.speech != nil {
		statuses = append(statuses, service.speech.Statuses()...)
	}
	return statuses, nil
}
func (service *Service) InstallLocalModel(id string) error {
	if speech.IsModel(id) && service.speech != nil {
		return service.speech.Install(id)
	}
	if service.localModels == nil {
		return errors.New("Local models are unavailable.")
	}
	return service.localModels.Install(id)
}
func (service *Service) CancelLocalModel(ctx context.Context, id string) error {
	if speech.IsModel(id) && service.speech != nil {
		return service.speech.CancelDownload(ctx, id)
	}
	if service.localModels == nil {
		return errors.New("Local models are unavailable.")
	}
	return service.localModels.CancelDownload(ctx, id)
}
func (service *Service) RemoveLocalModel(ctx context.Context, id string) error {
	if speech.IsModel(id) && service.speech != nil {
		return service.speech.Remove(ctx, id)
	}
	if service.localModels == nil {
		return errors.New("Local models are unavailable.")
	}
	if localmodels.IsChatModel(id) {
		service.startMu.Lock()
		defer service.startMu.Unlock()
		if service.HasActiveGenerationBatch() {
			return ErrGenerationInProgress
		}
	}
	if id != localmodels.EmbeddingID {
		return service.localModels.Remove(ctx, id)
	}
	return service.retrieval.Exclusive(ctx, func() error {
		if err := service.localModels.Remove(ctx, id); err != nil {
			return err
		}
		if err := service.localDocuments.ClearLocalIndexes(ctx); err != nil {
			return err
		}
		service.invalidateLocalSources("")
		return nil
	})
}
func (service *Service) ListLocalDocuments(ctx context.Context) ([]persistence.LocalDocument, error) {
	if service.localDocuments == nil {
		return nil, errors.New("Local documents are unavailable.")
	}
	return service.localDocuments.ListLocalDocuments(ctx)
}
func (service *Service) ImportLocalDocument(ctx context.Context, input documents.Input) error {
	if service.retrieval == nil {
		return errors.New("Local documents are unavailable.")
	}
	epoch := service.libraryEpoch.Load()
	return service.retrieval.ImportWith(ctx, func() (documents.Prepared, error) {
		if epoch != service.libraryEpoch.Load() {
			return documents.Prepared{}, errors.New("The library was cleared. Add the document again.")
		}
		return service.parseAttachment(ctx, input)
	})
}
func (service *Service) ReindexLocalDocument(ctx context.Context, id string) error {
	if service.retrieval == nil {
		return errors.New("Local documents are unavailable.")
	}
	return service.retrieval.Reindex(ctx, id)
}
func (service *Service) DeleteLocalDocument(ctx context.Context, id string) error {
	if service.retrieval == nil {
		return errors.New("Local documents are unavailable.")
	}
	return service.retrieval.Exclusive(ctx, func() error {
		if err := service.localDocuments.DeleteLocalDocument(ctx, id); err != nil {
			return err
		}
		service.invalidateLocalSources(id)
		return nil
	})
}
func (service *Service) SearchLocalDocuments(ctx context.Context, ids []string, query string, minimum ...float64) (retrieval.Results, error) {
	if service.retrieval == nil {
		return retrieval.Results{}, errors.New("Local documents are unavailable.")
	}
	cutoff := 0.0
	if len(minimum) > 0 {
		cutoff = minimum[0]
	}
	return service.retrieval.SearchAbove(ctx, ids, query, cutoff)
}
func (service *Service) PrepareLocalSources(ctx context.Context, owner string, selections []retrieval.Selection) ([]PreparedWebSource, error) {
	return service.prepareRetrievalSources(ctx, owner, selections, service.retrieval, "")
}

func (service *Service) prepareRetrievalSources(ctx context.Context, owner string, selections []retrieval.Selection, search *retrieval.Service, projectID string) ([]PreparedWebSource, error) {
	if search == nil || owner == "" {
		return nil, errors.New("Local documents are unavailable.")
	}
	result := []PreparedWebSource{}
	err := search.Selected(ctx, selections, func(sources []documents.Prepared) error {
		var characters int
		for _, source := range sources {
			characters += source.Characters
		}
		if characters > documents.MaxSourceCharacters {
			return documents.ErrContextLimit
		}
		service.webMu.Lock()
		defer service.webMu.Unlock()
		if err := ctx.Err(); err != nil {
			return err
		}
		service.expireWebSources()
		if len(service.webSources)+len(sources) > maxPreparedWebSources {
			return errors.New("Too many source previews are open. Remove unused sources and try again.")
		}
		tokens := make([]string, len(sources))
		for i := range sources {
			var random [32]byte
			if _, err := rand.Read(random[:]); err != nil {
				return err
			}
			tokens[i] = hex.EncodeToString(random[:])
		}
		expires := time.Now().Add(webSourceTTL)
		for i, source := range sources {
			if source.Retrieval != nil {
				source.Retrieval.ProjectID = projectID
			}
			service.webSources[tokens[i]] = preparedWebSource{owner: owner, expires: expires, document: source}
			result = append(result, PreparedWebSource{SourceToken: tokens[i], ExpiresAt: expires.UTC().Format(time.RFC3339), Snapshot: source.Snapshot})
		}
		return nil
	})
	return result, err
}
func (service *Service) invalidateLocalSources(id string) {
	service.webMu.Lock()
	defer service.webMu.Unlock()
	for token, item := range service.webSources {
		if item.document.Retrieval != nil && (id == "" || item.document.Retrieval.ProjectID == "" && item.document.ID == id) {
			delete(service.webSources, token)
		}
	}
}
