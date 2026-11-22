package persistence

import (
	"context"
	"encoding/json"
	"fmt"
)

const speechMigration = `CREATE TABLE IF NOT EXISTS speech_settings(id INTEGER PRIMARY KEY CHECK(id=1),configuration TEXT NOT NULL); INSERT OR IGNORE INTO speech_settings(id,configuration) VALUES(1,'{}'); PRAGMA user_version=27;`

type SpeechProfile struct {
	VoiceID     string  `json:"voice_id"`
	Speed       float64 `json:"speed"`
	NoiseScale  float64 `json:"noise_scale"`
	Temperature float64 `json:"temperature"`
}
type SpeechSettings struct {
	Mode           string                   `json:"mode"`
	ModelID        string                   `json:"model_id"`
	EnglishModelID string                   `json:"english_model_id"`
	ChineseModelID string                   `json:"chinese_model_id"`
	Profiles       map[string]SpeechProfile `json:"profiles"`
	IncludeCode    bool                     `json:"include_code"`
	Volume         float64                  `json:"volume"`
	Threads        int                      `json:"threads"`
}

func (store *SQLiteStore) GetSpeechSettings(ctx context.Context) (SpeechSettings, error) {
	var value string
	if err := store.db.QueryRowContext(ctx, `SELECT configuration FROM speech_settings WHERE id=1`).Scan(&value); err != nil {
		return SpeechSettings{}, fmt.Errorf("read speech preferences: %w", err)
	}
	var result SpeechSettings
	if err := json.Unmarshal([]byte(value), &result); err != nil {
		return SpeechSettings{}, fmt.Errorf("decode speech preferences: %w", err)
	}
	return result, nil
}
func (store *SQLiteStore) SaveSpeechSettings(ctx context.Context, value SpeechSettings) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = store.db.ExecContext(ctx, `UPDATE speech_settings SET configuration=? WHERE id=1`, string(encoded))
	return err
}
