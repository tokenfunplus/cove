# Add service-owned continuous Debate Sessions

Cove adds Debate mode as a separate kind of locally saved conversation. A Debate Session owns its topic, two to four fixed Provider/model seats, roles, versioned ground rules, round cursor, interventions, checkpoints, and running/pausing/paused/stopped state. The Chat Surface uses the workspace concept from [the interaction study](../prototypes/debate/workspace.html).

## Lifecycle ownership

Chat owns the scheduler in the Local Service. A running or pausing debate reserves the same global active-work slot as an ordinary Generation Batch. Pause finishes active work and releases that slot; Resume reacquires it. The blind opening is a concurrent group. A later step runs one bounded turn; stepping an incomplete opening finishes its outstanding independent seats. Stop records a terminal session state before cancellation, waits for worker cleanup, and rejects late completion. A stopped session cannot resume. Navigating away or closing a browser does not cancel a service-driven debate.

This extends [ADR-0014](0014-model-submissions-as-generation-batches.md) to one active ordinary Batch **or** Debate Session. Ordinary comparisons and the Selected Answer rules in [ADR-0015](0015-use-a-selected-answer-for-comparison-context.md) retain their behavior. Debate turns are separate records; they cannot enter the ordinary message command or silently become Selected Answers.

Each request has the existing service timeout, an explicit output token limit, and a 256 KiB combined answer/reasoning size limit. There is no session round limit, automatic consensus stop, or automatic retry loop. A Provider error pauses the session; Resume retries the unfinished seat without repeating successful openings. Continuous operation makes ongoing Provider calls. The initial exclusion of browser-verified NearAI models is superseded by [ADR-0038](0038-support-browser-verified-nearai-debate-turns.md); no private transport is downgraded or bypassed.

Complete public answers and optional Provider-declared reasoning are saved separately. Partial streamed text stays in memory. Service shutdown cancels active work and saves a resumable paused session. Startup recovery pauses interrupted sessions and fails incomplete turns. Neither startup nor reconnect starts inference without an explicit user command.

## Protocol and context

First-round openings use independent contexts concurrently. Subsequent turns rotate the first seat when configured. The protocol cycles through challenges, evidence checks, and new angles without declaring a winner. Roles are independent of model identities. Every turn retains its role, Provider Snapshot, effective rule version, output configuration, immutable request messages, and source identifiers.

Rule edits and user interventions remain pending until an atomic round transition. Rules cannot retroactively change a turn. A session accepts at most eight pending interventions. Applied interventions remain local records. A new topic or participant set requires a new session.

A checkpoint contains the latest completed public-answer excerpt for each seat and its original turn identifier. It is an attributed reading aid, not generated consensus analysis, factual verification, or a truth score. Checkpoints require no extra model call. Later contexts contain the topic, effective rules, seat identities, a bounded checkpoint, recent completed answers, and bounded applied interventions. Provider reasoning never enters later context. Text context stays below 96 KiB for validated inputs; truncated excerpts are labeled. Complete turns and request snapshots remain on disk.

## Storage and HTTP

Schema 20 adds `debate_sessions`, `debate_turns`, and `debate_interventions`, cascading from the owning Conversation. Ordinary conversation storage and comparison context are unchanged. Optional `debate_id` identifies a debate in conversation lists/details. Reads contain at most fifty turns and the most recent sixty-four interventions; older turns use a sequence cursor. Export loading follows that cursor for all settled turns; intervention exports explicitly cover the most recent sixty-four entries.

Authenticated commands create/control sessions, edit pending rules, and queue interventions. A separate authenticated SSE route sends coalesced invalidations. Each connection reconciles the authoritative read view. Slow subscribers cannot block the scheduler. Transient current-turn text is merged into the active read view. HTTP handlers and browser timers do not schedule calls. This preserves command/event separation from [ADR-0011](0011-separate-generation-command-and-event-stream.md), Chat ownership from [ADR-0012](0012-make-chat-the-local-service-application-facade.md), and bounded inference from [ADR-0022](0022-bound-browser-generation-lifetimes.md).

## Consequences

- Debates continue with the browser closed while the Local Service runs. There is no fixed total cost or duration; Pause or Stop prevents further calls. Missing usage and prices stay unavailable.
- Existing chat, comparisons, private inference, verification, and Selected Answer contracts retain their behavior. Content stays in local storage and is sent to selected Providers for inference.
- Database schema 20 is a compatibility change. Older Local Service versions reject it; retain a compatible backup before reverting the application.
- This implementation has no browsing tools, claim extraction model, automated judge, or spatial argument map. The workspace displays attributed positions and the actual transcript. These capabilities may be added with explicit source and privacy semantics.

## Storage and shutdown failure boundaries

A failed turn transaction cancels the run and reconciles abandoned streaming turns against the committed cursor. Unsaved answers never advance the round, opening completion, or completed-turn count. Recovery preserves terminal Stop state; Resume must reconcile abandoned work successfully before scheduling another request. A failed Provider-pause write also cancels the run rather than retrying automatically.

Shutdown closes Debate admission under the generation-start lock before checking active work. Requests still resolving catalogs cannot launch afterward. The HTTP service cancels and drains admitted handlers before closing SQLite.

Accepted intervention request IDs remain idempotent beyond the paginated history window, including after Stop or a full pending queue. Every intervention newly effective in a round reserves context space before older answers and checkpoints consume the remaining byte budget.

## Stage summaries and run controls

[ADR-0040](0040-add-debate-stage-summaries-and-run-controls.md) adds explicit model-generated stage analyses alongside these excerpt checkpoints, cumulative usage budgets, and persisted pacing. It supersedes the initial summary-free scope and extends storage to schema 21 so older services cannot ignore the new controls.
