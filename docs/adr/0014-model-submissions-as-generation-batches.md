# Model submissions as Generation Batches

Every submitted user message creates one durable Generation Batch, identified by its `client_request_id`, with an ordered set of one to four Generation Targets. Each Target starts one Generation attempt and may acquire later attempts only through a retry of that Target. A one-target Batch is the ordinary chat path; a larger Batch is a Model Comparison. Only one Batch may be active across the Local Service at a time, while all of its targets begin concurrently; this preserves one unambiguous conversation turn without sacrificing model comparison.

The API exposes one Batch SSE stream whose events identify their Target and Generation. Users may stop an individual Generation or the entire Batch. The Batch is active until all Targets are terminal, and its derived summary distinguishes full success, partial errors, complete failure, and a fully stopped Batch. The Active Model Set is locked during an active Batch.

Retrying a Target appends an attempt to its original Batch and reactivates that Batch temporarily. The retry uses the original immutable Context Snapshot and Target model, while capturing a fresh connection Snapshot; it does not create a new conversational turn or alter the Context Snapshots of later Batches.

## Considered Options

- Permit only one active Generation: rejected because it cannot present simultaneous independent model answers.
- Treat every target as an unrelated send: rejected because idempotency, cancellation, recovery, and the shared user message need a durable common boundary.
