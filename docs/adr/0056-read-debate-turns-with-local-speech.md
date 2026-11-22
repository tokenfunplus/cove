# ADR 0056: Read Debate participant turns with local speech

- Status: Accepted
- Date: 2026-11-22
- Extends: ADR 0037, ADR 0041, and ADR 0055

## Decision

Place an opt-in sound toggle beside Debate's run controls in both regular and Focus layouts. It is window-local and defaults to Off on navigation or reload. Enabling checks the saved speech configuration and installed runtime. Missing or uninstalled configured voices lead to Discover or Speech settings without changing the Debate, intervention draft, or chat model. Downloading a model does not enable automatic reading.

Read participant turns that finish after activation, including turns already streaming when activated. Do not replay settled history. Independent opening seats may settle out of order, so wait for earlier turn sequences and read one complete turn at a time. Failed/stopped attempts and structured stage summaries remain silent. Read saved public bodies only; hidden reasoning and unverified/partial browser responses cannot enter synthesis. The shared speech preferences continue to own voice, English/Chinese selection, speed, volume, CPU usage, and code inclusion.

The browser coordinates playback, not generation. It follows the live session independently of transcript pagination, and loads missing sequence pages if playback falls behind. The audio player identifies the round, model, and role, and the toggle displays its waiting or queued state. Playback pause holds its place while bounded synthesis and Debate generation may continue. Debate Pause controls generation independently. A browser autoplay restriction leaves an explicit Resume action.

Turning the sound toggle off, stopping Debate, leaving its view, closing/stopping the shared player, or starting another reading cancels automatic playback and drops its pending sequence. Late synthesis admissions are canceled by their returned job ID. Runtime, language, audio, or source errors turn automatic reading off and retain actionable details; there is no automatic retry loop or cloud fallback. Re-enabling starts at the current live boundary, rather than replaying a discarded backlog.

## Boundaries and compatibility

Add an authenticated, CSRF-protected `POST /api/speech/debate` command accepting only a Debate ID and turn ID. Chat resolves the settled original under the generation/data-change lock, validates that it is a completed participant turn, and delegates to the existing session-owned speech pipeline. HTTP remains an adapter. Persistence and schema 27 are unchanged; no autoplay preference, queued content, or audio is added to Debate history. Existing speech limits, ownership, deletion, and export rules remain in effect.

This extends ADR 0055's saved-answer source support to Debate turns. It does not pace model calls against speech duration, assign synthetic speaker identities, or change the service-owned Debate lifecycle.
