package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
)

const webSourceTTL = 15 * time.Minute
const maxPreparedWebSources = 16

type webSourceReader interface {
	Fetch(context.Context, string) (documents.Prepared, error)
}

type PreparedWebSource struct {
	SourceToken string             `json:"source_token"`
	Snapshot    documents.Snapshot `json:"snapshot"`
}

type preparedWebSource struct {
	owner    string
	expires  time.Time
	document documents.Prepared
}

// PrepareWebSource performs network work outside Generation admission locks.
func (service *Service) PrepareWebSource(ctx context.Context, owner, sourceURL string) (PreparedWebSource, error) {
	if owner == "" {
		return PreparedWebSource{}, fmt.Errorf("%w: A browser session is required.", documents.ErrInvalidDocument)
	}
	service.webMu.Lock()
	epoch := service.webEpoch
	service.webMu.Unlock()
	document, err := service.webReader.Fetch(ctx, sourceURL)
	if err != nil {
		return PreparedWebSource{}, err
	}
	if err := ctx.Err(); err != nil {
		return PreparedWebSource{}, err
	}
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return PreparedWebSource{}, err
	}
	token := hex.EncodeToString(random[:])
	service.webMu.Lock()
	defer service.webMu.Unlock()
	service.expireWebSources()
	if service.webEpoch != epoch {
		return PreparedWebSource{}, fmt.Errorf("%w: The draft was cleared. Read the webpage again.", documents.ErrInvalidDocument)
	}
	if len(service.webSources) >= maxPreparedWebSources {
		return PreparedWebSource{}, fmt.Errorf("%w: Too many webpage previews are open. Remove unused sources and try again.", documents.ErrInvalidDocument)
	}
	service.webSources[token] = preparedWebSource{owner: owner, expires: time.Now().Add(webSourceTTL), document: document}
	return PreparedWebSource{SourceToken: token, Snapshot: document.Snapshot}, nil
}

func (service *Service) ReleaseWebSource(_ context.Context, owner, token string) {
	service.webMu.Lock()
	defer service.webMu.Unlock()
	if item, ok := service.webSources[token]; ok && item.owner == owner {
		delete(service.webSources, token)
	}
}

// The caller holds webMu. Expiry is lazy, keeping the cache bounded without timers.
func (service *Service) expireWebSources() {
	for token, item := range service.webSources {
		if !time.Now().Before(item.expires) {
			delete(service.webSources, token)
		}
	}
}

func (service *Service) preparedWebSources(owner string, tokens []string) ([]documents.Prepared, error) {
	service.webMu.Lock()
	defer service.webMu.Unlock()
	service.expireWebSources()
	var sources []documents.Prepared
	for _, token := range tokens {
		item, ok := service.webSources[token]
		if !ok || owner == "" || item.owner != owner {
			return nil, fmt.Errorf("%w: The webpage preview expired or is unavailable. Remove it and read the webpage again.", documents.ErrInvalidDocument)
		}
		sources = append(sources, item.document)
	}
	return sources, nil
}

func (service *Service) clearPreparedWebSources() {
	service.webMu.Lock()
	defer service.webMu.Unlock()
	clear(service.webSources)
	service.webEpoch++
}
