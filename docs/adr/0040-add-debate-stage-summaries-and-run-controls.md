# Add Debate stage summaries, usage budgets, and pacing

Debate adds model-generated stage summaries and service-owned budget/pacing controls. This extends [ADR-0037](0037-add-service-owned-continuous-debate-sessions.md) beyond its initial excerpt-only reading aids. Existing checkpoints remain attributed excerpts without an extra call. The new analyses are explicitly generated interpretations with source references.

## Stage summaries

New setup defaults to a summary every three completed rounds. Users can choose Off or a cadence of one through ten rounds and select one existing model seat. Older sessions retain Off until configured. Each summary is a separate scheduled turn with `kind: summary`, a 2,048-output-token bound, immutable request messages, Provider Snapshot, and usage. It does not advance the participant cursor or completed participant-turn count. NearAI summaries use the same exclusive browser claims, encryption, response verification, deadlines, and terminal cancellation as participant turns.

The request contains bounded public statements from the configured stage and one preceding baseline round, with at most forty-four completed participant turns. Reasoning, failed verification, and earlier generated analyses are excluded. The output contains new ideas, position changes, and open questions, with up to five points per category, six hundred characters per point, and one to four original-turn references. Chat validates the schema and every reference against the immutable source set. Position changes require distinct source turns from the same seat, including a turn in the summarized stage. These checks establish attribution, not the correctness of the model's interpretation.

The original model response and verification record remain intact. Parsed points are stored separately for presentation and citation navigation; the latest successful summary is also retained on the session for paginated readers. Generated summaries do not enter later participant context or excerpt checkpoints. Markdown exports retain readable points and source turn numbers.

A settled failed summary pauses without an automatic retry. Its attempted round is recorded atomically with the turn, so an explicit Resume continues the participant discussion rather than repeating that paid analysis. Stop, interruption, and unclaimed work retain their existing terminal/recovery semantics. A failed transaction never advances the summary cursor or stores a new successful summary.

## Usage and budgets

Persistence aggregates accounting fields across the entire debate independently of transcript pagination. Reported input/output counts include participant and summary calls, including failed/stopped attempts when usage is available. Browser claims durably mark possible usage before authorizing execution and recheck expiry after storage. Unclaimed work is excluded; historical attempts without the new marker remain conservatively unknown. Missing usage remains absent rather than becoming zero.

Optional positive token and USD estimate budgets produce reminders. Automatic pause is an explicit choice. When enabled with a budget, Chat closes admission at a reached threshold, or when missing reported usage prevents a complete budget assessment. Cost budgets require input/output rates for every seat. Active calls, including concurrent openings, may exceed a threshold; this is not a Provider-side billing cap. Resume and Step cannot bypass an unresolved automatic pause. Users can increase a limit or turn automatic pause off.

The USD estimate applies the rates saved for this debate to its cumulative reported tokens, excluding discounts and other Provider charges. Editing rates recomputes that estimate. This is a scoped extension to [ADR-0032](0032-add-answer-tools-and-generation-measurements.md): ordinary response pricing remains browser-local, while explicitly saved debate rates live with the session so background execution can apply the same estimate. Setup can seed those fields from browser preferences or advertised catalog rates, and explains that they are saved with the debate.

## Pacing and settings

Chat owns a persisted next-turn time and a configurable zero-to-sixty-second interval. Independent openings remain concurrent. Later calls, including summaries, wait after the preceding completed work. Editing an interval updates the current wait and wakes the scheduler to reconcile it. Explicit Resume/Step discards the old waiting deadline. Browser timers only present state and execute already claimed requests.

Summary, budget, rate, and pacing settings are separate from round-versioned ground rules and apply before further calls. A versioned PATCH rejects stale edits from another tab. Settings changes never start inference. Stop remains terminal and its settings remain inspectable. Storage failures while enforcing an automatic pause cancel the run.

Schema 21 preserves existing records and guards these new semantics: older services must reject a database whose persisted budget and summary controls they cannot enforce. HTTP remains an adapter, Chat owns admission and generation lifecycles, and persistence owns storage and cumulative queries.
