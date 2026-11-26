# Keep card previews local and admission consistent

This corrects the interactive extensions in ADR-0063 through ADR-0067 while retaining ADR-0025's local-only draft-context preview contract.

Draft previews read local Provider configuration and context-length metadata cached by earlier explicit catalog requests. They never discover models or contact a Provider. Unknown external context lengths retain the existing capability policy; managed local models remain excluded. Actual sends and retries use their already-resolved current catalog for interactive capability checks. Cached preview metadata never authorizes transport, credentials, model selection, or privacy classification.

Context-size admission measures the assembled Provider messages, including the card projection, System Prompt, Project Context, and attachments. It does not separately reject unprojected card JSON in storage. Edited-turn previews use that turn's saved history, matching edited-turn admission. Only source Batches with interactive replies enabled have their historical card output and references compacted; ordinary examples and comparison output remain intact. Both current and saved Context Snapshot loaders carry this immutable source flag. Original messages and evidence remain unchanged.

Every early idempotency return for a card submission verifies its source, Conversation, and full request fingerprint. Persistence repeats this check inside the admission transaction, including when a competing request has already committed. Archived Conversations cannot admit a card continuation; eligibility is checked in the same transaction that consumes the run. Local exploration remains available. The Chat Surface also disables continuation in archives and whenever a later Batch has been accepted, independent of cached run eligibility.

Quick Panel New chat and Start New Draft imports protect unsent card questions with the existing discard confirmation. Imports are consumed only after confirmation. A failed submission restores staged attachments only if that submission actually cleared them, preserving previews that completed while a card request was pending.

The model-input normalizer counts the implicit Card root and generated quiz/continuation controls against the same 30-component bound as the canonical parser. Generated state-field names remain stable.

## Validation

Regressions cover local/offline previews, one catalog read per send or retry, projected history quotas for ordinary and edited turns, preservation of noninteractive examples in saved context, archive admission, replay races and transaction replay, Quick Panel discard guards, pending attachment completion, stale UI eligibility, and compact/canonical component limits. Existing contract, service, web, and browser acceptance checks remain required.
