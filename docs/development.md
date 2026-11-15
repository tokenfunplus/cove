# Development

## Requirements

For the full application, use an Apple Silicon Mac with macOS 13+, Swift 5.10+ from Xcode (the XCTest suite requires a full Xcode installation), Go 1.26+, Node.js 24.22.1+, pnpm 10.11, and `make`. Install JavaScript dependencies with `pnpm install --frozen-lockfile`.

Web, contract, and Go tests also run on Linux. The Launcher, Keychain adapter, and DMG require macOS. Unsupported platforms must explicitly use the test file store to exercise provider credentials.

## Commands

| Command | Purpose |
| --- | --- |
| `make help` | List common tasks |
| `make start-local` / `make stop-local` | Build and open the Chat Surface / stop its service |
| `make build` | Build web assets, Go service, and Swift Launcher |
| `make check` | Repository conventions, TypeScript, Go formatting, and analysis |
| `make test` | Contract, web, Go race, and Swift tests |
| `make test-contract test-web test-service` | Portable test suite for Linux |
| `make test-web-browser` | Production Chromium acceptance with isolated service/Provider fixtures |
| `make test-lifecycle` | Isolated start, reuse, health, and shutdown checks |
| `make dmg` | Package an Apple Silicon app and DMG |
| `make test-package-macos` | Build and launch an isolated acceptance fixture |
| `pnpm audit` | Inspect JavaScript dependency advisories |

`make build-service` builds web assets first. Calling `scripts/go build` directly before a web build embeds an English setup page instead of the application. Generated assets live in `services/local-service/internal/webassets/content/dist/` and stay untracked.

The Go wrapper sets a macOS 13 deployment target and matching cgo compiler/linker flags on macOS. Local builds can override `MACOSX_DEPLOYMENT_TARGET`; packaged builds use `LSMinimumSystemVersion` from the app's Info.plist. This prevents a newer build Mac from silently raising the Local Service's minimum OS above the Launcher's requirement.

## Brand assets

The editable wave mark is `apps/web/public/assets/cove-mark.svg`. Run `node scripts/generate-brand-assets.mjs` on macOS after editing it to refresh the SVG/PNG favicon, the macOS application icon source, and the monochrome menu-bar templates. The Chat Surface uses the same mark across the sidebar, welcome surface, empty state, and settings. Packaging derives the application icon's resolution variants from `apps/macos/Resources/AppIcon.svg`.

## Local code signing

On macOS, `make build-service` signs and verifies the Local Service after compilation, so `make start-local` uses the same signing path. The signing identifier is always `io.github.tokenfunplus.cove.local-service`. With no explicit selection, the build uses a single valid Developer ID Application identity, or a single Apple Development identity if no Developer ID identity exists. Multiple identities of the preferred type require an explicit selection:

```sh
export COVE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
make build-service
```

The variable also accepts a certificate fingerprint. Certificate names and fingerprints are resolved from the local keychain and are never written into tracked project configuration. Machines without either identity type retain ad-hoc signing; set `COVE_SIGNING_IDENTITY=-` to request that mode explicitly for isolated fixtures. A selected identity's signing or verification failure stops the build. Linux builds skip this macOS step.

Certificate-backed local builds use Hardened Runtime and omit a secure timestamp to work offline. They do not submit software for notarization. Distributable packages use the separate timestamped signing and notarization flow in [releasing.md](releasing.md).

Switching from an ad-hoc build to a certificate-backed build changes the service identity once. Existing Provider Key access controls may need to authorize the new identity; subsequent builds with the same signing identity and identifier preserve that identity. Signing does not change stored Provider Keys or their access controls. See [ADR-0024](adr/0024-sign-local-service-builds-with-stable-identities.md).

Use the default certificate-backed signing path for development sessions that read real Provider Keys. `COVE_SIGNING_IDENTITY=-` is suitable for isolated fixtures; repeatedly rebuilding it changes the identity recognized by Keychain. Do not use a plaintext secret store or broaden item access controls to work around a signing authorization. Provider catalog failures do not retry on focus or reconnect; after granting access, use the Provider's explicit connection test to recover its catalog. Successful key reads are reused within the running service; restart after changing an existing key outside Cove. See [ADR-0026](adr/0026-reuse-authorized-keychain-reads-without-passive-retries.md).

## Frontend tests

Unit and component tests live beside the module they exercise as `*.test.ts` or `*.test.tsx`. The workspace integration suite lives in `pages/ChatPage.interactions.test.tsx`; it mounts the application with controlled API/inference boundaries. Shared synthetic records belong in `src/test/` and are never imported by production code. Production browser acceptance remains in `apps/web/e2e/`.

Tests are development checks and are excluded from the application import graph. Preserve behavioral, accessibility, protocol, and failure-recovery coverage when reorganizing them. Remove tests that exercise retired code rather than retaining obsolete production helpers solely for those tests. TypeScript checks unused locals and parameters as part of every normal check/build.

## Browser acceptance

`make test-web-browser` builds the embedded production application and drives Chromium through the DevTools protocol. The fixture creates its own service, loopback Provider, disposable credentials, browser profile, and temporary data directory, then removes them on exit. It never reads personal conversations or Provider Keys. Chrome on macOS is the default browser; set `COVE_BROWSER_BIN` to a compatible Chromium executable on another platform. Port 19520 must be available.

Screenshots and the accessibility report are written to `.artifacts/frontend-acceptance/` (override with `COVE_BROWSER_ARTIFACT_DIR`). The suite checks authenticated startup, native control interactions, all skins, appearance persistence/system changes, responsive layouts, comparison selection and frozen context, retries/stops, conversation management, exports, settings, Provider/key maintenance, reduced motion, and WCAG rule violations on welcome/settings surfaces in every skin and appearance. Inference protocol and failure transitions also have focused unit/service coverage; real NearAI verification requires a separate disposable live credential.

CI runs this acceptance suite against its installed Chrome or Chromium and uploads the synthetic browser evidence for seven days, including on failure when artifacts are available.

## Local state and credentials

The service stores `cove.sqlite` under `~/Library/Application Support/cove/` and Provider Keys in macOS Keychain by default. Development process state and logs live under `.artifacts/` with owner-only permissions. Treat them as sensitive.

For an isolated session:

```sh
export COVE_DATA_DIR="$(mktemp -d)"
make start-local
make stop-local
```

`COVE_DATA_DIR` changes the database and file-store location; Keychain remains an operating-system store. The service also accepts `--data-dir /absolute/path`. To avoid Keychain in an isolated test, explicitly set `COVE_INSECURE_FILE_SECRET_STORE=1`. This writes plaintext keys to `insecure-test-provider-secrets.json` with mode `0600`; use disposable credentials. Stop the service before changing storage mode or data directory.

Integration fixtures configure temporary directories. Never point tests at personal history or share runtime state files.

## Troubleshooting

- **Expired browser session:** reopen with `make start-local` or the Launcher. Restarting the service invalidates sessions.
- **Provider unavailable:** verify endpoint, authentication, model catalog, and availability. The NearAI preset uses a fixed staging endpoint.
- **Stale interface:** run `make build-service` and restart. Assets are embedded at Go compile time.
- **Go missing:** put a working Go executable on `PATH`; `scripts/go` also supports Homebrew or goenv.
- **Linux development:** use portable targets and the explicit file-store option; SwiftUI and Keychain are unavailable.

Read `CONTEXT.md` and relevant decisions in `docs/adr/` when changing domain behavior.
