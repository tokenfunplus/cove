# Third-party notices

Cove's MIT license applies to this repository's code. Dependencies, toolchains, and platform components retain their own licenses and notices.

The JavaScript dependency graph is recorded in `pnpm-lock.yaml`; the Go dependency graph is recorded in `services/local-service/go.mod` and `go.sum`. Builds collect installed JavaScript production dependency license texts into the web assets. macOS packaging also includes Go module notices and the Go standard library license in `Contents/Resources/THIRD_PARTY_LICENSES.txt`. Review the resolved packages' licenses before redistribution. This document is a navigation aid, not a replacement for those license texts.

Major components include React, Headless UI, Lucide, Tailwind CSS, Vite, TypeScript, Vitest, the NearAI inference SDK and its cryptographic dependencies, modernc.org/sqlite, and Keybase's Go Keychain adapter. The NearAI SDK and transitive cryptographic packages are bundled into the Chat Surface; preserve generated license notices when distributing it.

Formula rendering bundles [KaTeX](https://katex.org/) 0.19.1, its stylesheet, and fonts (MIT, Khan Academy and other contributors). Its installed license is included by the production dependency notice collector.

Model brand SVGs are selected assets from [LobeHub Icons](https://github.com/lobehub/lobe-icons), pinned to `@lobehub/icons-static-svg@1.103.0` (MIT, Copyright 2023 LobeHub). Their license is retained in `apps/web/public/assets/model-icons/LICENSE.txt` and included by the notice collector. Logos identify model brands and do not imply endorsement.

Local PDF text extraction uses `github.com/ledongthuc/pdf` (BSD-3-Clause), derived from `rsc/pdf`. Its pinned revision is recorded in `go.mod` and its license is included by the macOS package's Go notice collector.

Cove continues the supplied Secure Chat / TBD codebase. Historical architecture decisions retain references to the TeamPulse architecture that informed the original Launcher design.
