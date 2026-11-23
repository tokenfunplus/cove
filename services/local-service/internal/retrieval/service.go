// Package retrieval performs local semantic retrieval over explicitly selected documents.
package retrieval

import (
	"context"
	"errors"
	"math"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

const IndexVersion = "cove-rune320-v1"

type Embedder interface {
	Embed(context.Context, []string) ([][]float32, error)
	Installed(string) bool
}
type Store interface {
	ListLocalDocuments(context.Context) ([]persistence.LocalDocument, error)
	SaveLocalDocument(context.Context, documents.Prepared, string, string, []persistence.LocalChunk) error
	ReadLocalDocument(context.Context, string) (documents.Prepared, error)
	ReadLocalChunks(context.Context, string, string, string) ([]persistence.LocalChunk, error)
	DeleteLocalDocument(context.Context, string) error
	ClearLocalIndexes(context.Context) error
}
type Service struct {
	store  Store
	engine Embedder
	gate   chan struct{}
}
type Selection struct {
	DocumentID string `json:"document_id"`
	Ordinal    int    `json:"ordinal"`
}
type Hit struct {
	Selection
	Score  float64            `json:"score"`
	Text   string             `json:"text"`
	Source documents.Snapshot `json:"source"`
}
type Results struct {
	Hits         []Hit  `json:"hits"`
	ElapsedMS    int64  `json:"elapsed_ms"`
	ModelSHA256  string `json:"model_sha256"`
	IndexVersion string `json:"index_version"`
}

func New(store Store, engine Embedder) *Service {
	return &Service{store: store, engine: engine, gate: make(chan struct{}, 1)}
}

// WithStore reuses the embedding engine for an explicitly scoped document store.
// Callers serialize the scoped operation with the parent library lease.
func (service *Service) WithStore(store Store) *Service { return New(store, service.engine) }

func (service *Service) Exclusive(ctx context.Context, work func() error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case service.gate <- struct{}{}:
		defer func() { <-service.gate }()
		if err := ctx.Err(); err != nil {
			return err
		}
		return work()
	case <-ctx.Done():
		return ctx.Err()
	}
}
func hash() string { m, _ := localmodels.Lookup(localmodels.EmbeddingID); return m.SHA256 }

func Chunks(source documents.Snapshot) []persistence.LocalChunk {
	result := []persistence.LocalChunk{}
	current := persistence.LocalChunk{DocumentID: source.ID}
	length := 0
	flush := func() {
		if current.Text != "" {
			current.Ordinal = len(result)
			result = append(result, current)
			current = persistence.LocalChunk{DocumentID: source.ID}
			length = 0
		}
	}
	for _, section := range source.Sections {
		text := []rune(strings.TrimSpace(section.Text))
		for len(text) > 0 {
			room := 320 - length
			if current.Text != "" {
				room--
			}
			if room <= 1 {
				flush()
				room = 320
			}
			count := min(len(text), room)
			piece := string(text[:count])
			text = text[count:]
			if current.Text != "" {
				current.Text += "\n"
				length++
			}
			current.Text += piece
			length += count
			if len(current.Sections) == 0 || current.Sections[len(current.Sections)-1] != section.ID {
				current.Sections = append(current.Sections, section.ID)
			}
			if length >= 319 {
				flush()
			}
		}
	}
	flush()
	return result
}

func (service *Service) Import(ctx context.Context, source documents.Prepared) error {
	return service.ImportWith(ctx, func() (documents.Prepared, error) { return source, nil })
}

// ImportWith admits source parsing and indexing as one library operation.
func (service *Service) ImportWith(ctx context.Context, prepare func() (documents.Prepared, error)) error {
	return service.Exclusive(ctx, func() error {
		source, err := prepare()
		if err != nil {
			return err
		}
		return service.importSource(ctx, source)
	})
}

func (service *Service) Reindex(ctx context.Context, id string) error {
	return service.Exclusive(ctx, func() error {
		source, err := service.store.ReadLocalDocument(ctx, id)
		if err != nil {
			return err
		}
		return service.importSource(ctx, source)
	})
}

func (service *Service) importSource(ctx context.Context, source documents.Prepared) error {
	if !service.engine.Installed(localmodels.EmbeddingID) {
		return errors.New("Install the local document search model first.")
	}
	chunks := Chunks(source.Snapshot)
	if len(chunks) == 0 || len(chunks) > 1024 {
		return errors.New("The document cannot be indexed within the local chunk limit.")
	}
	for start := 0; start < len(chunks); start += 16 {
		end := min(start+16, len(chunks))
		texts := make([]string, end-start)
		for i := start; i < end; i++ {
			texts[i-start] = chunks[i].Text
		}
		vectors, err := service.engine.Embed(ctx, texts)
		if err != nil {
			return err
		}
		if len(vectors) != len(texts) {
			return errors.New("The embedding runtime returned the wrong batch length.")
		}
		for i := start; i < end; i++ {
			chunks[i].Vector = vectors[i-start]
		}
	}
	return service.store.SaveLocalDocument(ctx, source, hash(), IndexVersion, chunks)
}

func (service *Service) Search(ctx context.Context, ids []string, query string) (Results, error) {
	return service.SearchAbove(ctx, ids, query, 0)
}

