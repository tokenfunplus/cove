<img width="640" height="213" alt="Cove" src="https://github.com/user-attachments/assets/ab557daf-f379-4a30-9d9a-a105ebb94081" />

# Cove

A local-first Mac chat app with on-device history and verifiable AI inference.

[![CI](https://github.com/tokenfunplus/cove/actions/workflows/ci.yml/badge.svg)](https://github.com/tokenfunplus/cove/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/tokenfunplus/cove/badge)](https://scorecard.dev/viewer/?uri=github.com/tokenfunplus/cove)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/7jdddhG8ZG)

Cove keeps conversation history on your Mac and connects to the model providers you choose. A SwiftUI menu-bar Launcher starts a local Go service and opens the Chat Surface in your browser. There is no Cove account or cloud conversation store.

Choose a workspace skin in **Settings → General → Workspace skin**. Continuum uses warm neutrals and blue, Blueprint uses a compact technical grid, and Studio pairs violet surfaces with serif headings. Grove keeps the original forest palette. Each skin supports the existing Light, Dark, and System modes. Cove remembers your skin in this browser for the Local Service address.

## Features

- Stream responses from OpenAI-compatible providers or the built-in NearAI preset.
- Compare up to four models in one turn; select the answer used in later context.
- Attach text, Markdown, code, and text-based PDF files; preview extracted text, inspect Provider context, and open cited source lines or pages. File chat supports four files per turn, up to 4 MiB each; scanned PDFs need OCR first.
- Inspect the provider, destination, configuration snapshot, and available verification evidence for each response.
- Use NearAI's browser-side encryption and attestation flow for supported private models.
- Search, pin, archive, rename, and export local conversations as Markdown or JSON.
- Configure a System Prompt, generation parameters, and light or dark appearance.
- Store provider credentials in macOS Keychain by default.

**Local-first describes storage, not model execution.** Prompts and selected conversation context are sent to your provider. Local history is not encrypted by Cove. HTTPS alone does not establish confidential computation, and verification capabilities vary by model. Read the [privacy and trust model](docs/privacy.md) before relying on a verification label.

## Install the beta

Download [Cove 0.1.0-beta.2](https://github.com/tokenfunplus/cove/releases/tag/v0.1.0-beta.2) for Apple Silicon Macs running macOS 13 or later. Open the DMG, drag Cove to Applications, and launch it from there. The beta package is Developer ID signed and Apple notarized; a SHA-256 checksum is included with the download.

Beta 2 adds file chat with source previews and citations, reduces repeated Keychain authorization dialogs, improves Provider failure explanations, and introduces Cove's wave branding. Existing Cove history and settings are retained when upgrading.

See the [product website](https://tokenfunplus.github.io/cove/), [user guide](docs/user-guide.md), and [beta release notes](docs/releases/0.1.0-beta.2.md) for setup and current limitations. The interface is English; messages, titles, and prompts support Unicode content.

## Run from source

You need an Apple Silicon Mac running macOS 13+, Xcode Command Line Tools with Swift 5.10+, Node.js 24.22.1+, pnpm 10.11, Go 1.26+, and `make`.

```sh
git clone https://github.com/tokenfunplus/cove.git
cd cove
pnpm install --frozen-lockfile
make start-local
```

Open **Settings → Provider Profiles**, add a provider key, test the connection, and choose a model. The NearAI preset currently uses the staging endpoint `https://cloud-stg-api.near.ai`; its availability and model catalog depend on that service. A custom provider endpoint must use HTTPS or loopback HTTP.

```sh
make stop-local
```

The Launcher and packaged app are macOS-only. Web, API contract, and Go checks can also run on Linux; see [development](docs/development.md).

## Build a Mac app

```sh
make dmg
```

The build produces `.artifacts/Cove.app`, `Cove-0.1.0-beta.2-arm64.dmg`, and a SHA-256 checksum. App packages are ad-hoc signed unless `COVE_SIGNING_IDENTITY` is configured. Developer ID signing and notarization require your own Apple credentials; see [releasing](docs/releasing.md), including how to sign a CI-built app without full Xcode locally.

## Community

Join the [Cove Discord community](https://discord.gg/7jdddhG8ZG) for setup help, provider discussions, feedback, and contributor coordination. Start in `#welcome` and read `#rules`; use `#support` for troubleshooting, `#ideas` for feature discussions, and `#development` to coordinate contributions. Release news appears in `#announcements`.

Keep reproducible bug reports and actionable work in [GitHub issues](https://github.com/tokenfunplus/cove/issues) and [pull requests](https://github.com/tokenfunplus/cove/pulls). Report vulnerabilities privately through [SECURITY.md](SECURITY.md). Never post Provider Keys, launch tokens, or private conversation data.

## Develop and contribute

```sh
make check  # repository conventions, TypeScript, Go formatting, and go vet
make test   # API contract, web, Go race tests, and Swift tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

| Resource | Purpose |
| --- | --- |
| [User guide](docs/user-guide.md) | Installation, Providers, file chat, comparisons, and updates |
| [Development](docs/development.md) | Commands, prerequisites, and troubleshooting |
| [Architecture](docs/architecture.md) | Components, data flow, and invariants |
| [Privacy](docs/privacy.md) | Network destinations, credentials, and verification limits |
| [Releasing](docs/releasing.md) | Packaging, signing, updates, and GitHub releases |
| [Domain glossary](CONTEXT.md) | Shared terminology |
| [Architecture decisions](docs/adr/) | Design rationale and superseded decisions |
| [Changelog](CHANGELOG.md) | Release history |

## License

[MIT](LICENSE). Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
