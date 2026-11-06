# Frontend refactor and acceptance baseline

The frontend refactor covers component organization, state ownership, styling, and interaction presentation. Stages 1 and 2 were accepted independently. The user subsequently authorized completing Stages 3 and 4 together before final acceptance. This document records the existing capabilities so they can be checked throughout the migration.

The baseline is Cove commit `98405ab`. Its web entry component has 4,152 lines and its global stylesheet has 14,259 lines. Before this work, TypeScript checking and 141 web tests passed. Many of those tests render static HTML or inspect CSS text. Behavioral coverage and visual acceptance have separate responsibilities during the refactor.

## Stage gates

| Stage | Deliverable | Acceptance gate |
| --- | --- | --- |
| 1 | Capability inventory, known-issue register, and executable interaction baseline | User reviews the scope and the feature checklist |
| 2 | Components, API access, state, and inference adapters separated by responsibility | Existing flows still work through their normal UI entry points |
| 3 | Shared design tokens and primitives, followed by the MedBox-inspired interface | User reviews light and dark chat, comparison, settings, and verification views |
| 4 | Complete regression and responsive/accessibility verification | User accepts the completed frontend against this checklist |

Stage 1 was accepted by the user on 2026-11-06. Stage 2 validation passed, and the user authorized Stage 3 after those checks. The user authorized the final Stage 3 review, direct repairs, and Stage 4 regression without an intermediate approval stop. Final acceptance remains with the user.

## Capability inventory

There are 52 acceptance checks across eight functional areas. A row records the required outcome, not a claim that every aspect has already been manually verified. Existing defects are tracked separately below.

### Workspace and navigation

| ID | Outcome to preserve |
| --- | --- |
| WORK-01 | Launch into the session-authenticated local workspace and show loading, ready, and unavailable states |
| WORK-02 | Show an actionable empty workspace and suggested prompts for an empty conversation |
| WORK-03 | Collapse and expand the desktop sidebar without losing access to navigation |
| WORK-04 | Open and dismiss the narrow-screen conversation drawer |
| WORK-05 | Use the conversation search shortcut and keep feedback and settings reachable |
| WORK-06 | Preserve keyboard names, focus handling, and dismiss behavior for menus and overlays |

### Conversations

| ID | Outcome to preserve |
| --- | --- |
| CONV-01 | Create a conversation and select it |
| CONV-02 | Load and switch between local conversations, including older records without Generation Batches |
| CONV-03 | Generate the first local title and allow renaming |
| CONV-04 | Filter conversation titles with the search field |
| CONV-05 | Pin and unpin, preserving chronological grouping |
| CONV-06 | Archive, browse archived conversations, and unarchive |
| CONV-07 | Confirm deletion, remove the intended conversation, and select a remaining conversation |
| CONV-08 | Confirm stopping before switching away from an active response; cancelling the dialog keeps it running |

### Chat and generation

| ID | Outcome to preserve |
| --- | --- |
| CHAT-01 | Submit to the selected conversation and models, showing the user turn while creation is pending |
| CHAT-02 | Enter submits, Shift+Enter adds a newline, and IME composition does not submit |
| CHAT-03 | Stream text into the intended answer and show waiting before content arrives |
| CHAT-04 | Reconcile completed Live Turns with saved history without duplicating messages |
| CHAT-05 | Stop the current batch and show a terminal result |
| CHAT-06 | Retry the intended target using a new attempt and the original target identity |
| CHAT-07 | Preserve a failed submission's draft and reuse the idempotency key when retrying uncertain delivery |
| CHAT-08 | Keep scroll-follow, reading older content, jump-to-latest, and basic safe Markdown rendering usable |

### Model comparison and context

| ID | Outcome to preserve |
| --- | --- |
| COMP-01 | Choose one to four ordered targets and prevent duplicate provider/model pairs |
| COMP-02 | Lock target changes during generation and handle missing or unavailable catalogs |
| COMP-03 | Display independent target answers, progress, errors, and verification states |
| COMP-04 | Stop an individual target while the remaining targets continue |
| COMP-05 | Retry an individual target and retain earlier results in local history |
| COMP-06 | Choose a completed answer or explicitly skip the batch before continuing |
| COMP-07 | Display saved selection and frozen context correctly, including when reading or retrying earlier batches |

