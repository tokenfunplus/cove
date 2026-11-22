# Local speech

Open Settings > On this Mac > Discover and choose **Speak text**. Download and install a model, then open **Speech settings**. No command line, Python environment, Provider Key, or Hugging Face login is required. The bundled workers currently support Apple Silicon with macOS 13.3 or later.

| Model | Complete download | Language | Preset voices |
| --- | ---: | --- | ---: |
| Kokoro 82M v1.0 | 132.4 MB | English | 28 |
| Kokoro 82M v1.1 | 147.1 MB | Chinese and English | 103 |
| Kitten TTS Nano 0.8 INT8 | 31.2 MB | English | 8 |
| MeloTTS | 167.0 MB | Chinese and English | 1 |
| Pocket TTS 18M | 125.4 MB | English | 3 |

Sizes include the selected compressed package, supporting data, and voice states. Expanded installation and the bundled runtime need additional disk space. The exact URLs, revisions, file lengths, and SHA-256 values are in `services/local-service/internal/speech/models.json`; four packages come from sherpa-onnx's public `tts-models` release, while Pocket comes from Kyutai's pinned public `pocket-tts-without-voice-cloning` repository. Pocket includes Alba, Anna, and Bill Boerst, without voice cloning. Each model keeps its own license.

Automatic mode selects an installed English or Chinese model. You can override either language or choose a single manual model. Each model retains its own voice and speed. Melo exposes voice variation; Pocket exposes sampling temperature. Volume, CPU threads, and code inclusion are shared preferences. Use Preview voice to try unsaved voice options; save preferences before reading an answer. Selecting a speech model does not change the chat model.

The sound icon below each saved assistant answer reads its visible body. Selecting text also offers a reading action. Code is skipped unless enabled; reasoning, citation markers, formatting, images, and link addresses are not read. Missing models open a prompt linking directly to speech models in Discover and preserve the unsent draft. Unsupported language, excessive length, failed downloads, and runtime problems are reported in the interface.

Playback supports Pause, Resume, Stop, and Download audio. Starting another reading replaces the current one. Closing its player, changing conversation, removing its model, or deleting its chat stops the reading. A pause holds playback while bounded synthesis may continue. Export becomes available when all audio is ready. Pocket's playback speed does not change the exported WAV. Long readings are limited to 6,000 normalized characters, 128 passages, five minutes of synthesis, and 32 MiB of audio; select a shorter passage if a limit is reached.

Text and audio stay on this Mac during synthesis. Only installation contacts public model sources. Workers receive no Provider Keys or model-hub credentials. Temporary audio is private to the browser session, expires after 30 minutes without access, and is removed on service startup. Exported files remain wherever the user saves them. Removing a model keeps answers and preferences.

## Debate read aloud

Debate's sound toggle beside Pause and Stop automatically reads new completed participant turns. It starts Off for each opened Debate view. Turning it on includes turns currently streaming and future turns, while settled history, failed attempts, reasoning, and stage summaries stay silent. Concurrent openings play in turn order; only one voice plays at a time. The player identifies the round, model, and role and uses your saved speech preferences.

Pause in the audio player holds playback; Debate Pause controls model generation separately. Generation can get ahead of listening, so a queued count appears beside the sound toggle. Turning it off, stopping Debate, leaving the view, or stopping/replacing the reading discards the pending queue. Re-enable to listen from the current live boundary. Missing voices lead to Discover or Speech settings; installation never silently turns on audio. A browser autoplay restriction offers Resume. Reading errors disable automatic playback until you enable it again. See [ADR 0056](adr/0056-read-debate-turns-with-local-speech.md).

## Development and verification

`make build-service` builds web assets and prepares both inference and speech workers. `node scripts/prepare-speech-runtime.mjs` pins all downloads and builds the adapter/Kitten ARM64 phonemizer under ignored `.artifacts/speech`. This needs Apple's command line tools and initial network access. Both sherpa adapters use ONNX Runtime 1.28.2; preparation rejects worker/library deployment targets above macOS 13.3. `COVE_SPEECH_RUNTIME` can override this directory in development. Distributed services resolve `speech` next to their executable.

Run the speech, persistence, Chat, API, and web tests plus `make check`. Native acceptance is opt-in with `COVE_TEST_LOCAL_SPEECH=1`, `COVE_TEST_SPEECH_ASSETS` pointing to the verified upstream package cache, and `COVE_SPEECH_RUNTIME` pointing to prepared workers. Optional `COVE_TEST_SPEECH_MODEL` selects one model; `COVE_TEST_SPEECH_OUTPUT` writes synthetic example WAVs. Use a temporary `COVE_DATA_DIR`. The native check verifies actual non-silent WAV output, session isolation, export, and prompt worker cancellation; it does not establish pronunciation quality across languages.

Packaging copies only runtime binaries, libraries, notices, licenses, and source/build information, then signs each nested binary. Download archives and build tools are not runtime dependencies. See [ADR 0055](adr/0055-add-managed-local-speech-and-answer-reading.md) and the native notices in `scripts/native/SPEECH_NOTICES.md`.
