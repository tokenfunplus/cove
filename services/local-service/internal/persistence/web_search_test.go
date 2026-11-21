package persistence

import "testing"

// Reconstruct historical database fixtures before exercising their upgrade paths.
func dropWebSearchSchema(t *testing.T, store *SQLiteStore) {
	t.Helper()
	if _, err := store.db.Exec(`DROP TABLE web_search_settings;
ALTER TABLE generation_batches DROP COLUMN web_search_policy;
ALTER TABLE generations DROP COLUMN web_search_policy;
ALTER TABLE generations DROP COLUMN web_search_run;
ALTER TABLE generations DROP COLUMN web_search_info;
ALTER TABLE messages DROP COLUMN web_sources;
ALTER TABLE messages DROP COLUMN context_body;`); err != nil {
		t.Fatal(err)
	}
}