### Provider configuration

| ID | Outcome to preserve |
| --- | --- |
| PROV-01 | Keep the NearAI preset bound to its fixed service and authentication method |
| PROV-02 | Add, edit, and remove custom OpenAI-compatible profiles |
| PROV-03 | Support Bearer and X-API-Key authentication while keeping saved secrets out of read models |
| PROV-04 | Test a connection and distinguish authentication, rate-limit, network, and model errors |
| PROV-05 | Discover and search models and show catalog loading, empty, failed, and disappeared-model states |
| PROV-06 | Rotate a key only after validation, preserving the previous usable secret on failure |
| PROV-07 | Remove a key while retaining the unconfigured profile and repair the active selection when profiles are removed |

### NearAI and verification

| ID | Outcome to preserve |
| --- | --- |
| VERIFY-01 | Route Private TEE, Incognito, and Chutes through their supported browser inference adapters |
| VERIFY-02 | Support independent NearAI targets and mixed NearAI/ordinary comparisons |
| VERIFY-03 | Show environment, streaming, and response-verification stages, cancellation, timeout, and failure |
| VERIFY-04 | Run the private connection probe and display its results |
| VERIFY-05 | Show immutable per-response Provider Snapshots, destination, transport, and privacy notices |
| VERIFY-06 | Distinguish model verification, gateway verification, unsupported evidence, and unverified responses |
| VERIFY-07 | Open model and gateway evidence, inspect raw evidence, copy values, and rerun supported checks |
| VERIFY-08 | Inspect saved signature details and conversation privacy summaries without claiming that opening history reruns verification |

### Preferences

| ID | Outcome to preserve |
| --- | --- |
| SET-01 | Persist light, dark, and system appearance through the existing settings API |
| SET-02 | Edit and save the System Prompt with the existing Unicode-aware limit |
| SET-03 | Save optional temperature, top-p, and token limits while retaining the meaning of blank and zero values |
| SET-04 | Keep the English interface and readable legacy locale preferences while supporting Unicode user content |

### Local data

| ID | Outcome to preserve |
| --- | --- |
| DATA-01 | Export one conversation as Markdown or JSON |
| DATA-02 | Export active and archived conversations, including comparison records and available snapshots |
| DATA-03 | Confirm clearing history, stop affected generation, and keep the documented provider/settings scope |
| DATA-04 | Show export, deletion, and clearing errors and recover to a usable workspace |

## Architecture and design direction

MedBox is the primary reference for `pages`, domain component directories, `components/ui`, `api`, `stores`, `theme`, and shared styles. React, TypeScript, Vite, Tailwind 4, TanStack Query, and Lucide are already in Cove. Use editable shadcn/Radix primitives and Tailwind recipes. Reserve CSS for semantic variables, base/theme registration, and shared keyframes/reduced-motion rules. Use Geist as a bundled font and semantic light/dark tokens with warm neutral canvases, mint, and restrained peach accents.

TanStack Query owns API records and cache invalidation. API hooks follow the Auto QA Alpha pattern of domain queries and mutations with centralized keys. Zustand may own shared client-only UI state when needed. React state owns local forms and transient interactions. Settings remain API-backed. Secrets and session proofs stay outside UI stores and browser persistence. Live generation presentation has one owner, with explicit cancellation, timeout cleanup, attempt identity, and final reconciliation against durable history.

LibreChat is a focused reference for separating chat composition, messages, input, stream handling, and Markdown rendering. Borrow these responsibilities and selective render optimization. Cove's browser inference adapters continue to serve its own NearAI protocol and verification requirements.

