# README screenshot captures

| File | Content and source |
| --- | --- |
| `cove-quick-panel-compact.png` | Quick Panel source build, 2026-11-24, 1240 × 360. The native window opens at its compact size with the composer focused. |
| `cove-quick-panel-answer.png` | The same AppKit and WebKit fixture at 1240 × 1304. The window grows to show the synthetic prompt, reply, and browser handoff. |
| `local-search-filter-desktop.png` | Local capability recovery source build, 2026-11-23, 1440 × 900: explicit document scope and user-selected similarity controls in a disposable production-browser fixture. |
| `local-search-filter-mobile-dark.png` | The same fixture at 390 × 844 in dark mode; the document dialog scrolls within the viewport. |
| `local-document-search-results.png` | Local document search source build, 2026-11-24, 1636 × 1620. A disposable browser fixture shows compact synthetic Chinese PDF excerpts, page references, and the fixed selection actions. |
| `model-comparison.webp` | The actual Cove 0.1.0-beta.3 Chat Surface, captured at a 1440 × 1080 viewport from the CI-built Local Service at release commit `23503cd`. Two simulated models reply to a synthetic prompt, with Atlas selected for the next turn. |
| `focus-mode.webp` | The actual Focus layout and timeline preview from UI commit `22441b6`, included in Beta 3. Reused from the product website's Beta 3 capture set. |
| `answer-workbench.png` | Unreleased source build, 2026-11-18, 1440 × 900: review a proposed selected-passage revision before applying it to a Working Draft. |
| `response-details.png` | The same production browser fixture: observed timing, reported usage, and immutable Provider/Privacy details in one dialog. |
| `chat-math.png` | The same source build: locally typeset fluid-mechanics equations, aligned matrix notation, and a long scrolling expression. |
| `model-filters.png` | The same source build: themed minimum-context options nested inside the model filter popover. |
| `web-search-settings.png` | Cove 0.1.0-beta.8 release preparation at `6052c1b`, 2026-11-21, 1440 × 900: search connection, per-model limits, and folded advanced settings. |
| `web-search-composer.png` | The same isolated production build: compact source/context actions and the Web search globe in the composer. |
| `web-search-mobile-dark.png` | The same fixture at 390 × 844: dark-mode advanced search controls inside Settings. |
| `local-speech-discover.jpg` | Unreleased local-capabilities source build, 2026-11-22: Discover filtered to Speak text, with five managed speech downloads. |
| `local-speech-settings.jpg` | The same isolated build: automatic English/Chinese selection, per-model voice preferences, and the missing-model download prompt. |
| `custom-controls-dark.jpg` | Shared custom-control source build, 2026-11-22: the speech model menu in dark mode, from an empty temporary workspace. |
| `custom-controls-mobile-dark.jpg` | The same disposable fixture in a narrow viewport: custom model selection, searchable voices, and the speech slider. |
| `debate-read-aloud.jpg` | Debate speech source build, 2026-11-22: ordered local reading paused on Lumen with Atlas queued, using synthetic stored turns. |
| `debate-read-aloud-narrow-dark.jpg` | The same temporary fixture in narrow dark Focus mode, showing the sound toggle and paused Atlas reading. |
| `debate-missing-voice.jpg` | The same fixture with an uninstalled manual voice selected, showing direct Discover and Speech settings guidance. |

Atlas and Lumen are demo model names. These captures use an isolated temporary data directory and a loopback simulated Provider with disposable credentials. They contain no personal conversation history or real Provider Keys. The displayed transport/verification state belongs to that fixture and does not demonstrate real Provider verification.

When refreshing screenshots, capture the implemented application with synthetic content. Keep the source version and image descriptions current, use temporary `COVE_DATA_DIR` storage, and explicitly opt into the test file Secret Store when disposable credentials are needed. Do not capture a personal workspace or include browser launch URLs.

The 2026-11-18 captures come directly from `apps/web/e2e/acceptance.mjs` in this change. The model names and responses are synthetic; the loopback Provider reports fixed token counts for the performance example. Neither the displayed metrics nor the fixture's transport labels establish live Provider performance or verification. The screenshots are original production-browser captures, not rendered mockups.

The Beta 8 captures come from the `web-search` scenario in `apps/web/e2e/acceptance.mjs`. It uses only synthetic prompts, a loopback model Provider, and a disposable source/key fixture. No live search service or personal workspace was captured.

The local-speech captures use a fresh, empty temporary `COVE_DATA_DIR` and the explicitly enabled test file Secret Store. They contain no conversations, copied preferences, or credentials; all models are uninstalled. Model metadata and controls come from the implemented service. Real native synthesis, download, and deletion checks are recorded separately in [Local speech](../local-speech.md).

The custom-control captures use an empty temporary data directory with dark mode configured only in that fixture. No everyday appearance preferences, model files, conversation records, or credentials were copied. Keyboard, nested disclosure, empty selection, and voice search behavior also have component regression coverage.

The Debate speech captures use synthetic paused Debate sessions in temporary storage. No Provider request was made. Existing Kitten bundle files were hard-linked into that disposable fixture for real native synthesis; everyday preferences, conversations, credentials, and model selections were not copied. The audio player advanced from Lumen to Atlas, paused/resumed successfully, and stopped with Debate. Missing-model navigation retained the intervention draft.

The local-search filter captures come from the `local-capabilities` scenario in `apps/web/e2e/acceptance.mjs`. They use an empty temporary workspace with no installed models or personal documents. They establish layout and control behavior, not native retrieval quality.
