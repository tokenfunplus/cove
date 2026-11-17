# README screenshot captures

| File | Content and source |
| --- | --- |
| `model-comparison.webp` | The actual Cove 0.1.0-beta.3 Chat Surface, captured at a 1440 × 1080 viewport from the CI-built Local Service at release commit `23503cd`. Two simulated models reply to a synthetic prompt, with Atlas selected for the next turn. |
| `focus-mode.webp` | The actual Focus layout and timeline preview from UI commit `22441b6`, included in Beta 3. Reused from the product website's Beta 3 capture set. |
| `answer-workbench.png` | Unreleased source build, 2026-11-18, 1440 × 900: review a proposed selected-passage revision before applying it to a Working Draft. |
| `response-details.png` | The same production browser fixture: observed timing, reported usage, and immutable Provider/Privacy details in one dialog. |
| `chat-math.png` | The same source build: locally typeset fluid-mechanics equations, aligned matrix notation, and a long scrolling expression. |
| `model-filters.png` | The same source build: themed minimum-context options nested inside the model filter popover. |

Atlas and Lumen are demo model names. These captures use an isolated temporary data directory and a loopback simulated Provider with disposable credentials. They contain no personal conversation history or real Provider Keys. The displayed transport/verification state belongs to that fixture and does not demonstrate real Provider verification.

When refreshing screenshots, capture the implemented application with synthetic content. Keep the source version and image descriptions current, use temporary `COVE_DATA_DIR` storage, and explicitly opt into the test file Secret Store when disposable credentials are needed. Do not capture a personal workspace or include browser launch URLs.

The 2026-11-18 captures come directly from `apps/web/e2e/acceptance.mjs` in this change. The model names and responses are synthetic; the loopback Provider reports fixed token counts for the performance example. Neither the displayed metrics nor the fixture's transport labels establish live Provider performance or verification. The screenshots are original production-browser captures, not rendered mockups.
