package persistence

import "testing"

// Reconstruct historical database fixtures before exercising their upgrade paths.
func dropProjectSchema(t *testing.T, store *SQLiteStore) {
	t.Helper()
	if _, err := store.db.Exec(`DROP TRIGGER collect_project_source; DROP TRIGGER collect_batch_project_source; DROP TABLE batch_project_sources; DROP TABLE generation_project_contexts; DROP TABLE project_sources; DROP TABLE project_source_blobs; DROP INDEX conversations_project; ALTER TABLE generation_batches DROP COLUMN project_context_required; ALTER TABLE conversations DROP COLUMN project_id; ALTER TABLE conversations DROP COLUMN membership_revision; DROP TABLE projects;`); err != nil {
		t.Fatal(err)
	}
}

func dropWebSearchSchema(t *testing.T, store *SQLiteStore) {
	t.Helper()
	dropProjectSchema(t, store)
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
