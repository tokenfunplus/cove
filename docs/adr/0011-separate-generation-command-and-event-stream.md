# Separate Generation creation from its event stream

Cove creates a Generation with a normal `POST` command and exposes its live `GenerationEvent` values through a separate `GET` SSE stream. This keeps the `Chat` module as the sole Generation orchestrator, lets the browser reconnect or query status independently, and avoids coupling a request body to a long-lived streaming response.

## Consequences

The API contract includes an events route and `Last-Event-ID` handling. The event stream is not the source of truth: Generation state and completed assistant content remain authoritative in the Local Service and SQLite.
