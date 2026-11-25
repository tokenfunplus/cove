# Changelog

## Unreleased

### Added

- Bring selected text into the Quick Panel with Ask Cove in macOS Services.

### Fixed

- Keep local document search and result actions visible while reviewing compact excerpts. Recover horizontal PDF text split into single glyphs and offer to update older local PDF indexes from their saved originals.

## 0.1.0-beta.11 - 2026-11-24

### Added

- Configure system, manual HTTP/HTTPS/SOCKS5, or direct model download connections in Settings > Network. Test download sources in the app and open network settings from a failed download.

### Changed

- Use Control-Option-C for the optional Quick Panel shortcut, preserving its enabled or disabled setting.

### Fixed

- Bring the Quick Panel forward after menu invocation, support other apps' full screen and Stage Manager spaces, recover its position when reopening on another display, and return focus on dismissal.
- Honor ordered system/PAC proxy fallbacks without inventing direct routes, bound connection probe bodies across redirects, and associate proxy validation errors with their input.

## 0.1.0-beta.10 - 2026-11-24

### Added

- Open the macOS Quick Panel from the menu bar or with Control-Option-Space. Type, paste, or drop a supported file, keep the panel pinned for reference, and open the same conversation in the full workspace.

### Changed

- Resume interrupted inference and speech artifact downloads on retry, with validated HTTP ranges, full integrity checks, and explicit partial-download cleanup.
- Deduplicate local search results by original sections and add a user-controlled similarity filter with empty-result guidance.
- Show local inference waiting, preparation, and generation activity; unload the previous inference model on switching to bound retained memory.

### Fixed

- Use unsaved volume and CPU settings for voice previews, allow clearing preview text, and preserve speech drafts when switching capability views.
- Save effective local output limits per attempt without changing remote comparison targets or workspace preferences. Disclose the local token budget in context review.

## 0.1.0-beta.9 - 2026-11-23

### Added

- Add opt-in Debate read aloud with ordered local speech playback for new participant turns, installation/settings guidance, queue status, and explicit stop/navigation cleanup.

- Added five managed local speech downloads, per-model voice/speed preferences, English/Chinese routing, voice preview, and answer read aloud with pause/stop and WAV export. Speech remains independent of chat Providers and works offline after installation.

- Add independently selectable Qwen3 0.6B Abliterated Q5_K_M (444.4 MB) with verified installation, non-thinking local inference, model-specific history provenance, and local-only execution alongside the existing Qwen2.5 model.

- Integrate On this Mac capability management and in-place installation with composer tools, explicit local chat selection, scoped Project material search, and saved server-enforced local-only execution policy. SQLite schema 26 preserves existing fixed-source behavior and frozen payloads.

- Local Projects with reusable instructions/background, fixed file/webpage sources, conversation moves, scoped history, and context usage inspection.
- Independent project input snapshots shared by ordinary and NearAI targets/retries, content-addressed originals, preserved revision-conflict drafts, and same-project continuation for oversized conversations.

- Expand Local models from seven to 27 entries across eleven tasks, including translation, Chinese OCR, speech synthesis, image tools, audio preparation, language identification, and additional small chat families. Add Cove-integration and multilingual filters, finer size limits, source revisions, model-license links, and explicit explore-only badges.

- A curated Local models page with task/language/weight-size filters, artifact details, source links, and managed, integrity-checked BGE Small Chinese (26.5 MB) and Qwen2.5 0.5B (491 MB) downloads.
- Explicit local document indexing and semantic search, original-section previews, selected result attachments, persistent citations, and separate document/model deletion controls.
- A managed `On this Mac` offline chat Provider with streamed output, Stop controls, saved model/runtime provenance, and ordinary conversation history.

### Changed

- Fix local-search submit isolation, local-only retry enforcement, private inference worker transport/deadlines, scoped Project source invalidation, and local speech text, playback, and cleanup regressions found during review. Preserve in-flight settings edits and repeated settings navigation.

- Replace remaining native form controls and disclosure widgets with shared custom components across Discover, speech settings, Projects, Chat, Debate, and verification. Preserve keyboard navigation, focus restoration, form values, and streaming reasoning state.

- Streamline On this Mac discovery with separate integrated/explore-only groups, compact filters, file-size sorting, progressive candidate browsing, and preserved filters across Installed/Discover switching.

