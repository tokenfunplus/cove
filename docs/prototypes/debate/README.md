# Cove continuous debate prototypes

The Workspace direction is implemented in the application; see [Debate mode](../../debate.md) for the production controls and supported transports. The files below remain independent scripted design studies.

Open [the gallery](index.html), then choose [Workspace](workspace.html), [Roundtable](roundtable.html), or [Argument map](argument-map.html). Open the HTML files directly in a modern browser; keep `debate.css` and `debate.js` beside them. No installation, build, credentials, or network connection is required. Each page has an independent in-memory session; switching concepts resets that session.

These are interaction studies, not a production feature. They make no Provider calls, save no browser state, and do not modify Cove's Chat Surface, API, SQLite schema, or existing generation behavior. The initial topic, transcript, claim positions, usage, and costs are synthetic. A custom topic gets generic scripted role samples. Edited rules are versioned and displayed but do not make the scripted engine interpret arbitrary instructions. The argument map is a curated interaction example, not live claim extraction. No model versions, prices, or availability are asserted.

## What to try

1. Use **Set up debate** to enter a topic, select two to four model families, assign separate roles, choose a format, and edit the ground rules.
2. Start the debate. It advances through rounds without a configured final round. Consensus does not trigger completion.
3. Use **Pause** to finish the active turn and suspend scheduling. **Run one turn** advances once while paused. **Resume** restores continuous scheduling.
4. Queue an intervention, or challenge a turn/argument. The intervention becomes visible to every participant at the next round boundary. Up to eight pending interventions are supported.
5. Edit the ground rules during a discussion. A new version activates at the next round boundary. The topic and participants stay fixed within the session.
6. Inspect model seats, read the transcript, capture a checkpoint, or export the most recent completed turns as Markdown.
7. Use **Stop** to immediately cancel playback and prevent new work. The incomplete turn is discarded; completed turns and unapplied interventions remain reviewable. A new debate explicitly starts a separate session.
8. In Argument map, inspect nodes, filter disputed/shared claims, zoom, and challenge a selected claim. Narrow screens open argument details in a dialog.

The opening is played sequentially for legibility but omits cross-response references when blind opening is enabled. This demonstrates visibility policy rather than actual parallel model execution. Discussion format changes the protocol label; Stress test also displays rotating attacker/defender assignments. The demo does not evaluate argument quality or generate fresh answers.

The demo keeps scheduling while its page is open, including when the tab is hidden. Browsers may throttle background timers, so this does not implement reliable background execution. Closing or reloading the page ends the in-memory session. It keeps the most recent 96 displayed turns, 12 applied interventions, and 48 rule events in memory; an export is a bounded recent transcript rather than a complete archive. Production persistence and rolling context are separate concerns.

## Three interaction directions

| Direction | Main task | Strength | Trade-off |
| --- | --- | --- | --- |
| Workspace | Read and steer a conversation | Fits Cove's current Chat Surface; clear controls and familiar transcript | Long sessions need checkpoints and reading anchors |
| Roundtable | Follow who is speaking and why | Roles and speaking order become tangible | Spatial layout spends more space on presence and less on reading |
| Argument map | Follow a disagreement over time | Separates claims, challenges, evidence gaps, and shared ground | Needs reliable claim extraction with exact source links |

Recommended first implementation: Workspace as the primary surface, a live brief at the side, and Argument map as a later optional reading view over the same Debate Session. Roundtable is an exploratory presentation rather than a prerequisite.

## Proposed debate protocol

This is a proposal for review. It does not supersede any existing ADR.