Go Chat continues to own durable generation lifecycles. Use the existing API contract and security boundaries described in [architecture](architecture.md), [Provider Snapshot requirements](adr/0008-show-provider-snapshots-in-assistant-messages.md), [generation commands and events](adr/0011-separate-generation-command-and-event-stream.md), [batch semantics](adr/0014-model-submissions-as-generation-batches.md), and [context semantics](adr/0015-use-a-selected-answer-for-comparison-context.md).

Motion should provide hover, press, selection, sidebar, and overlay feedback. Reading and streaming text remain visually stable. Respect reduced-motion preferences. Keep status names readable alongside colors and decorative icons.

## Known issues and scope control

These issues were reproduced during the earlier review of the baseline. Their presence must not be mistaken for refactor regressions or encoded as required behavior.

| Issue | Refactor handling |
| --- | --- |
| Browser NearAI context is assembled from all visible history, including unselected and skipped results, and ignores the retry's original context snapshot | Resolved during final regression with the additive authenticated context read endpoint in ADR-0021. Browser targets and retries now use the persisted immutable snapshot; failed reads stop inference |
| The legacy message retry route can start an ordinary plaintext Provider request for a private generation | Track as a separate backend fix; keep the frontend on the existing target retry route |
| Provider connection testing can reuse a stored key for a changed destination | The frontend requires a new explicit key when destination/authentication changes. Direct API credential binding remains a separate backend fix |
| Deleting or clearing history can leave generation state pointing at deleted records | The frontend cancels active generation and verifies terminal state before clearing; delete is unavailable during generation. Direct API lifecycle enforcement remains separate |
| A full SSE subscriber queue can block shared event publication | Track as a separate backend event-dispatch fix |

Backend security repairs, generation concurrency changes, background generation across conversation navigation, provider catalog request optimization, full-text search, localization expansion, and new account or cloud features require separate scope decisions. Requesting visual and architectural refactoring does not implicitly add those features.

The approved direction changes presentation. CSS-text tests that require the previous orange palette, square corners, decorative labels, or exact column widths should be replaced by the new design assertions during Stage 3. Preserve their accessibility and behavior checks. Update the owning architecture/decision documents when a later implementation changes an accepted frontend boundary.

## Verification and review

The Stage 1 interaction tests mount the full workspace with React Testing Library and jsdom. API commands and streams use synthetic in-memory fixtures. Real network requests are rejected. The existing transport, export, Live Turn, inference, and verifier tests continue to exercise their own boundaries.

For each implementation stage, run `make check`, the web suite, and the production web build. Keep generated embedded assets untracked. Stage 4 also runs the applicable service and packaging checks against an isolated data directory.

Visual and browser acceptance covers `390 x 844`, `768 x 1024`, `1280 x 720`, and `1440 x 900`, light and dark themes, reduced motion, keyboard focus, long names, long answers, code blocks, comparison reflow, and menus/overlays under the service's CSP. jsdom verifies interactions, not layout, contrast, animation, or CSP behavior.

The final runtime matrix includes ordinary-only, NearAI-only, and mixed comparison flows. Mocked NearAI tests verify frontend routing and transitions. A live-provider acceptance session is required to claim successful real attestation and cryptographic interoperability.

For Stage 1 review, confirm the 52 outcomes and the stage boundaries, then run `pnpm run test:web`. The interface remains the baseline UI during this gate. After review, Stage 2 can proceed against this inventory.

### Stage 1 evidence

Stage 1 was accepted by the user. On 2026-11-06, `make check test-web test-contract` passed, including the production web build, 152 web tests, and 8 API contract tests. The web total consists of the original 141 tests and 11 new workspace interaction cases.

The new cases exercise streamed-history reconciliation, idempotent recovery after uncertain delivery, rejected-submit draft recovery, independent comparison results and answer selection, explicit context skipping, target retry, stop confirmation during navigation, all three NearAI modes, and mixed Provider routing. They use the actual `App` composition, controlled API/stream boundaries, and a mocked private inference adapter.

Visual review, real browser layout/CSP checks, and live Provider verification remain Stage 3/4 acceptance work. The Stage 1 evidence does not close those checks or the known-issue register.

