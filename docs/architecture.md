# Architecture

Cove has three runtime components and a shared TypeScript contract package.

```text
SwiftUI Launcher
  └─ owns a Go Local Service and opens a one-time launch URL
       ├─ serves embedded React assets and authenticated HTTP/SSE APIs
       ├─ stores local records in SQLite and Provider Keys in Keychain
       ├─ connects to OpenAI-compatible providers
       └─ transparently proxies NearAI requests
            ↑
React Chat Surface
  ├─ manages the workspace and live generation presentation
  └─ performs supported NearAI encryption, attestation, and receipt verification
```

## Source map

| Path | Responsibility |
| --- | --- |
| `apps/macos/` | Launcher lifecycle, bundled process management, updates, menu-bar UI |
| `apps/web/` | React Chat Surface, transport, exports, NearAI verification |
| `packages/api-contract/` | Shared types, JSON schemas, and fixtures |
| `services/local-service/internal/api/` | Session-authorized HTTP adapter and static serving |
| `services/local-service/internal/chat/` | Conversation and Generation Batch orchestration |
| `services/local-service/internal/persistence/` | SQLite migrations, settings, and history |
| `services/local-service/internal/providerconfig/` | Provider validation and key rotation |
| `services/local-service/internal/provider/` | Provider adapters and fixed-destination evidence proxies |
| `services/local-service/internal/localsecurity/` | Launch tokens, sessions, origin checks, and CSRF |
| `services/local-service/internal/webassets/` | Embedded generated assets and setup fallback |

## Generation lifecycle

A submitted message creates one durable Generation Batch with one to four Targets and a `client_request_id`. Repeating the request is idempotent. Targets run concurrently, with at most one active Batch across the service. Commands create or control work; a separate SSE stream reports events. Persisted state is authoritative.

Every attempt captures its Provider Snapshot and generation configuration. Completed assistant text becomes Conversation History; failed and stopped attempts retain diagnostics without persisting incomplete assistant content. Restart recovery marks interrupted attempts as failed.

Single-model turns select their completed answers automatically. Comparisons require the user to select one answer or skip the turn for later context. Later batches capture immutable Context Snapshots. Unselected answers remain local. Retries preserve original context and model targets.

## Private inference boundary

The browser performs NearAI cryptography because it owns plaintext before encryption and after decryption. The Local Service retains Provider Keys and proxies protocol bodies without transforming ciphertext. Browser completion commands persist results and evidence through Chat.

Saved verification records report browser checks; SQLite does not independently revalidate the full proof. See [privacy.md](privacy.md) for trust boundaries.

## Invariants

- Stop affected Generations and wait for termination before deleting history.
- Keep secrets out of API read models, exports, and Provider Snapshots.
- Accept custom cleartext HTTP only for loopback destinations.
- Require loopback, origin, session, and CSRF checks on protected routes.
- Keep provider identity, execution claims, and transport security distinct.
- Keep interface language independent of user-content language.

See [CONTEXT.md](../CONTEXT.md) for vocabulary and [architecture decisions](adr/) for rationale.