- A **Debate Session** owns the topic, immutable participant seats, protocol versions, interventions, turn order, checkpoints, and explicit running/paused/stopped state. Two to four participants are enough for an initial scope. Model identity and debate role are separate settings.
- The first round uses blind independent openings. Production should run them concurrently against the same topic/rules and publish the set after all settle. No participant sees another opening while generating its own.
- Later rounds rotate the first speaker. Every round gives each participant one bounded turn; later speakers may reference earlier completed turns. A stress-test format rotates an attacking seat and gives the other seats the same attack before their independent defenses.
- Each turn identifies a claim it addresses, offers a response, distinguishes evidence from assumptions, records any revision, and names the next unresolved question. Link to completed public answer text; do not request or display private chain of thought.
- The scheduler continuously repeats challenge, evidence, and new-angle cycles. A checkpoint every few rounds captures provisional shared ground, dissent, evidence gaps, and next questions. It never ends the session for reaching agreement or a fixed round count.
- Detect repeated arguments and ask for a counterexample, boundary condition, alternative hypothesis, or testable prediction. Show a low-novelty notice and let the user choose whether to keep exploring. Avoid manufacturing disagreement just to keep the transcript active.
- Interventions and rule edits enter at a round boundary with explicit pending state. They become shared input for all participants. Retain the original rule/context version on every completed turn. A model or topic change starts a new session so provenance stays legible.
- Pause finishes active work and creates no next turn. Stop sets a terminal session state, cancels in-flight generations, and rejects late results before any further scheduling. A stopped session must not restart through reconnect or page refresh.
- There is no default round cap or consensus stop. Bounded turn tokens, request deadlines, rate-limit backoff, and context budgets still apply. An optional user-selected spend cap pauses at a clear checkpoint and requires an explicit resume/limit change. If rates are unavailable, show cost as unavailable. Never treat an estimate as a bill.
- A Provider failure cannot be counted as agreement. Offer retry or skip for an isolated failed seat and preserve its diagnostic separately. Pause when fewer than two viable participants remain. Do not silently replace a model.

## Long sessions and sources

Persist complete turns locally. Construct each next context from the original topic, effective rules, participant roles, recent completed turns, bounded interventions, a rolling brief, and source-linked open claims. Keep minority positions and exact quotations in the rolling record so summarization does not erase disagreement. Summaries must not become unchecked new evidence; each extracted claim needs a completed-turn reference, and each external factual claim needs an actual source or an explicit unverified label.

Show turn number, phase, participant, role, Provider Snapshot, rule version, observed token usage where available, and optional cost estimates. Show the last checkpoint separately from the live transcript. Agreement is a description of the discussion, not a calibrated probability or factual correctness score.

## Relationship to Cove

The current application permits one active Generation Batch, executes comparison Targets concurrently, and requires a Selected Answer for later comparison context. An autonomous debate cannot be implemented by automatically selecting one comparison answer or sending every comparison response through the existing ordinary-chat context.

Before implementing this feature, record a new ADR for Debate Session orchestration and an explicit debate context format. Preserve ordinary chat/comparison semantics from [ADR-0014](../../adr/0014-model-submissions-as-generation-batches.md) and [ADR-0015](../../adr/0015-use-a-selected-answer-for-comparison-context.md). Define how a session reserves the single active-work slot, how bounded turns relate to Batches, how cancellation/recovery works, and whether paused sessions release that slot. Do not allow multiple browser tabs to independently schedule the same next turn.

Follow [the architecture boundaries](../../architecture.md): the HTTP layer adapts commands and events, Chat owns the session state machine and generation scheduler, and persistence owns local durable records. Reuse command/event separation from [ADR-0011](../../adr/0011-separate-generation-command-and-event-stream.md) and bounded attempt lifetimes from [ADR-0022](../../adr/0022-bound-browser-generation-lifetimes.md). Ordinary Provider orchestration can live in Chat; browser-owned private inference still requires a present, authorized browser and must pause/recover explicitly when it disappears. Unbounded discussion must not imply an unbounded individual Generation or an unattended browser inference promise.

No production behavior is changed by these files, so this prototype does not add a decision to `docs/adr/`.

## Reference

[RoundTable's README](https://github.com/entropyvortex/roundtable) describes a blind opening, persona-specific seats, randomized order, multi-round critiques, and claim-level contradictions linked to quotations. Its CVP protocol uses configured rounds and optional convergence stopping. This proposal borrows those discussion controls and replaces the finite-run interaction with an explicitly controlled continuous session. It avoids interpreting model confidence or agreement as truth.

The prototype's visual design, sample discussion, and source code were created for Cove. It does not copy RoundTable implementation code or assets.