### Stage 2 evidence

Stage 2 separates the application entry, chat page, domain components, API endpoints, React Query hooks, interaction controllers, and inference adapters. `App.tsx` is 5 lines, `pages/ChatPage.tsx` is about 150 lines, and the workspace composition hook is about 150 lines. Ordinary batch events, private generation, private connection verification, conversation actions, and provider actions have individual controllers.

The user requested Auto QA Alpha's API organization during implementation. `api/hooks` now owns domain queries and mutations, and `api/queryKeys.ts` owns their cache identities. Business hooks invoke mutations through `mutateAsync`. Conversation refreshes populate the same detail/list keys used by the page. Active and archived lists have distinct keys, delayed results stay associated with the requested conversation, and clearing history removes cached conversation content. Local UI state uses React state within the workspace composition.

On 2026-11-06, `make check test-web test-contract build-service test-service` passed, including a production frontend/service build, 156 web tests, 8 contract tests, and Go race tests. Four additional interaction tests cover delayed conversation loads, persisted theme/model selection, failed startup sessions, and cache clearing. TypeScript also passes with unused-local and unused-parameter checks enabled.

An isolated Local Service with synthetic credentials and a loopback Provider passed a production Chromium smoke test. It exercised two successive two-model turns, independent answers, answer selection, reload with the selection restored, persisted dark appearance, settings open/Escape dismissal, and desktop/narrow-screen rendering. The browser reported no captured runtime exceptions. Temporary browser profiles and service data were removed after verification.

The user subsequently supplied a temporary NearAI credential for live testing. Connection validation and discovery returned 69 models. A production-browser comparison using `Qwen/Qwen3.8-27B` and `anthropic/claude-haiku-4-5` completed with `verified_model` and `verified_gateway` respectively. Their saved outcomes reloaded successfully, with no captured runtime exceptions. Temporary credential files, service records, and browser profiles were removed.

An earlier staging run ended with `secure_transport_error` for the private target and `response_verification_failed` for the first catalog-selected Incognito target. The pre-refactor build also failed verification for that initial Incognito catalog entry. The successful repeat used the explicit model pair above. These observations remain provider/inference stability evidence rather than a protocol repair delivered by this refactor.

For Stage 2 review, try normal chat, a comparison and answer selection, switching conversations, settings, and export through the local preview. Review the API hook structure and the component/controller boundaries. The existing stylesheet is the starting point for the separately reviewed Stage 3 design work. The known-issue register and live NearAI acceptance requirements continue to apply.

### Stage 3 presentation and skin system

The user authorized Stage 3 after Stage 2 validation and specified Tailwind and shadcn, following MedBox. Shared Button and Select source follows MedBox; Input, Textarea, Badge, and Dialog use the same editable shadcn/Radix pattern. `components.json` records the UI configuration. Existing searchable Combobox and menu adapters retain Headless UI behavior and use the shared controls.

Component layout and states now use Tailwind recipes in `src/styles/*.ts`. The 14,259-line legacy component stylesheet has been removed. CSS is limited to semantic theme variables, Tailwind theme registration/base rules, and shared animation/reduced-motion definitions. Palette colors are centralized in `theme/tokens.css`; semantic utilities and a shared radius/elevation system allow later skins without component-specific palette branches. See [ADR-0020](adr/0020-use-tailwind-recipes-and-shadcn-primitives.md).

The visual direction uses a warm canvas, mint/forest colors, restrained peach/rose accents, rounded controls, a locally drawn friendly conversation mark, suggestion cards, and subtle entrance/hover/press feedback. The sidebar, composer, comparison cards, settings, provider forms, privacy panel, and evidence dialogs share the same light/dark tokens. Streaming text does not replay entrance animation. Reduced motion disables animated feedback and smooth scrolling.

The visual migration also makes closed menus unmounted, aligns the drawer breakpoint with workspace layout, keeps an empty conversation at the beginning of its welcome content, and lets Escape dismiss the nested add-model search in one step. Settings tabs support arrow/Home/End navigation and dialogs restore focus on dismissal.

