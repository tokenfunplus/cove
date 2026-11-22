# ADR 0055: Add managed local speech and answer reading

- Status: Accepted
- Date: 2026-11-22
- Extends: ADR 0048 and ADR 0053
- Supersedes: ADR 0047/0051's explore-only status for the two Kokoro entries

## Decision

Treat speech synthesis as a local processing tool, independently of the selected chat Provider. Offer five pinned, verified installations in On this Mac > Discover: Kokoro v1.0 English, Kokoro v1.1 Chinese, Kitten Nano 0.8 INT8, MeloTTS Chinese/English, and Pocket TTS 18M preset voices. Pocket uses the public without-voice-cloning variant and requires no model-hub token or account.

Speech owns installation coordination, validated preferences, temporary synthesis jobs, and private worker processes. Persistence owns multi-file bundles, archive extraction, SQLite preferences, and temporary audio. Chat resolves saved assistant bodies and explicit text selections; HTTP only adapts authenticated requests. Speech does not become a chat Provider and does not share its secrets or hidden reasoning.

Schema 27 adds an independent speech settings row. Automatic selection supports English and Chinese preferences; manual selection and per-model voice/speed controls are also available. Only options supported by the fixed adapters are exposed. Existing chat history and model selection are preserved.

Use pinned sherpa-onnx 1.12.40 for Kokoro/Melo, 2.0.3 with a source-built ARM64 eSpeak NG 1.52.0 phonemizer for Kitten 0.8, and the official Pocket TTS 4.0.1 ARM64 CLI. Both sherpa adapters use pinned ONNX Runtime 1.28.2: the older bundled ONNX binary requires macOS 15.5. The build checks the deployment target of every shipped worker/library. Keep workers in separate processes with local paths, private pipes, sanitized environments, and no cloud fallback. macOS 13.3+ on Apple Silicon is the initial supported platform. The IPC adapter and combined eSpeak worker retain GPL-3.0-or-later notices and source/build information; other components retain their licenses.

## Lifecycle and limits

One reading is active across the service. A new reading replaces the previous one. Audio belongs to its browser session and is served through authenticated, non-cacheable endpoints, then played as short WAV passages. Pause affects playback; Stop cancels synthesis and removes temporary audio. Navigation, model removal, chat deletion, clearing chat data, and service shutdown cancel relevant jobs. Completed audio expires after 30 minutes without access and is cleared on startup. WAV export is explicit.

Read saved assistant text, excluding code by default, Markdown syntax, image labels, link addresses, citation markers, and hidden reasoning. Accept up to 6,000 normalized characters per reading and 400 per preview, with a five-minute synthesis deadline, at most 128 passages, and 32 MiB of temporary audio per job. Long or unsupported passages return actionable errors. English-only models reject Chinese instead of silently pronouncing it incorrectly.

Downloads include voice and language files. Enforce declared byte counts and SHA-256 before extraction/publication; reject archive traversal, links, duplicates, excess files, and expanded sizes over 1 GiB. Recheck installed file integrity before synthesis. Model removal retains saved answers and voice preferences.

## Consequences

The runtime adds native binaries and licensing obligations to Mac packaging. Model download sizes are complete compressed bundles rather than bare network weights. First audio includes model initialization and verification; passages introduce small gaps. Pocket speed is applied during playback, so exported WAV uses its original pace. Quality varies by model and text; successful synthesis is not a language-quality benchmark.
