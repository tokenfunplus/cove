# Make Chat the Local Service application facade

The API adapter calls the `Chat` application service for Conversation commands and queries; it does not depend directly on `ChatStore` or SQLite. This keeps Generation, comparison, deletion, recovery, and read-model rules behind one Local Service interface rather than duplicating policy in HTTP handlers.

## Considered Options

- Permit API read handlers to query `ChatStore` directly: rejected because the exception makes future Conversation and Model Comparison invariants easy to bypass.