On 2026-11-06, `make check test-web test-contract build-service` passed with 151 web tests and 8 contract tests. The web count replaces 10 obsolete CSS-text tests that locked the previous layout and palette, and adds 5 interaction cases for settings keyboard/focus behavior, suggested prompts, private verification menus, saved evidence re-verification, and nested model-menu dismissal. Existing behavioral and inference tests remain in place.

An isolated production Chromium session passed authenticated startup, native pointer selection of Provider/model options inside the Radix settings dialog, model search, two consecutive two-model turns, answer selection, saved-history reload, theme persistence, settings dismissal, the mobile drawer, privacy details, and reduced-motion behavior. Layout checks covered 390 x 844, 768 x 1024, 1280 x 720, and 1440 x 900 with no page-wide horizontal overflow and a reachable composer. Screenshots were inspected in light/dark themes. No browser runtime exceptions were captured. Four representative semantic text/background pairs exceeded 4.5:1 contrast in each theme; this is not a complete accessibility audit. Temporary browser profiles and service data were removed.

For Stage 3 review, inspect light/dark empty chat, a normal chat and comparison, the model picker, sidebar collapse/mobile drawer, all settings sections, and privacy/evidence details. These views are included in the final Stage 4 review authorized by the user. The remaining backend issues in the register are outside this frontend migration.


### Stage 4 repairs and acceptance evidence

The final review removes redundant title state, unused component props/recipes, obsolete context reconstruction, duplicate comparison summary markup, and decoration that obscured status or cramped controls. Conversation scrolling follows viewport/font changes while preserving a reader's explicit scroll position. Chat composition and comparison summaries have focused components, and stable Markdown history is memoized. Styles remain Tailwind recipes and shared primitives; semantic variables also support the independently added Continuum, Blueprint, Studio, and Grove skins.

Repairs cover blocking a new comparison turn until the previous answer is selected/skipped, delaying target retries until the active batch is terminal, cancellation cleanup while waiting for SDK verification, timeout settlement during context/transport failures, clearing active streams and caches safely, preserving unsaved settings drafts during appearance changes, reacting to system appearance changes, serializing Provider form actions, and requiring a new key when changing a Provider destination. Ordinary unsupported verification no longer displays failed evidence lanes.

The only service addition is the read-only authenticated frozen-context endpoint described in [ADR-0021](adr/0021-read-authoritative-context-for-browser-inference.md). HTTP adaptation and Chat/storage ownership remain unchanged. No inference protocol, persistence migration, release, or remote publication is introduced.

