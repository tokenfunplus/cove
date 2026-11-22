# ADR 0057: Close local capability review boundaries

- Status: Accepted
- Date: 2026-11-22
- Extends: ADR 0033, ADR 0048, ADR 0050, ADR 0053, ADR 0055, and ADR 0056

## Decision

Run pinned llama.cpp workers on Unix sockets inside newly created private directories, instead of handing off a loopback TCP port. Each worker has its own transport and bearer file. Both health probes and Provider-adapter streams retain that exact private transport; proxy settings, DNS, TCP neighbors, and redirects cannot choose its peer. Retain the private directory after child exit until the gate-owning manager releases all access and removes the worker. This protects the per-user process boundary; it does not isolate processes already able to read the user's private files. Embedding operations have a two-minute end-to-end deadline covering lease admission, model loading, response headers, and body reads; cancellation stops the worker and releases the lease.

Constrain model IDs and SHA-256 filenames at the persistence boundary before filesystem access. Recheck the exact installed target while Generation admission owns its lock. A remaining installed chat model cannot authorize a removed target. Provider identity normalization cannot create or replace the reserved managed Provider.

Treat Only on this Mac as an effective window policy across conversations and retries. Suppress Web Research without changing saved per-conversation preferences. Retry requests optionally carry `local_only`; combine this with the immutable Batch restriction, and reject remote targets or saved research policies before Provider resolution. Older callers may omit the field; they still retain recorded Batch restrictions. Disabling the window policy never weakens a saved local-only Batch.

Local search submits do not bubble through the portaled dialog into the composer. Prepared retrieval passages are invalidated by Project and source snapshot identity, including when a committed mutation's response reload fails. Other materials, Projects, and global-library drafts remain valid. Edited-prompt branches retain inherited attachment snapshots even when the same original later becomes Always include Project material. Project Conversation deletion uses the same speech/work cancellation boundary as ordinary deletion.

## Speech and compatibility

Project leading legacy reasoning blocks with the same explicit-tag rules as the Chat Surface before Markdown speech extraction. Preserve saved bodies. Treat rendered selections and previews as literal text, with separate character limits; the answer-reading request allows bounded UTF-8/JSON expansion. Preserve code indexes while removing prose citations. Apply Pocket playback speed to every media load, enforce its stdout bound through pipe copying, and repair only its pinned streaming-WAV placeholder at Pocket ingress. Framed and saved WAVs reject truncated sample declarations.

Explicit cancellation remains quiet; download and synthesis deadlines are failures with actionable messages. Cleanup-pending speech jobs deny status, playback, and export, and remain retryable until their temporary audio is removed. Voice settings use a retained baseline for refreshes and preserve edits made during an in-flight save. Starting manual speech or a preview takes ownership even before Debate has read its first turn.

No database migration or new public runtime setting is required. Schema 27 remains current. Existing local inference and synthesis limits, immutable source ownership, independent Debate generation, and offline operation remain in effect.
