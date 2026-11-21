package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"github.com/tokenfunplus/cove/services/local-service/internal/websearch"
)

type WebSearchStep struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Query      string          `json:"query,omitempty"`
	URL        string          `json:"url,omitempty"`
	Status     string          `json:"status"`
	Cached     bool            `json:"cached,omitempty"`
	Error      string          `json:"error,omitempty"`
	Usage      json.RawMessage `json:"usage,omitempty"`
	StartedAt  time.Time       `json:"started_at"`
	FinishedAt *time.Time      `json:"finished_at,omitempty"`
}

type WebSearchInfo struct {
	Provider string               `json:"provider"`
	Searches int                  `json:"searches"`
	Pages    int                  `json:"pages"`
	Steps    []WebSearchStep      `json:"steps"`
	Sources  []documents.Snapshot `json:"sources"`
}

type WebToolRecord struct {
	WebSearchStep
	Call         provider.ToolCall          `json:"call"`
	Content      string                     `json:"content"`
	Messages     []provider.ProviderMessage `json:"messages,omitempty"`
	Verification *GenerationVerification    `json:"verification,omitempty"`
}

type WebSearchRun struct {
	StartedAt time.Time            `json:"started_at"`
	Searches  int                  `json:"searches"`
	Pages     int                  `json:"pages"`
	Records   []WebToolRecord      `json:"records"`
	Sources   []documents.Prepared `json:"sources"`
}

func (run WebSearchRun) Info(vendor string) *WebSearchInfo {
	info := &WebSearchInfo{Provider: vendor, Searches: run.Searches, Pages: run.Pages, Steps: make([]WebSearchStep, 0, len(run.Records)), Sources: make([]documents.Snapshot, 0, len(run.Sources))}
	for _, record := range run.Records {
		info.Steps = append(info.Steps, record.WebSearchStep)
	}
	for _, source := range run.Sources {
		info.Sources = append(info.Sources, source.Snapshot)
	}
	return info
}

func (store *SQLiteStore) LoadWebSearchSettings(ctx context.Context) (websearch.Policy, error) {
	var encoded string
	if err := store.db.QueryRowContext(ctx, `SELECT configuration FROM web_search_settings WHERE id=1`).Scan(&encoded); err != nil {
		return websearch.Policy{}, err
	}
	var policy websearch.Policy
	if err := json.Unmarshal([]byte(encoded), &policy); err != nil {
		return websearch.Policy{}, err
	}
	return policy, nil
}

func (store *SQLiteStore) SaveWebSearchSettings(ctx context.Context, policy websearch.Policy) error {
	if err := policy.Validate(); err != nil {
		return err
	}
	encoded, err := json.Marshal(policy)
	if err != nil {
		return err
	}
	_, err = store.db.ExecContext(ctx, `UPDATE web_search_settings SET configuration=? WHERE id=1`, string(encoded))
	return err
}

func (store *SQLiteStore) GetWebSearchRun(ctx context.Context, generationID string) (WebSearchRun, error) {
	var encoded string
	if err := store.db.QueryRowContext(ctx, `SELECT web_search_run FROM generations WHERE id=?`, generationID).Scan(&encoded); err != nil {
		return WebSearchRun{}, err
	}
	var run WebSearchRun
	err := json.Unmarshal([]byte(encoded), &run)
	return run, err
}

// MutateWebSearchRun serializes admission and completion against cancellation.
func (store *SQLiteStore) MutateWebSearchRun(ctx context.Context, generationID string, update func(*WebSearchRun, Generation) error) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	generation, err := getGenerationByIDTx(ctx, tx, generationID)
	if err != nil {
		return err
	}
	if isTerminalGenerationState(generation.State) || generation.ConfigurationSnapshot.WebSearch == nil {
		return errors.New("Web search is unavailable for this Generation.")
	}
	var encoded string
	if err := tx.QueryRowContext(ctx, `SELECT web_search_run FROM generations WHERE id=?`, generationID).Scan(&encoded); err != nil {
		return err
	}
	var run WebSearchRun
	if err := json.Unmarshal([]byte(encoded), &run); err != nil {
		return err
	}
	if err := update(&run, generation); err != nil {
		return err
	}
	data, err := json.Marshal(run)
	if err != nil {
		return err
	}
	info, err := json.Marshal(run.Info(generation.ConfigurationSnapshot.WebSearch.Provider))
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE generations SET web_search_run=?, web_search_info=? WHERE id=?`, string(data), string(info), generationID); err != nil {
		return err
	}
	return tx.Commit()
}

func attachWebSourcesTx(ctx context.Context, tx *sql.Tx, generationID, messageID, body string) error {
	var encoded string
	if err := tx.QueryRowContext(ctx, `SELECT web_search_run FROM generations WHERE id=?`, generationID).Scan(&encoded); err != nil {
		return err
	}
	var run WebSearchRun
	if err := json.Unmarshal([]byte(encoded), &run); err != nil {
		return err
	}
	if len(run.Sources) == 0 {
		return nil
	}
	var cited []documents.Prepared
	snapshots := make([]documents.Snapshot, 0, len(run.Sources))
	for _, source := range run.Sources {
		snapshots = append(snapshots, source.Snapshot)
		if strings.Contains(body, "cove:"+source.ID+":") {
			cited = append(cited, source)
		}
	}
	data, err := json.Marshal(snapshots)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE messages SET web_sources=?,context_body=? WHERE id=?`, string(data), documents.Prompt(body, cited), messageID)
	return err
}

func webPolicyJSON(policy *websearch.Policy) string {
	if policy == nil {
		return ""
	}
	data, _ := json.Marshal(policy)
	return string(data)
}
