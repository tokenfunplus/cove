# Architecture

Cove has three primary runtime components, optional native inference workers, and a shared TypeScript contract package.

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
| `services/local-service/internal/documents/` | Bounded source parsing and prompt formatting owned by Chat |
| `services/local-service/internal/retrieval/` | Explicit document scope, embedding indexes, and original source selection |
| `services/local-service/internal/localmodels/` | Pinned downloads and private native inference worker lifecycle |
| `services/local-service/internal/persistence/` | SQLite migrations, settings, and history |
| `services/local-service/internal/providerconfig/` | Provider validation and key rotation |
| `services/local-service/internal/provider/` | Provider adapters and fixed-destination evidence proxies |
| `services/local-service/internal/localsecurity/` | Launch tokens, sessions, origin checks, and CSRF |
| `services/local-service/internal/webassets/` | Embedded generated assets and setup fallback |

## Frontend boundaries

`App.tsx` mounts `pages/ChatPage.tsx`. The page composes the workspace shell, conversation surface, and overlays. Domain presentation lives in `components/chat`, `conversations`, `providers`, `settings`, and `verification`. `components/ui` contains generic controls.

`api/client.ts` owns local HTTP/session adaptation and error decoding. Domain endpoint modules retain the shared contract types. `api/hooks` exposes TanStack Query queries and mutations, with scoped keys in `api/queryKeys.ts`. Mutations explicitly disable automatic retries. Conversation refreshes and generation batch reads use the same cache keys as mounted queries. The SSE adapter remains a stream rather than a cached query.

`api/queryClient.ts` keeps loopback queries and commands active when the browser reports no internet. Actual Local Service failures still use ordinary error handling; remote Providers and downloads require reachable destinations. See [offline loopback requests](adr/0049-keep-loopback-requests-active-without-internet.md).

[Local capability workflows](adr/0053-integrate-local-capabilities-into-chat-and-projects.md) connect the composer Tools menu, installed/discovery management, Project material use, and server-enforced local-only Generation admission. Project originals remain in their existing blob store; scoped vector indexes are separate.

Small-model discovery uses typed, bundled records in `lib/local-model-catalog-data.ts` and local filtering in `lib/local-model-catalog.ts`. Its integration labels are separate from actual installed state returned by the Local Service. Explore-only entries never register a runtime or tool. See [task-based model discovery](adr/0051-expand-small-model-discovery-by-task.md).

`hooks/workspace/use-chat-workspace.ts` composes UI state and focused domain controllers. Conversation actions, model selection, ordinary batch streaming, private inference, and private connection verification have separate hooks. Query data owns server records. Workspace UI state and the transient Live Turn remain separate from durable history. Session query data contains readiness only, while the CSRF proof stays in the HTTP client.

`lib/inference` isolates the browser SDK, protocol adapters, evidence conversion, and verifiers. `lib/chat` owns pure Live Turn and timeline projections. `messages` owns interface copy and `theme` owns system appearance resolution, skin selection, and semantic variables. Skin preferences and timeline bookmark references are browser-local presentation state; bookmark storage contains identifiers only, never message bodies or excerpts. Appearance continues to use the settings API.

Unit/component tests are colocated with their owning modules. `pages/ChatPage.interactions.test.tsx` covers the composed workspace, `test` contains synthetic fixtures, and `e2e` owns the production browser acceptance harness. Test modules and fixtures are outside the production import graph.

Assistant Markdown protects math delimiters before parsing emphasis and uses locally bundled KaTeX and fonts for presentation. Formula source remains unchanged in storage, copying, and exports. See [local math rendering](adr/0036-render-local-math-in-assistant-markdown.md) for delimiter, fallback, and rendering limits.

`components/ui` owns editable shadcn/Radix primitives. Domain presentation uses these adapters for selects, checkboxes, sliders, radio cards, progress, disclosures, buttons, text fields, and file-picker triggers. Tailwind recipes in `styles` express domain presentation through semantic variables in `theme/tokens.css`. Component-specific CSS is avoided; CSS retains theme registration, base rules, and shared motion. See [presentation and skin decision](adr/0020-use-tailwind-recipes-and-shadcn-primitives.md).

Model selection preferences contain bounded browser-local identifiers and names; manual cost rates are also browser-local. Explicitly saved Debate rates are copied into the session for cumulative background budget estimates; see [Debate stage summaries and controls](adr/0041-add-debate-stage-summaries-and-run-controls.md). Model filter popovers and option menus use shared Radix primitives, including nested focus and Escape behavior in Provider settings. Conversation reading anchors and updated-answer counts remain transient presentation state. See [workspace experience and edited-prompt branches](adr/0035-improve-model-selection-reading-and-edited-prompt-branches.md).

See [frontend organization decision](adr/0019-separate-frontend-presentation-and-api-hooks.md) and the [refactor acceptance baseline](frontend-refactor.md).