- Move Projects into a dedicated directory and project home. Ordinary chat keeps a compact navigation entry; global New chat stays ungrouped, and conversation menus own project moves.

- Upgrade SQLite to schema 27. Older services reject upgraded databases; retain a compatible backup before upgrading if downgrade is needed.
- Clear-history retains live Project settings and fixed sources. Project dissolution preserves Conversations; project deletion previews retained historical copies outside its current members.

- SQLite schema 25 adds local document originals and versioned embedding indexes. Older services reject upgraded databases; clearing chat data also clears the document library while keeping installed weights.
- macOS packages include a signed, pinned llama.cpp runtime. Optional native inference requires Apple Silicon and macOS 13.3 or later; unsupported catalog entries remain discovery-only.

### Fixed

- Sign bundled inference and speech workers and libraries before the enclosing app when notarizing a CI-built package locally.

- Cancel pending document operations when their dialog closes, release late source previews, and process library imports beyond four files without silently discarding the remaining selection.
- Keep cleared libraries empty during concurrent document parsing and late cache refreshes, while preserving installed model weights.
- Serialize local model removal with Generation admission, reject already canceled local work, and terminate native workers when Stop occurs before response headers.
- Remove orphaned temporary weight downloads on retry or model removal, and reject source callbacks retained by a previous conversation.

- Keep Local Service reads and commands active without internet, including offline workspace startup, local model selection, sending messages, and stopping generation. Browser offline state no longer pauses loopback requests.

## 0.1.0-beta.8 - 2026-11-21

### Added

- Opt-in autonomous Web search for chat and Model Comparison, with Tavily/Linkup/Exa Keychain configuration, per-attempt request limits, verified NearAI tool requests, saved evidence, References, and local research traces.
- Explicit public webpage reading with bounded credential-free retrieval, session-bound previews, and saved source text/provenance shared by ordinary and NearAI inference, retries, branches, citations, and exports.

### Changed

- Refine Web search setup into connection, usage limits, and advanced options with shared custom selectors, numeric steppers, and a compact composer toolbar.
- Streamline the Launcher menu, keep login launches quiet, expose direct service recovery and Provider setup, and retain discovered updates under one menu with installed-version release notes in About Cove.
- Migrate automatic research policy, traces, and saved web sources to SQLite schema 22. Older services reject upgraded databases.
- Provide a consistent drag-to-Applications DMG layout with a Retina installation background and an Applications shortcut.

## 0.1.0-beta.7 - 2026-11-19

### Added

- Cited Debate stage summaries for new ideas, supported position changes, and open questions, using a selected model seat and the existing service or NearAI verification transport.
- Cumulative Debate token/cost estimates, optional budget reminders and automatic pause, editable rates, and service-owned turn intervals. Summary calls and reported failed/stopped usage count toward budgets independently of transcript pagination.

### Changed

- Guard persisted Debate budget and summary controls with schema 21. Existing debates retain disabled summaries and budgets until configured; older services reject upgraded databases.
- Compact standard and Focus Debate layouts, group workspace actions, grow the intervention field with its content and container width, and shorten live-brief previews.

### Fixed

- Authenticate NearAI keys before trusting the public model catalog. Open Provider settings on the active connection, follow delayed profile selection, and preserve manual drafts and connection-test status during metadata-only saves.
- Keep the canonical Debate topic visible after renaming its history entry, and make New debate available in Focus mode.
- Clear accounting markers for rejected browser claims before restart recovery, retain original completed summary responses with invalid citations in Details, and retry unclaimed summaries without repeating settled paid analysis.

## 0.1.0-beta.6 - 2026-11-19

### Fixed

- Preserve terminal Stop and committed round cursors through storage failures, close shutdown/Pause admission races, and retain browser results accepted before expiry.
- Load full browser verification evidence from checkpoints, guard stale inspection requests, protect pending intervention drafts, and preserve intervention replay beyond the history window.

- Distinguish expired local browser authorization from Provider connection failures in setup, and show how to reopen an authorized session.
- Include configured NearAI catalogs in Debate model seats and execute their turns through the existing browser verification transport, with exclusive claims, bounded waits, and explicit recovery.

### Added