The maintained `make test-web-browser` suite uses the production embedded assets, session/CSRF/CSP boundaries, a loopback Provider, and disposable local state. Its evidence lives under ignored `.artifacts/frontend-acceptance/`; see [development](development.md#browser-acceptance) for reproduction. Synthetic fixtures establish interface/lifecycle behavior; they do not establish successful live attestation.

The 52 outcomes are covered across complementary layers:

| Outcomes | Evidence |
| --- | --- |
| WORK-01–06 | Authenticated browser startup, responsive/drawer and overlay checks; startup/error, focus/keyboard interaction tests |
| CONV-01–08 | Browser create, rename, search, pin/archive/unarchive/delete; delayed selection and stop-before-navigation tests; service legacy history coverage |
| CHAT-01–08 | Browser streaming, two/four/single-model turns, stop/retry, keyboard/newline/Unicode, long Markdown/scroll; idempotency, draft recovery, reconciliation and IME unit coverage |
| COMP-01–07 | Browser target controls, individual stop/retry, answer choice/skip, reload and selected-only frozen context; contract/service snapshots and frontend failure/lock tests |
| PROV-01–07 | Browser preset/custom authentication, connection/catalog, key rotation/removal and profile deletion; destination guard, serialized saves and transport error tests |
| VERIFY-01–08 | Mocked three-mode and mixed routing, SDK/cancellation/verification tests, snapshot/evidence menus and re-verification interactions; separate live NearAI runs recorded below |
| SET-01–04 | Browser light/dark/system and skin persistence, prompt save; settings draft, parameter/Unicode/legacy locale tests |
| DATA-01–04 | Browser conversation/workspace exports, delete/clear confirm and cancel; export formats, errors, cache ownership and active-clear tests |

Remaining backend findings in the register are retained explicitly. This frontend regression does not claim those direct API paths are repaired or that automated accessibility rules replace assistive-technology testing.


On 2026-11-06, the final source/production build checks and unused-local/parameter TypeScript checks passed. The suites passed 165 web tests, 9 contract tests, Go race tests, and 2 script tests. The Swift Launcher builds, the isolated Local Service lifecycle check passes, and the disposable macOS app/DMG package test passes. `swift test` remains blocked by this machine's missing XCTest module/full Xcode installation; no Launcher source was changed.

Live NearAI acceptance used a disposable credential and isolated data. Discovery returned 69 models. A first run completed Incognito gateway verification while Private TEE failed with `secure_transport_error` after a staging 500. A repeated production-browser run completed `Qwen/Qwen3.8-27B` with `verified_model` and `anthropic/claude-haiku-4-5` with `verified_gateway`, then reloaded their saved outcomes with zero captured browser runtime exceptions. The fixture removed its credential, browser profile, and conversation data. This confirms successful interoperability for that run while retaining evidence of staging instability.


The final production Chromium acceptance run passes the complete maintained fixture, including ordinary comparison without misleading private verification lanes, pinned/archived conversation maintenance, selected-only context, single/four-model chat, retry/stop, Provider lifecycle, settings/data operations, and viewport widths 320, 390, 768, 979, 980, 981, 1280, and 1440. It captures zero browser runtime exceptions. Axe WCAG 2 A/AA and 2.1 AA rules report zero violations across 16 welcome/settings surfaces (four skins, light and dark). This audit led to correcting tab ARIA semantics and the Grove light privacy-caption contrast. Browser screenshots were inspected; fixed-composer reachability, latest-message scrolling after resize, Unicode/newline input, reduced motion, long Markdown, and skin overrides pass.

The frontend is ready for final user acceptance against the inventory. Previously identified direct backend API issues remain listed above, and the XCTest environment limitation remains explicit.


### Post-refactor cleanup

The user requested a further unused-code and test-organization review. Root-level tests now live beside API, chat, inference, export, and theme modules. The former `App.test.tsx` is split into focused domain/component suites with shared generation fixtures; the full workspace interaction suite is named `pages/ChatPage.interactions.test.tsx`.

Removed code includes the unused legacy per-generation SSE subscriber/read wrapper, message-level retry wrapper, separate message-list read wrapper, retired single-selection helpers, obsolete two-press clear helper, unused Select subcomponents/exports, and 37 unreferenced interface-copy entries. Backend compatibility endpoints, persistence, browser inference, and active batch/target commands remain unchanged. Three tests of retired helpers were removed; retained default-selection/verification cases exercise the current model-set/target helpers, and conversation transport checks the detail record actually used by the workspace.

TypeScript now checks unused locals and parameters in the normal check/build configuration. Import-graph and exported-symbol review found no orphan source modules or unreferenced exports after cleanup. Shared test fixtures and internal helpers exposed for focused tests remain intentional; dynamic inference imports were checked manually rather than treated as dead code. Existing runtime/tooling dependencies are used and retained.


Cleanup validation passed `make check`, 164 web tests across 25 colocated/integration files, 9 contract tests, and the production browser acceptance suite. The browser reported zero captured runtime exceptions; all 16 skin/theme welcome/settings accessibility audits reported zero rule violations. Migration-only scripts, scratch screenshots, and baseline binaries from the completed refactor were removed; sanitized check/audit/browser logs are retained under ignored `.artifacts/frontend-cleanup/`. Personal Local Service data and runtime state were not part of the cleanup.