// SearchAbove applies a user-selected ranking cutoff, never a confidence estimate.
func (service *Service) SearchAbove(ctx context.Context, ids []string, query string, minimum float64) (Results, error) {
	started := time.Now()
	result := Results{Hits: []Hit{}, ModelSHA256: hash(), IndexVersion: IndexVersion}
	err := service.Exclusive(ctx, func() error {
		if math.IsNaN(minimum) || math.IsInf(minimum, 0) || minimum < 0 || minimum > 1 {
			return errors.New("Choose a minimum similarity between zero and one.")
		}
		query = strings.TrimSpace(query)
		if len(ids) == 0 || len(ids) > 4 || utf8.RuneCountInString(query) == 0 || utf8.RuneCountInString(query) > 400 {
			return errors.New("Select one to four documents and enter a query of up to 400 characters.")
		}
		if !service.engine.Installed(localmodels.EmbeddingID) {
			return errors.New("Install the local document search model first.")
		}
		seen := map[string]bool{}
		var candidates []persistence.LocalChunk
		sources := map[string]documents.Prepared{}
		for _, id := range ids {
			if seen[id] {
				return errors.New("Select each document only once.")
			}
			seen[id] = true
			source, err := service.store.ReadLocalDocument(ctx, id)
			if err != nil {
				return err
			}
			sources[id] = source
			chunks, err := service.store.ReadLocalChunks(ctx, id, hash(), IndexVersion)
			if err != nil {
				return err
			}
			if len(chunks) == 0 {
				return errors.New("A selected document needs to be indexed again.")
			}
			candidates = append(candidates, chunks...)
		}
		vectors, err := service.engine.Embed(ctx, []string{"\u4e3a\u8fd9\u4e2a\u53e5\u5b50\u751f\u6210\u8868\u793a\u4ee5\u7528\u4e8e\u68c0\u7d22\u76f8\u5173\u6587\u7ae0\uff1a" + query})
		if err != nil {
			return err
		}
		if len(vectors) != 1 || len(vectors[0]) != 512 {
			return errors.New("The query embedding has an invalid dimension.")
		}
		type ranked struct {
			chunk persistence.LocalChunk
			score float64
		}
		rankedChunks := make([]ranked, 0, len(candidates))
		for _, chunk := range candidates {
			if err := ctx.Err(); err != nil {
				return err
			}
			var score float64
			for i, v := range chunk.Vector {
				score += float64(v) * float64(vectors[0][i])
			}
			if math.IsNaN(score) || math.IsInf(score, 0) {
				return errors.New("The saved local index contains an invalid vector.")
			}
			rankedChunks = append(rankedChunks, ranked{chunk, score})
		}
		sort.SliceStable(rankedChunks, func(i, j int) bool { return rankedChunks[i].score > rankedChunks[j].score })
		covered := map[string]bool{}
		for _, item := range rankedChunks {
			if item.score < minimum || len(result.Hits) == 5 {
				break
			}
			novel := false
			for _, section := range item.chunk.Sections {
				if !covered[item.chunk.DocumentID+":"+section] {
					novel = true
				}
			}
			if !novel {
				continue
			}
			for _, section := range item.chunk.Sections {
				covered[item.chunk.DocumentID+":"+section] = true
			}

			source := selectSections(sources[item.chunk.DocumentID], []persistence.LocalChunk{item.chunk})
			result.Hits = append(result.Hits, Hit{Selection: Selection{DocumentID: item.chunk.DocumentID, Ordinal: item.chunk.Ordinal}, Score: item.score, Text: item.chunk.Text, Source: source.Snapshot})
		}
		return nil
	})
	result.ElapsedMS = time.Since(started).Milliseconds()
	return result, err
}

// Selected reads immutable originals again; clients cannot supply citation text.
func (service *Service) Selected(ctx context.Context, selections []Selection, consume func([]documents.Prepared) error) error {
	return service.Exclusive(ctx, func() error {
		if len(selections) == 0 || len(selections) > 5 {
			return errors.New("Choose between one and five search results.")
		}
		grouped := map[string][]persistence.LocalChunk{}
		var order []string
		for _, selection := range selections {
			chunks, err := service.store.ReadLocalChunks(ctx, selection.DocumentID, hash(), IndexVersion)
			if err != nil {
				return err
			}
			if selection.Ordinal < 0 || selection.Ordinal >= len(chunks) {
				return errors.New("The selected result is no longer in the local index. Search again.")
			}
			if _, ok := grouped[selection.DocumentID]; !ok {
				order = append(order, selection.DocumentID)
			}
			grouped[selection.DocumentID] = append(grouped[selection.DocumentID], chunks[selection.Ordinal])
		}
		if len(order) > 4 {
			return errors.New("Attach results from at most four documents.")
		}
		prepared := make([]documents.Prepared, 0, len(order))
		for _, id := range order {
			source, err := service.store.ReadLocalDocument(ctx, id)
			if err != nil {
				return err
			}
			prepared = append(prepared, selectSections(source, grouped[id]))
		}
		return consume(prepared)
	})
}

func selectSections(source documents.Prepared, chunks []persistence.LocalChunk) documents.Prepared {
	selected := map[string]bool{}
	for _, chunk := range chunks {
		for _, id := range chunk.Sections {
			selected[id] = true
		}
	}
	sections := []documents.Section{}
	characters := 0
	for _, section := range source.Sections {
		if selected[section.ID] {
			sections = append(sections, section)
			characters += utf8.RuneCountInString(section.Text)
		}
	}
	source.Sections = sections
	source.Characters = characters
	source.Retrieval = &documents.Retrieval{ModelID: localmodels.EmbeddingID, ModelSHA256: hash(), IndexVersion: IndexVersion}
	return source
}