`hooks/chat/use-answer-tools` composes the existing command, stream, and private-inference controllers for a separate side Conversation. The main workspace and answer tools share the one-active-Batch constraint and cancellation-before-navigation/data-clear behavior. Working Drafts and undo history are window-local React state; only model revision requests/results enter ordinary SQLite history. `lib/chat/workbench` owns draft history, bounded line differences, and revision input construction. See [answer tools and Generation measurements](adr/0032-add-answer-tools-and-generation-measurements.md).

## Generation lifecycle

A submitted message creates one durable Generation Batch with one to four Targets and a `client_request_id`. Repeating the request is idempotent. Targets run concurrently, with at most one active Batch across the service. Commands create or control work; a separate SSE stream reports events. Persisted state is authoritative.

Every attempt captures its Provider Snapshot and generation configuration. Completed assistant text becomes Conversation History; failed and stopped attempts retain diagnostics without persisting incomplete assistant content. Restart recovery marks interrupted attempts as failed.

Completed attempts may also retain observed Generation Metrics. Chat measures ordinary stream timing and preserves Provider-reported usage; private inference reports browser observations through its existing settlement command. Metrics are additive optional API data. Historical or missing measurements remain unavailable, and user-supplied pricing is a browser-local display preference.

Provider-declared reasoning uses a separate stream/Message field and is excluded from later Selected Answer context. The frontend folds it at the end of streaming without modifying raw verification entities. Legacy explicitly tagged blocks retain a presentation fallback. See [structured reasoning](adr/0033-separate-provider-reasoning-from-answer-text.md). Provider adapters also normalize optional catalog details for model selection; locally bundled brand icons remain presentation only. See [model catalog presentation](adr/0034-show-provider-model-catalog-details-and-local-brand-icons.md).

File chat saves original bytes, extracted source sections, and the augmented user input atomically with the Batch. `internal/documents` owns parsing and text formatting under Chat; persistence owns immutable snapshots and original downloads. The runnable service isolates PDF decoding in a bounded child process without initializing credentials or storage. Browser inference reads the same saved `input_content` used by ordinary Providers. Selected prior turns include that augmented input in later Context Snapshots. Draft previews remain local and ephemeral. See [source document snapshots](adr/0025-snapshot-local-source-documents-for-file-chat.md) for limits, context inspection, and citation semantics.

Chat expires abandoned browser Generations after the inference timeout plus settlement grace. Slow SSE subscribers are disconnected without blocking Provider workers and can reconnect to reconcile persisted results. See [bounded lifetimes and event delivery](adr/0022-bound-browser-generation-lifetimes.md).

Single-model turns select their completed answers automatically. Comparisons require the user to select one answer or skip the turn for later context. Later batches capture immutable Context Snapshots. Unselected answers remain local. Retries preserve original context, model targets, and any Private TEE requirement. The Chat Surface sends the selected target identities and its Private TEE requirements with a new turn. Chat checks them against one current catalog per Provider before saving the turn.

Editing and resending a terminal user turn uses the existing submission command with `edit_of_batch_id`. Chat validates its source and selected active targets; persistence atomically copies the immutable context prefix and saved attachments into an independent Conversation before creating its new Batch. The returned Conversation ID owns ordinary streaming and browser inference. Source deletion cannot mutate the copy. See [edited-prompt branches](adr/0035-improve-model-selection-reading-and-edited-prompt-branches.md).

Public webpage reading uses `internal/websources` through Chat before Generation admission. Session-bound prepared sources become ordinary saved source snapshots on submission, sharing immutable context, branching, and NearAI input construction. See [webpage source snapshots](adr/0042-add-public-webpage-source-snapshots.md).

Automatic research uses `internal/websearch` for fixed-destination search connections and Chat for native tool orchestration. Schema 22 saves attempt policy, traces, and original evidence independently of mutable settings. Browser NearAI inference verifies intermediate tool responses before executing commands. See [model-directed research](adr/0044-add-opt-in-model-directed-web-research.md).

## Project background reuse

Schema 23 stores Projects, current instructions/background and fixed sources in persistence. Chat assembles project input independently of replayable `input_content`: saved instructions augment each attempt's base System Prompt, and a saved reference prefix is concatenated with the final user input at execution time. Ordinary and NearAI requests share the Batch snapshot. Normalized references retain content-addressed original-byte blobs until the last owner is deleted; branches copy text snapshots and add blob references. Project-aware context previews expose revisions and character breakdowns. See [project background reuse](adr/0045-add-projects-and-independent-context-snapshots.md).

## Managed local inference and document retrieval

`internal/localmodels` owns verified downloads and authenticated native worker lifecycles; workers have no browser sessions, Provider Keys, or persistence responsibilities. The managed local Provider uses ordinary Chat Generations and immutable model-artifact provenance. A single lease bounds concurrent native inference, cancellation terminates local chat work, and idle workers unload.

