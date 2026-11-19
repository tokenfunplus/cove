# Continuous Debate mode

Choose **New debate** in the workspace toolbar. Enter a topic, choose two to four distinct model targets from configured Providers, assign a role to each seat, and define the ground rules. Models may share one Provider, including NearAI. Model identity and analytical role are independent settings. NearAI uses the same browser encryption and verification transport as ordinary Chat.

**Start debate** opens a locally saved conversation. Models give independent opening answers, then take rotating turns to challenge claims, inspect evidence, and explore new angles. There is no round limit or automatic stop when models agree. Service-driven calls continue while the Local Service runs, including when the browser is closed. For debates with NearAI seats, keep the debate open for encryption and verification. Calls use your configured Provider Keys and Provider allowance.

## Controls

![Debate Focus mode with synthetic Provider responses](images/debate-focus.png)

- **Focus mode** in the workspace header hides conversation navigation and the persistent live brief, gives the transcript the main visual space, and shows participants with their speaking status. Pause, Resume, Step, Stop, rules, and interventions stay available. Open **Live brief** for attributed positions. **Exit Focus** or Escape restores the workspace; a dialog receives Escape first. Switching views preserves the intervention draft, current inference, and reading position when following is paused. Focus is window-local presentation state.
- **Pause** finishes active work and prevents another turn. During the blind opening, all already-active opening requests may finish.
- **Step** runs one turn while paused; an incomplete opening advances its outstanding independent seats as a group.
- **Resume** continues a paused session. A Provider failure pauses automatically; check the connection before resuming the unfinished seat.
- **Stop** cancels active requests and ends the session permanently. Completed turns remain saved; incomplete text is discarded. Start a new debate for another session.
- **Add to debate** queues a question or perspective for every model at the next round boundary. Up to eight interventions can wait. Rules edited through **Rules** also apply at the next boundary. Existing turns retain their original version. Changing the topic or model seats requires a new session.

The live brief shows participants and attributed excerpts from completed turns. Checkpoints do not declare a winner or establish factual correctness. Use turn details to inspect the Provider Snapshot, observed usage, effective rules, and context source identifiers. Missing usage and prices stay unavailable.

Older turns are paginated. **Export** includes all settled turns and the most recent sixty-four interventions. Ordinary conversation and workspace downloads also include debate transcripts. Provider reasoning is separate from public answers and never enters later debate context.

History search currently finds debate conversations by title. Debate turn bodies are read through the paginated transcript rather than the ordinary message search index.

Closing the Chat Surface does not stop a debate containing only service-driven models. Leaving a debate with active NearAI work interrupts that browser request and pauses the session. An unavailable browser also times out and pauses automatically; **Resume** retries only unfinished seats. A reload or second tab cannot repeat an already claimed request. Quitting/restarting the Local Service pauses every debate and requires explicit Resume. Only one ordinary Generation Batch or Debate Session can run at once. Pause releases that reservation. Deleting a debate or clearing history cancels its requests before removing local records.

NearAI turns show environment/response verification phases and the saved verification result. **Details** exposes the original receipt and evidence. Failed verification never contributes an answer to later debate context, including gateway modes. The transcript retains verification summaries; large evidence records are fetched only for turn details.

## Compatibility and scope

This feature migrates local storage to schema 20. Older versions reject that schema; preserve a compatible backup if you need to downgrade. See [the architecture decision](adr/0037-add-service-owned-continuous-debate-sessions.md).

The current implementation has no browsing tools, model judge, claim extraction pass, or argument map. The live brief contains source-attributed positions, rather than fabricated agreement or confidence scores. Checkpoints make no extra model calls. Per-turn output, duration, and context stay bounded even though a session has no round limit.

## API

All routes require the local Browser Session. Mutations also require the existing origin/CSRF proof.

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/debates` | Idempotent creation with `client_request_id`, topic, seats, and rules |
| GET | `/api/debates/{id}?before={sequence}` | Session state, up to fifty turns, recent interventions |
| GET | `/api/debates/{id}/turns/{turn}` | Inspect one original turn |
| POST | `/api/debates/{id}/turns/{turn}/browser/claim` | Claim one scheduled NearAI request and read its immutable messages |
| POST | `/api/debates/{id}/turns/{turn}/browser/progress` | Report transient text and verification phase for the claimed turn |
| POST | `/api/debates/{id}/turns/{turn}/browser/settle` | Settle a claimed turn with the browser verification result |
| GET | `/api/debates/{id}/events` | Coalesced invalidations; reconnect always reconciles reads |
| POST | `/api/debates/{id}/control` | `pause`, `resume`, `step`, or `stop` |
| PATCH | `/api/debates/{id}/rules` | Queue the next effective rule version |
| POST | `/api/debates/{id}/interventions` | Idempotently queue a user intervention |

The read response includes transient current-turn text while active; only complete answers are saved. Effective rules and exact request messages are saved with each turn. Full request contexts are not repeated in workspace read responses.
