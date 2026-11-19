# Support browser-verified NearAI Debate turns

Debate setup originally filtered out every NearAI Provider, even when its configured catalog contained many usable models. This made a valid single-Provider setup appear unconfigured. NearAI catalogs now supply Debate seats alongside OpenAI-compatible catalogs. This supersedes the NearAI exclusion in [ADR-0037](0037-add-service-owned-continuous-debate-sessions.md), preserving the browser cryptography boundary in [the architecture](../architecture.md).

## Execution and lifecycle

Chat still owns the schedule, blind opening, fixed context, rounds, and global active-work reservation. A scheduled NearAI turn is delegated to the Chat Surface through session/origin/CSRF-protected claim, progress, and settlement commands. One browser claimant owns each turn; another tab cannot claim it or start a duplicate request. A claim replay preserves that ownership and does not extend the deadline. Resume creates a new turn only for an unfinished seat. No Provider request is automatically retried after a browser or verification error.

The browser reuses the existing NearAI inference SDK boundary, fixed-destination authenticated proxies, configured privacy mode, encryption, environment verification, and response receipt verification. No NearAI turn falls back to ordinary service-side completion. Its exact messages and output limit come from Chat's immutable turn request. Browser pagination never replaces the request being executed.

Browser progress remains transient. A successful settlement requires the response-verification phase and a complete receipt summary under the existing browser-report trust model. Private TEE requires model verification; gateway-only success cannot satisfy it. Failed verification discards answer and reasoning in every mode so unverified content cannot propagate between Debate participants. Settled results retain verification records and browser measurements.

Pause finishes active requests. Stop cancels browser work, records a terminal session, and rejects late settlements. Browser work has the existing inference timeout plus service settlement grace, without renewal by claims or progress. Closing/leaving the debate interrupts active browser work; an absent browser expires and pauses the session. The user must Resume explicitly. Service shutdown and restart remain paused recovery paths.

## Consequences

- NearAI participation requires the debate page to remain open. The setup and running workspace state this. Service-driven debates can still continue with the browser closed; a mixed debate follows the NearAI requirement.
- A second tab can observe an existing run without repeating its claimed inference. Reloading during a claimed request may require waiting for expiry and choosing Resume.
- Optional browser execution, phase, and verification fields live in existing schema 20 JSON records. No table migration or secret storage change is needed.
- List reads expose receipt summaries and fetch large evidence only through individual turn details. Rolling model context excludes verification records and reasoning; only completed verified public answers enter later turns.
- SQLite retains browser-reported evidence; the service does not independently perform the cryptographic verification or turn reported verification into a factual-correctness guarantee.