Installed chat artifacts share the managed Provider but retain independent model targets, workers, and saved artifact revisions/hashes. Model selection, local-only admission, and removal honor the chosen target. Qwen3 Abliterated runs its embedded template in non-thinking mode. See [multiple local chat targets](adr/0054-add-qwen3-abliterated-local-chat.md).

Chat exposes explicit library import, search, source selection, and deletion operations. `internal/retrieval` indexes only selected documents with versioned embeddings and resolves hits back to original source sections. Persistence owns library originals, vectors, and weight files. Selected results enter the existing immutable source-snapshot and citation path; library deletion does not mutate saved history. See [managed local inference and retrieval](adr/0048-add-managed-local-inference-and-document-retrieval.md).

[Schema compatibility](adr/0052-combine-projects-and-local-model-storage-migrations.md) preserves both mainline Project databases and earlier local-model preview data. Model removal shares Generation admission, and library clearing serializes with parsing and indexing. Browser dialog cancellation rejects late source responses, while clearing removes library cache entries. See [local lifecycle consistency](adr/0050-serialize-local-model-and-document-lifecycle-changes.md).

## Continuous debates


`internal/chat/debate_summary.go` schedules bounded, cited stage analyses through the same service/browser turn lifecycle. `debate_controls.go` owns cumulative estimate policy, budget admission, and persistent pacing; persistence aggregates usage independently of transcript pagination. Generated analyses remain separate from participant context.

History presentation owns browser-local activity/type filter choices and applies them to the full conversation list. Filtered message search crosses the existing Chat facade and applies its scope in persistence before the fifty-result cap. Conversation read models carry optional Debate state/round metadata, with lightweight local reconciliation and no Provider calls. See [history filters and Debate metadata](adr/0039-filter-history-and-show-debate-activity.md).

`internal/chat/debate.go` owns the continuous Debate Session scheduler, independent blind openings, bounded context, pause/resume/stop, and the shared active-work reservation. `internal/persistence/debate.go` owns schema 21 records, immutable turn requests, atomic round changes, pagination, and restart recovery. The API adapts commands, reads, and coalesced SSE notifications. `components/debate` and the Debate API hooks present the workspace without scheduling Provider calls in the browser.

Debate turns stay outside ordinary Selected Answer context. Service-driven models continue with the browser closed. For NearAI, Chat schedules an exclusively claimed browser turn and waits for its existing encrypted/verified inference transport; no fallback runs it through the ordinary HTTP adapter. The browser executes only scheduled requests, and pagination does not change its current request. Loss of the browser expires the turn and pauses the session. See [continuous Debate Sessions](adr/0037-add-service-owned-continuous-debate-sessions.md) and [NearAI debate execution](adr/0038-support-browser-verified-nearai-debate-turns.md) for limits, checkpoints, exports, and compatibility.

## Private inference boundary

The browser performs NearAI cryptography because it owns plaintext before encryption and after decryption. The Local Service retains Provider Keys and proxies protocol bodies without transforming ciphertext. Browser completion commands persist results and evidence through Chat.

Browser inference reads `GET /api/generation-batches/{id}/context` through the Generation Query hook. Chat returns the existing immutable context, shared by every target/retry in that Batch; the browser excludes visible unselected or skipped history. See [ADR-0021](adr/0021-read-authoritative-context-for-browser-inference.md).

Saved verification records report browser checks; SQLite does not independently revalidate the full proof. See [privacy.md](privacy.md) for trust boundaries.

`lib/verification/viewer.ts` projects saved records into bounded display reports and owns the origin-checked NearAI iframe connection. Verification components retain local details and retry controls. The remote viewer does not own inference or persisted verification state. See [ADR-0023](adr/0023-embed-nearai-verification-reports.md).

## Invariants

- Stop affected Generations and wait for termination before deleting history.
- Keep secrets out of API read models, exports, and Provider Snapshots.
- Accept custom cleartext HTTP only for loopback destinations.
- Require loopback, origin, session, and CSRF checks on protected routes.
- Keep provider identity, execution claims, and transport security distinct.
- Keep interface language independent of user-content language.

See [CONTEXT.md](../CONTEXT.md) for vocabulary and [architecture decisions](adr/) for rationale.

Conversation API responses intern saved project payloads in a per-response dictionary; API adaptation restores shared immutable references before query data reaches domain presentation. Project-aware context reads use their own generation query key.

Local speech follows the same boundary: HTTP adapts session-authenticated settings, reading, preview, status, stop, and WAV requests; Chat resolves saved assistant and completed Debate participant bodies; `speech` coordinates model choice, native workers, and cancellation; persistence owns verified multi-file bundles, schema-27 preferences, and temporary audio. The native workers use private pipes and sanitized environments, independently of chat Providers. See [ADR 0055](adr/0055-add-managed-local-speech-and-answer-reading.md) and [Debate read aloud](adr/0056-read-debate-turns-with-local-speech.md).
