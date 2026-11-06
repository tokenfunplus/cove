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

## Frontend tests

Unit and component tests live beside the module they exercise as `*.test.ts` or `*.test.tsx`. The workspace integration suite lives in `pages/ChatPage.interactions.test.tsx`; it mounts the application with controlled API/inference boundaries. Shared synthetic records belong in `src/test/` and are never imported by production code. Production browser acceptance remains in `apps/web/e2e/`.

Tests are development checks and are excluded from the application import graph. Preserve behavioral, accessibility, protocol, and failure-recovery coverage when reorganizing them. Remove tests that exercise retired code rather than retaining obsolete production helpers solely for those tests. TypeScript checks unused locals and parameters as part of every normal check/build.

## Browser acceptance

`make test-web-browser` builds the embedded production application and drives Chromium through the DevTools protocol. The fixture creates its own service, loopback Provider, disposable credentials, browser profile, and temporary data directory, then removes them on exit. It never reads personal conversations or Provider Keys. Chrome on macOS is the default browser; set `COVE_BROWSER_BIN` to a compatible Chromium executable on another platform. Port 19520 must be available.

Screenshots and the accessibility report are written to `.artifacts/frontend-acceptance/` (override with `COVE_BROWSER_ARTIFACT_DIR`). The suite checks authenticated startup, native control interactions, all skins, appearance persistence/system changes, responsive layouts, comparison selection and frozen context, retries/stops, conversation management, exports, settings, Provider/key maintenance, reduced motion, and WCAG rule violations on welcome/settings surfaces in every skin and appearance. Inference protocol and failure transitions also have focused unit/service coverage; real NearAI verification requires a separate disposable live credential.

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
