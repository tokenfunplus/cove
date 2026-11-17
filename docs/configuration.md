# Configuration reference

For a first run, follow the [quick start](../README.md#quick-start). Manage everyday settings in the Chat Surface's Settings dialog. This reference groups supported settings, their storage, and developer options; it does not require editing the local database.

## Provider Profiles

Open **Settings → Provider settings** to configure a connection. Enter a key, click **Test connection** to load the model catalog, choose a model target for initial setup, then click **Save Provider**. Testing alone does not save the key or profile. Enter a Key again when changing a configured connection’s endpoint or authentication method. A saved Key is only used with its saved destination and authentication method. The NearAI preset uses a fixed staging endpoint; custom Providers use OpenAI-compatible APIs.

| Field | Meaning |
| --- | --- |
| Display name (`name`) | Local label for the Provider Profile. |
| Connection type (`kind`) | `nearai` for the supplied preset or `openai_compatible` for a custom Provider. |
| Endpoint (`endpoint`) | Custom Provider URL. HTTPS is required except for loopback HTTP destinations. The preset's service endpoint is managed by Cove. |
| Authentication (`auth_method`) | `bearer` sends `Authorization: Bearer <key>`; `x_api_key` sends the key in `X-API-Key`. |
| API key (`secret` on writes) | Entered through Settings and stored in macOS Keychain by default. Profile read responses exclude the key. Key rotation preserves the previous usable key if replacement validation fails. |

The NearAI preset currently uses `https://cloud-stg-api.near.ai`. Model availability and verification support depend on its service and catalog. See the [privacy model](privacy.md) for the distinction between transport, execution, and verification claims.

### Active Model Set

Provider Profiles describe connections; model selection belongs to the Active Model Set. The setup form's model choice initializes one Provider/model target only when no targets are selected. Saving Provider edits does not replace an existing set. After setup, use the workspace's model controls to change targets.

An established Active Model Set contains one to four distinct Provider/model targets. The saved value `active_model_set: []` represents an unconfigured workspace with no selected targets; it cannot be used to send a message. One target produces an ordinary answer, and several produce a Model Comparison. A connection test can refresh a catalog after a denied or failed credential read.

## Workspace settings

Set generation parameters and appearance in **Settings → General**. The Local Service persists these settings in SQLite.

| Setting / contract field | Default | Accepted values and behavior |
| --- | --- | --- |
| Appearance / `theme` | `system` | `system`, `light`, or `dark`. |
| System Prompt / `system_prompt` | Empty | Up to 8,192 Unicode characters. Included in the saved generation configuration. |
| Temperature / `temperature` | Blank (`null`) | Finite number from `0` to `2`, inclusive. Blank omits the parameter and keeps the Provider default. |
| Top P / `top_p` | Blank (`null`) | Finite number from `0` to `1`, inclusive. Blank keeps the Provider default. |
| Max Tokens / `max_tokens` | Blank (`null`) | Positive integer, at least `1`. Blank keeps the Provider default; supported limits remain model-specific. |
| Active Model Set / `active_model_set` | `[]` (unconfigured) | One to four distinct `{provider_id, model_id}` targets once configured. The contract also accepts `[]` to represent no configured selection; sending requires at least one usable target. |
| Legacy locale / `locale` | `system` in persisted defaults | The contract retains `system`, `en`, `zh`, and `ja` for compatibility. The current interface uses English; this field does not enable translated UI. |

Provider/model support may be narrower than Cove's accepted parameter ranges. Configuration changes apply to new submissions. Retries retain their saved configuration and Context Snapshot; changing current settings does not rewrite earlier Generations.

See the [settings schema](../packages/api-contract/schemas/settings.schema.json), [shared types](../packages/api-contract/src/index.ts), and [settings validation](../services/local-service/internal/persistence/store.go) for implementation details.

## Appearance, Focus, and Launcher preferences

| Preference | Where to change it | Persistence |
| --- | --- | --- |
| Workspace skin | Settings → General → Workspace skin | Browser local storage for the Local Service address. Continuum is the default; Blueprint, Studio, and Grove are also available. |
| Focus | Four-corner button beside Model comparison | In-memory page state. Exit Focus or Escape restores the prior sidebar layout. |
| Timeline bookmarks | Bookmark button in a turn preview | Conversation/message identifiers in this browser profile and Local Service origin. Message bodies and excerpts are not copied into bookmark storage. |
| Launch at Login | Native Launcher menu | Managed through macOS login-item registration; enabling it may require system approval. |
| Control-Option-Space | Native Launcher menu | Optional global shortcut, off until enabled. Conflicts are reported by the Launcher. |

Browser preferences and bookmarks are not part of a database backup or conversation export. Clearing browser data removes them; using another browser profile or port uses separate storage. If browser storage is unavailable, skin and bookmark changes are session-only, and the bookmark preview reports that status. See the [user guide](user-guide.md#focus-and-timeline-bookmarks) for reading and navigation behavior.

## Local storage

| Data | Default location |
| --- | --- |
| History, settings, original attachments, and extracted source snapshots | `~/Library/Application Support/cove/cove.sqlite` |
| Provider Keys | macOS Keychain, service `io.github.tokenfunplus.cove.provider` |
| Source-build process state and logs | `.artifacts/` in the checkout; treat these files as sensitive. |
| Skin and timeline bookmark preferences | Browser storage for the Local Service address. |

Quit Cove before backing up its data directory. The database and exported conversations are not encrypted by Cove, and a database backup does not include Keychain credentials or browser bookmarks.

## Development environment variables

These variables configure development commands or process startup, rather than the Provider's generation parameters. Stop a running source service with `make stop-local` before changing its data directory or Secret Store mode.

| Variable | Scope and default |
| --- | --- |
| `COVE_DATA_DIR` | Launcher/Local Service data directory override. Otherwise uses `~/Library/Application Support/cove/`. Changes the database and test file-store location; Keychain remains an operating-system store. |
| `COVE_INSECURE_FILE_SECRET_STORE` | `make start-local` and package fixtures accept `0` (default, Keychain) or `1` (explicit plaintext test store). With `1`, disposable Provider Keys are written to `insecure-test-provider-secrets.json` with owner-only permissions. Distributable release mode rejects it. |
| `COVE_SIGNING_IDENTITY` | Local service signing and macOS packaging. Without an explicit value, the local-service build selects a single valid Developer ID identity, then a single Apple Development identity, or falls back to ad-hoc signing when no certificate is available. `-` explicitly requests ad-hoc fixture signing. Multiple candidates require an explicit identity. |
| `COVE_GO_VERSION` | Used only by the `goenv` fallback in `scripts/go`; defaults to `1.26.5`. A working Go on `PATH`, then Homebrew Go, takes precedence. |
| `MACOSX_DEPLOYMENT_TARGET` | Go wrapper's macOS deployment target; defaults to `13.0`. Packaging aligns the target with the app's advertised minimum OS. |

For an isolated development database, stop any source service first, then run:

```sh
make stop-local
COVE_DATA_DIR="$(mktemp -d)" make start-local
```

Run `make stop-local` separately when the development session ends.

For integration checks, also explicitly opt into the test file store with disposable credentials when needed. Do not point tests at personal history. Runtime launch/control tokens are managed by the Launcher and development scripts; keep their URLs and state files out of documentation and shared diagnostics.

### Local Service command-line options

The Launcher and `make start-local` manage authenticated startup. These flags are intended for maintainers and isolated fixtures; changing a port does not expose a public network service.

| Flag | Default and meaning |
| --- | --- |
| `--data-dir` | Uses `COVE_DATA_DIR` when set, otherwise the application data directory. |
| `--port` | Preferred loopback port `19421`. |
| `--port-range-start` / `--port-range-end` | Inclusive recovery range `19421` through `19521`, tried after a preferred-port conflict. |
| `--insecure-file-secret-store` | Off by default. Explicitly enables the plaintext fixture store when invoking the service directly. |

The service binds to IPv4 loopback (`127.0.0.1`). Use the actual URL opened by the Launcher; port conflicts can change it. The direct executable also requires a Launcher-managed control token. Source: [entry point](../services/local-service/cmd/cove-local-service/main.go) and [listener defaults](../services/local-service/internal/runtime/listener.go).

## Packaging and release options

| Variable | Purpose |
| --- | --- |
| `COVE_PACKAGE_DIR` | Package output directory; defaults to `.artifacts/`. |
| `COVE_SIGNING_IDENTITY` | Certificate name or fingerprint used to sign a package. |
| `COVE_RELEASE=1` | Enables distributable-package checks in `scripts/package-macos.sh`; requires certificate signing, notarization, and Keychain mode. Defaults to `0`. |
| `COVE_NOTARIZE=1` | Requests notarization during the local packaging flow. Requires a signing identity and a configured Notary profile. Defaults to `0`. |
| `COVE_NOTARY_PROFILE` | Name of credentials already saved in the local Keychain. Enter credentials through the secure tool prompt, rather than a tracked file. |
| `COVE_REQUIRE_NOTARIZATION` | GitHub repository Actions variable, default `0`, controlling CI signing/notarization. This is separate from local runtime settings. |

Follow [releasing](releasing.md) for the complete app/DMG signing, notarization, signature verification, and publication flow, including finishing a CI-built app locally without full Xcode.

## Local HTTP contracts

The Chat Surface keeps its Browser Session in per-tab, origin-scoped storage and uses a request header for Local Service APIs. Mutations also require the CSRF token and matching origin. Reopen Chat from the Launcher after an upgrade or service restart. Treat these as version-coupled application interfaces when developing integrations.

- [Shared TypeScript contract](../packages/api-contract/src/index.ts): Provider Profiles, workspace settings, Generations, and conversations.
- [Settings schema](../packages/api-contract/schemas/settings.schema.json) and [Provider Profile schema](../packages/api-contract/schemas/provider-profile.schema.json): machine-readable read models.
- [API route registration](../services/local-service/internal/api/server.go): supported HTTP methods and paths.
- [Browser HTTP client](../apps/web/src/api/client.ts): session handling and request/error adaptation.
- [Architecture](architecture.md): ownership and lifecycle boundaries.
