# Make Generation submission idempotent

Each user send carries a unique `client_request_id`. Repeating that request returns the existing Generation instead of starting another upstream request. A Generation keeps the Provider Snapshot captured at start, and an application restart marks any non-terminal Generation as `failed` with `error_code=interrupted` without persisting or reconstructing incomplete assistant content.

## Consequences

Provider configuration changes affect only future Generations. Retrying a failed or stopped user message creates a new Generation and preserves the previous attempt for diagnosis and history.
