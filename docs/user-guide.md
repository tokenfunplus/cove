# Using Cove

Cove is a local-first AI chat application for Apple Silicon Macs running macOS 13 or later. Its menu-bar Launcher starts a Local Service and opens the Chat Surface in your browser. The interface is English; messages, titles, and prompts support Unicode content.

## Install and upgrade

Download [0.1.0-beta.2](https://github.com/tokenfunplus/cove/releases/tag/v0.1.0-beta.2), open the DMG, and drag Cove to Applications. Published beta packages are Developer ID signed and Apple notarized. A checksum file accompanies each download.

For an upgrade, quit Cove from its menu-bar menu before replacing the app. Existing Cove history and settings remain in the local data directory. Provider Keys remain in macOS Keychain. The beta's Check for Updates action follows the stable channel; download beta updates from GitHub Releases.

## Connect a Provider

Open Settings, choose a Provider, configure its API key, test the connection, and choose a model. Custom Providers use OpenAI-compatible APIs and require HTTPS, except for loopback HTTP endpoints. The NearAI preset has a fixed staging endpoint; its availability and model catalog depend on that service.

macOS may request permission when Cove first reads an existing Provider Key or when its signing identity changes. Authorized keys are reused within the running Local Service. Catalog errors do not automatically retry on focus or reconnect. After granting access, use the explicit connection test to recover the catalog. Restart Cove after changing an existing key outside the running service.

## Chat and compare models

Choose one model for an ordinary conversation, or up to four targets for a comparison. Each answer retains its Provider Snapshot and available verification evidence. Select the answer you want to include in the next turn's context, or continue without an answer from that turn.

A submitted turn captures its context. Retrying a target uses that same saved context and attached source input. Later changes to an earlier answer selection do not rewrite a turn already submitted.

## Ask about files

Attach supported files in the composer, preview the extracted text, and inspect the draft Provider context before sending. Previews are local and do not contact a Provider or save a draft. Navigating away or reloading discards draft attachments.

| Limit | Supported value |
| --- | --- |
| Files per turn | Up to 4 |
| Original file size | Up to 4 MiB per file |
| Formats | UTF-8 text, Markdown, code, and text-based PDF |
| Extracted text | Up to 60,000 Unicode characters per file and 120,000 across attachments |
| Text lines | Up to 4,000 per text file |
| PDF pages | Up to 50 |
| Total application input | Up to 240,000 Unicode characters, including System Prompt and selected history |

Empty, binary, password-protected, scanned-only, unsupported, and oversized inputs are rejected. Run OCR outside Cove for scanned PDFs. These application limits are not token counts; a model can have a smaller context window.

On submission, Cove saves the original bytes and an immutable extracted-text snapshot with the turn. Providers receive extracted text through the selected transport. Comparisons, retries, and later selected context use the saved snapshot even if the original file changes on disk.

Open an answer's source citations to navigate saved lines or pages. Citations are navigation aids, not independent proof that a model's claim is correct. Original files can be downloaded from the saved source view. Conversation exports contain source text and metadata, but not original file bytes.

## Appearance and local data

Settings offers Continuum, Blueprint, Studio, and Grove workspace skins, with Light, Dark, and System appearance. Skin choice is saved in the browser for the Local Service address.

Search, pin, archive, rename, or export conversations from the workspace. History, settings, and attachments are stored under `~/Library/Application Support/cove/` in SQLite; Provider Keys use Keychain. Cove does not encrypt its local database or exports. Quit Cove before backing up its data directory, and protect backups like the original data. A database backup does not include Keychain credentials.

Deleting a conversation or clearing history removes its saved attachment records. It does not delete exported files, backups, or copies retained by a Provider. See the [privacy model](privacy.md) for storage, network destinations, and verification limits.

## Get help

Read the [beta release notes](releases/0.1.0-beta.2.md), use [GitHub Issues](https://github.com/tokenfunplus/cove/issues) for reproducible problems, or join the [Cove Discord community](https://discord.gg/7jdddhG8ZG) for setup discussion. Include the app and macOS versions in bug reports, and remove credentials, launch URLs, and private content from diagnostics.
