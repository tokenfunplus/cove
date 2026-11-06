# Cove

A local-first Mac chat app with on-device history and verifiable AI inference.

[![CI](https://github.com/tokenfunplus/cove/actions/workflows/ci.yml/badge.svg)](https://github.com/tokenfunplus/cove/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Cove keeps conversation history on your Mac and connects to the model providers you choose. A SwiftUI menu-bar Launcher starts a local Go service and opens the Chat Surface in your browser. There is no Cove account or cloud conversation store.

## Features

- Stream responses from OpenAI-compatible providers or the built-in NearAI preset.
- Compare up to four models in one turn; select the answer used in later context.
- Inspect the provider, destination, configuration snapshot, and available verification evidence for each response.
- Use NearAI's browser-side encryption and attestation flow for supported private models.
- Search, pin, archive, rename, and export local conversations as Markdown or JSON.
- Configure a System Prompt, generation parameters, and light or dark appearance.
- Store provider credentials in macOS Keychain by default.

**Local-first describes storage, not model execution.** Prompts and selected conversation context are sent to your provider. Local history is not encrypted by Cove. HTTPS alone does not establish confidential computation, and verification capabilities vary by model. Read the [privacy and trust model](docs/privacy.md) before relying on a verification label.

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

The build produces `.artifacts/Cove.app`, `Cove-0.1.0-arm64.dmg`, and a SHA-256 checksum. Local builds are ad-hoc signed. Developer ID signing and notarization require your own Apple credentials; see [releasing](docs/releasing.md).

## Develop and contribute

```sh
make check  # repository conventions, TypeScript, Go formatting, and go vet
make test   # API contract, web, Go race tests, and Swift tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

| Resource | Purpose |
| --- | --- |
| [Development](docs/development.md) | Commands, prerequisites, and troubleshooting |
| [Architecture](docs/architecture.md) | Components, data flow, and invariants |
| [Privacy](docs/privacy.md) | Network destinations, credentials, and verification limits |
| [Releasing](docs/releasing.md) | Packaging, signing, updates, and GitHub releases |
| [Domain glossary](CONTEXT.md) | Shared terminology |
| [Architecture decisions](docs/adr/) | Design rationale and superseded decisions |
| [Changelog](CHANGELOG.md) | Release history |

## License

[MIT](LICENSE). Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
