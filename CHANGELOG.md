# Changelog

## Unreleased

### Added

- Search local conversation titles and saved user/assistant text with Unicode-aware matching, bounded excerpts, archive filtering, and turn navigation (#17).
- Index local message bodies with a backfilled SQLite trigram index (schema 16); retain short-query scans and refresh active searches when saved history changes.
- Discover newer published beta, release-candidate, and stable versions through an explicit Launcher beta-update action, with SemVer ordering and an official Releases fallback (#21).

### Fixed

- Confirm before discarding unsent text or attachments when switching conversations, starting a new chat, or changing archive views; preserve drafts when staying or cancellation fails, and protect edits while creating a conversation (#18).
- Include Selected Answer, context-skip, and unresolved-comparison state in grouped Markdown exports without changing saved context (#19).
- Keep answer selection atomic with retries and archived search results ordered by archive time.

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
