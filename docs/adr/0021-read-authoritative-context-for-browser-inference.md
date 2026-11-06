# Read authoritative context for browser inference

Cove's browser inference adapter reads the same immutable Context Snapshot used by the Local Service for ordinary Provider requests. This implements ADR-0015 consistently for browser targets and retries.

`GET /api/generation-batches/{id}/context` returns ordered prior user/assistant content pairs from Chat's existing persisted context items. It requires the existing Browser Session, returns `Cache-Control: no-store`, and excludes the current user turn and System Prompt. The current turn and attempt's configuration continue to come from the original Batch/attempt records. Missing Batches return the existing not-found response.

The frontend reads this endpoint through the Generation React Query hook. Targets share one immutable cache entry per Batch. Clearing history removes that cache, and a failed read stops inference rather than falling back to visible history.

The HTTP handler only adapts the request. Chat verifies the Batch and reads its persisted context through the storage interface. No generation orchestration, snapshot selection semantics, persistence format, or inference protocol is changed.

This small read endpoint is part of the frontend compatibility repair: the browser previously assembled context from visible history, which could include skipped or unselected answers and later turns when retrying an earlier Batch. Existing persistence already owns the correct snapshot; the browser must not reconstruct it independently.
