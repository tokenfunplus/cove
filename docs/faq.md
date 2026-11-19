# FAQ and troubleshooting

For setup, start with the [quick start](../README.md#quick-start). For field values, defaults, storage, and environment variables, use the [configuration reference](configuration.md).

## Which Macs can run Cove?

Published beta packages support Apple Silicon Macs running macOS 13 or later. Intel Macs are not supported by the ARM64 package. The native Launcher starts a Local Service and opens the Chat Surface in your browser.

## Do I need a Cove account, and where do models run?

Cove has no account or cloud conversation store. Configure your own Provider connection and key. Provider access, pricing, and availability depend on that service.

History stays on your Mac. Prompts, selected context, and extracted attachment text go to the selected Provider; inference runs wherever that Provider operates. Verification support varies by model. Read the [privacy model](privacy.md) before relying on a verification label.

## Where are chats, keys, and bookmarks stored?

History, settings, and original attachments are stored in the local SQLite database. Provider Keys use macOS Keychain by default. Skins, timeline bookmark identifiers, favorite/recent model identifiers, saved model combinations, and manual cost rates are saved in browser storage for the Local Service address. Working drafts and undo history remain in window memory. See the [storage reference](configuration.md#local-storage).

The database is not encrypted by Cove. Quit Cove before backing it up, and protect exports like the original history. A database backup does not include Keychain credentials or browser preferences. Bookmarks stay in the browser profile and origin where they were saved. If browser storage is unavailable, the bookmark preview reports that changes are session-only.

## Why does macOS ask for Keychain access?

macOS can ask when Cove first reads an existing Provider Key or its signing identity changes. Use the password for the keychain named in the macOS dialog. Enter it only in the trusted macOS dialog, never in chat, an issue, or a configuration example.

Authorized reads are reused within the running Local Service. Source builds use a stable certificate-backed signing identity when available; changing identities or using repeated ad-hoc builds can require authorization again. See [local code signing](development.md#local-code-signing). After changing a stored key outside Cove, restart the service so it can use the new value.

## What if the Local Service is unavailable or the interface looks stale?

For an installed app, use **Open Chat** in the Launcher. If necessary, choose **Troubleshooting → Restart Local Service**, then reopen Chat. Restarting invalidates previous Browser Sessions.

For a source build:

```sh
make stop-local
make start-local
```

Startup rebuilds web assets before compiling the service and opens a fresh authenticated session. The UI is embedded in the executable; rebuilding only the frontend does not refresh an already-running service. Use the URL the Launcher opens, since a port conflict can select another loopback port.

## Why are models unavailable after granting Keychain access?

If Provider setup reports that local browser access is no longer valid, reopen Chat from the Launcher and use the new tab. This can happen after a Local Service restart or Browser Session expiry. The local authorization error does not mean the Provider rejected your API key, and the failed local request is not automatically retried.

Provider catalog errors do not automatically retry on browser focus or reconnect. Open **Settings → Provider settings** and use the explicit connection test after granting access. Check the endpoint, authentication method, Provider availability, and model catalog if the test still fails.

If you entered a new key, choose a model target for initial setup and click **Save Provider** after testing; a connection test alone does not save it. Provider Profiles describe connections, while model targets belong to the Active Model Set. Setup initializes that target only when no targets are selected. Saving Provider edits leaves an existing set unchanged; confirm or change its targets through the workspace's model controls.

The NearAI preset uses its staging service, so availability and verification capabilities depend on that service and model. See [Provider configuration](configuration.md#provider-profiles).

## Why does a formula still show LaTeX source?

Current source builds render inline `$...$` and `\(...\)`, and display `$$...$$` and `\[...\]`. During streaming, an unfinished expression stays readable until its closing delimiter arrives. Malformed, unsupported, or oversized expressions also retain source. Code spans, fenced code, escaped delimiters, and ordinary currency are excluded. Prefer `\(...\)` when dollar signs are ambiguous. Rendering uses bundled fonts and does not require a remote typesetting service.

Copy and export preserve the original LaTeX. The published Beta 4 package predates this feature; source changes require rebuilding and restarting the Local Service. See [reading mathematical notation](user-guide.md#read-mathematical-notation).

## Does the answer workbench change saved answers?

The workbench edits a window-local copy. It does not change the original saved answer, its verification evidence, or later Provider context. Model revisions are separate saved conversations and require explicit review and application. Copy or download the Working Draft before reloading; it is not persisted as a recoverable draft. See [the workbench guide](user-guide.md#edit-an-answer-in-the-workbench).

## Which files can I attach?

Attach up to four UTF-8 text, Markdown, code, or text-based PDF files per turn, each at most 4 MiB. Scanned-only PDFs need OCR first; encrypted, binary, empty, or oversized inputs are rejected. Extraction and total context limits also apply.

See the [file chat limits](user-guide.md#ask-about-files). Previews stay local until submission. Source citations navigate saved text; they do not independently verify that an answer is correct.

## How do I update a beta?

Download the current package from [GitHub Releases](https://github.com/tokenfunplus/cove/releases), quit the running Cove app, and replace it in Applications. Existing history and settings remain in the local data directory, and Provider Keys remain in Keychain.

**Check for Updates** follows the stable channel. In updated builds, choose **Check for Beta Updates…** to explicitly discover newer published beta, release-candidate, or stable versions and open their official release page. Stable users are never offered a prerelease through the stable action. If a channel has no metadata or a request fails, the dialog offers **Open Releases**. Older builds without the beta action can use [GitHub Releases](https://github.com/tokenfunplus/cove/releases) directly. See [install and upgrade](user-guide.md#install-and-upgrade).

## Can I change the interface language?

The interface currently uses English. Messages, prompts, and conversation titles support Unicode, including non-English content. Legacy locale fields do not enable translated UI.

## Where can I get help?

Use [GitHub Issues](https://github.com/tokenfunplus/cove/issues) for reproducible bugs or the [Cove Discord community](https://discord.gg/7jdddhG8ZG) for setup discussion. Include the app version, macOS version, and minimal reproduction steps. Remove keys, launch URLs, and private content from diagnostics. Report vulnerabilities through [SECURITY.md](../SECURITY.md).
