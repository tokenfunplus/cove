# Third-party notices

Cove's MIT license applies to this repository's code. Dependencies, toolchains, and platform components retain their own licenses and notices.

The JavaScript dependency graph is recorded in `pnpm-lock.yaml`; the Go dependency graph is recorded in `services/local-service/go.mod` and `go.sum`. Builds collect installed JavaScript production dependency license texts into the web assets. macOS packaging also includes Go module notices and the Go standard library license in `Contents/Resources/THIRD_PARTY_LICENSES.txt`. Review the resolved packages' licenses before redistribution. This document is a navigation aid, not a replacement for those license texts.

Major components include React, Headless UI, Lucide, Tailwind CSS, Vite, TypeScript, Vitest, the NearAI inference SDK and its cryptographic dependencies, modernc.org/sqlite, and Keybase's Go Keychain adapter. The NearAI SDK and transitive cryptographic packages are bundled into the Chat Surface; preserve generated license notices when distributing it.

Formula rendering bundles [KaTeX](https://katex.org/) 0.19.1, its stylesheet, and fonts (MIT, Khan Academy and other contributors). Its installed license is included by the production dependency notice collector.

Model brand SVGs are selected assets from [LobeHub Icons](https://github.com/lobehub/lobe-icons), pinned to `@lobehub/icons-static-svg@1.103.0` (MIT, Copyright 2023 LobeHub). Their license is retained in `apps/web/public/assets/model-icons/LICENSE.txt` and included by the notice collector. Logos identify model brands and do not imply endorsement.

Local PDF text extraction uses `github.com/ledongthuc/pdf` (BSD-3-Clause), derived from `rsc/pdf`. Its pinned revision is recorded in `go.mod` and its license is included by the macOS package's Go notice collector.

Webpage text extraction uses `codeberg.org/readeck/go-readability/v2` (MIT), with HTML and character-encoding support from `golang.org/x/net` and `golang.org/x/text` (BSD-3-Clause). Resolved versions and transitive dependencies are recorded in the Go module files and included by the Go notice collector.

Native inference bundles the official ARM64 [llama.cpp b12606](https://github.com/ggml-org/llama.cpp/releases/tag/b12606) runtime (MIT). The archive URL and SHA-256 are pinned in `scripts/prepare-inference-runtime.mjs`; packaging retains its license in `Contents/Resources/inference/LICENSE` and signs the executable and libraries.

Model weights are downloaded separately rather than included in the app. The managed BGE Small Chinese v1.5 Q8_0 conversion is published by CompendiumLabs from BAAI's MIT-licensed model; Qwen2.5 0.5B Instruct Q4_K_M is published by Qwen under Apache-2.0. Exact immutable revisions, files, sizes, and hashes are recorded in `services/local-service/internal/localmodels/models.go`; the discovery cards link to publisher and conversion notices.

The optional Qwen3 0.6B Abliterated Q5_K_M GGUF is published by [mlabonne](https://huggingface.co/mlabonne/Qwen3-0.6B-abliterated-GGUF), derived from Qwen3 0.6B, and declares Apache-2.0. It is downloaded separately with its own pinned revision and SHA-256.

Cove continues the supplied Secure Chat / TBD codebase. Historical architecture decisions retain references to the TeamPulse architecture that informed the original Launcher design.

## Local speech

The separately invoked speech adapters and runtimes include sherpa-onnx (Apache-2.0), ONNX Runtime (MIT), Pocket TTS (MIT), and eSpeak NG (GPL-3.0-or-later). Cove's combined speech IPC adapter is GPL-3.0-or-later as identified in its source; the remaining Cove application retains its existing license. Native packages retain the GPL text, source/build references, and eSpeak source. Model licenses are separate: Kokoro/Kitten Apache-2.0, Melo MIT, and Pocket preset weights CC-BY-4.0. See [speech notices](scripts/native/SPEECH_NOTICES.md) and [local speech](docs/local-speech.md).