- A history toolbar with remembered activity/type filters, clear/reset actions, filtered local search, and current Debate state/round labels in active and archived history.
- Debate Focus mode with a full-width transcript, participant activity, emphasized turn cards, an on-demand live brief, and preserved debate controls and intervention drafts.
- Continuous Debate mode with two to four model seats, roles, blind openings, rotating turns, versioned rules, round-boundary interventions, attributed checkpoints, local history, and transcript exports.
- Service-owned scheduling with pause, step, resume, immediate stop, bounded context, Provider-error recovery, and paused restart recovery. Service-driven models continue with the browser closed; NearAI participation requires the debate page to remain open.

### Changed

- Default new Provider setup to OpenAI-compatible with blank identity/endpoint fields. Changing connection type clears the previous draft credentials, model catalog, and connection-test state.

- Migrate SQLite to schema 20 for Debate Sessions and their turns/interventions. Older services reject the newer schema. Debate supports both service-driven and browser-verified NearAI models without changing their transport requirements.

## 0.1.0-beta.5 - 2026-11-18

### Added

- Selection-based side conversations and an answer workbench with local editing, bounded undo/redo, reviewed model revisions, and Markdown download.
- Observed Generation timings, Provider-reported token usage, and optional estimates from browser-local model rates.
- Model brand icons and advertised catalog details, with favorites, recent models, capability/context/price filters, and saved model combinations.
- Edit-and-resend branches that preserve the source turn's exact selected context and saved attachments without changing the original conversation.
- Local LaTeX rendering for inline/display formulas, matrices, and aligned equations, including contained scrolling in Model Comparison. Fixes [#25](https://github.com/tokenfunplus/cove/issues/25).

### Fixed

- Preserve branch cancellation during loading, revision failures, unsent edits, token counts, verification details, and reading updates across asynchronous transitions.
- Apply conservative local picomatch and bundled Rollup parser patches for GHSA-fc5q-39xc-vjpf, with a checksum-verified CI audit gate.
- Separate structured Provider reasoning from answer text and collapse it after streaming, including the NearAI Gateway Responses path.
- Preserve the reading position while reasoning folds or streamed content changes, and show how many answers changed while following was paused.
- Use themed filter menus with correct nested Escape, focus, and narrow-screen behavior instead of operating-system dropdowns.

### Changed

- Combine performance, immutable Provider/Privacy details, and verification reports in one Response details dialog, while keeping verification failures visible.
- Show elapsed generation stages, a stop action for prolonged waits, and applicable recovery controls after failures.
- Migrate SQLite from schema 16 through 19 for optional metrics, separate reasoning, and branch provenance. Older services reject the newer schema; preserve a compatible backup for downgrade.
- Bundle KaTeX 0.19.1, its fonts, and selected LobeHub model icons locally with license notices; retain the existing CSP and original message source.

## 0.1.0-beta.4 - 2026-11-17

### Added

- Search local conversation titles and saved user/assistant text with Unicode-aware matching, bounded excerpts, archive filtering, and turn navigation (#17).
- Index local message bodies with a backfilled SQLite trigram index (schema 16); retain short-query scans and refresh active searches when saved history changes.
- Discover newer published beta, release-candidate, and stable versions through an explicit Launcher beta-update action, with SemVer ordering and an official Releases fallback (#21).

### Fixed

- Confirm before discarding unsent text or attachments when switching conversations, starting a new chat, or changing archive views; preserve drafts when staying or cancellation fails, and protect edits while creating a conversation (#18).
- Include Selected Answer, context-skip, and unresolved-comparison state in grouped Markdown exports without changing saved context (#19).
- Keep answer selection atomic with retries and archived search results ordered by archive time.

### Changed

- Keep Browser Session credentials in per-tab, origin-scoped storage and explicit request headers rather than host-wide cookies.
- Validate requested Provider/model targets against current catalogs and retain Private TEE requirements across retries.
- Harden Provider connection updates, credential replacement, generation transitions, and stream handling.
- Add detached publisher signatures for published downloads and require pull-request checks on the main branch.
- Prepare build 4 with updated onboarding, configuration, history-search, draft, export, and beta-update documentation.

## 0.1.0-beta.3 - 2026-11-16

### Added

- A compact conversation timeline with turn previews, click-to-jump navigation, and browser-local bookmarks that store message references only.
- A compact native Launcher menu with authenticated New Chat and Settings shortcuts, opt-in launch at login and Control-Option-Space, grouped troubleshooting, private diagnostic summaries, and a version link to the matching GitHub Release tag.
- Focus mode with an expanded reading area, compact header and composer, reversible sidebar layout, and an Exit Focus action with Escape support.
- Position Jump to latest above the actual composer and context-choice height, including attachment and multiline drafts.

### Fixed

- Render the menu-bar wave mark through AppKit so SwiftUI cannot silently display an empty named image from the packaged resource bundle; show a system wave symbol if the resource is missing.

### Changed

- Update x/sys and add CodeQL, OpenSSF Scorecard, and active fuzzing to repository security checks.
- Publish build 3 with updated setup, Focus, timeline bookmark, and beta compatibility documentation.

## 0.1.0-beta.2 - 2026-11-15

### Added

- File chat with local text/code/PDF parsing, immutable source snapshots, original-file downloads, source citation navigation, and draft/saved Provider context inspection.
- Bounded PDF parser subprocesses and application input limits; see ADR-0025 for supported files and compatibility.
- A user guide covering setup, file chat, comparison context, and beta updates.

### Changed

- Unify the Chat Surface, favicon, macOS application icon, and menu bar around the blue and teal Cove wave mark.
- Load menu-bar image resources from the installed application bundle and test startup without the original SwiftPM resource directory.
- Refresh the README, release documentation, and product website for the second signed and notarized beta.

- Detect failed/incomplete Gateway Responses SSE events before receipt lookup and display bounded upstream errors instead of misreporting them as cryptographic verification failures.

- Reuse authorized Keychain reads within the Local Service, coalesce concurrent reads, and preserve fresh version/write checks during rotation. Evict cached keys on deletion or missing-item checks.
- Stop automatic Provider catalog retries and focus/reconnect refreshes that could repeatedly open macOS authorization dialogs. Explicit connection tests can recover denied catalog reads.

- Preserve attached source text in selected/frozen context, target retries, history, and Markdown/JSON exports. SQLite schema 14 preserves existing history; original file bytes stay out of exports.
- Enforce cancel-and-wait in Chat before direct conversation deletion removes source records.

## 0.1.0-beta.1 - 2026-11-15

### Added

- Add a synchronized release-version command and the first Apple Silicon beta package.
- Support local signing and notarization of CI-built Mac packages without installing full Xcode locally.
- Add SVG and PNG browser favicons using Cove's conversation mark.
- Embed the NearAI Cloud verification center with local saved-details fallback, bounded report projection, theme support, and connection recovery.
- Add code-block language labels and clipboard success/failure feedback.
- Open verification details directly from message status labels, show gateway evidence from gateway shortcuts, and support keyboard navigation in local evidence tabs.

- Contributor guidance, an MIT license, security reporting instructions, and issue and pull request templates.
- Architecture, privacy, development, and release documentation.
- Repository checks, dependency maintenance configuration, and isolated local-service test data directories.
- Update manifests attached to GitHub release artifacts.

### Changed

- Align the Go service's compiled deployment target with the app's macOS 13 minimum and reject incompatible release binaries.
- Sign local macOS service builds with an available certificate-backed identity and a fixed identifier, preserving ad-hoc fallback for machines without certificates.
- Fix scrolling in long model lists inside settings, bound dropdown height, and clarify selected options and search results.
- Disconnect slow event subscribers without blocking generation or cancellation.
- Expire abandoned browser Generations on the Local Service, including retries, while allowing grace for normal browser settlement.
- Run production browser acceptance in CI and retain its synthetic screenshots and accessibility evidence.
- Renamed the supplied Secure Chat / TBD application to Cove, including package names, bundle identifier, and local application namespace.
- Standardized project text and the interface on English while preserving Unicode conversation support.
- Made Keychain the default credential store; plaintext test storage is an explicit opt-in.
- Upgraded the NearAI inference SDK to 0.2.1 and refreshed affected build and test dependencies.
- Load the private inference SDK on demand and release its response cache after verification.
- Prevent stale busy errors while a completed generation finishes worker cleanup.
- Removed internal planning files, machine-specific documentation, unused translations, and checked-in production web bundles.

The first Cove test release is `0.1.0-beta.1`; `0.1.0` remains the planned first stable release. Cove uses a separate data directory and Keychain namespace from earlier TBD installations; no automatic data migration is performed.
