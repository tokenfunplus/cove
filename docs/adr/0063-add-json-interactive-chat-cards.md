# Add JSON interactive chat cards

Ordinary single-target Chat automatically advertises an optional interactive card format to the model. The saved assistant body may contain one top-level `cove-card-v1` JSON fence alongside prose. The internal capability policy is persisted with its Generation Batch and its catalog instructions are captured in the attempt's System Prompt. Retry retains the Batch policy. Multi-target admission rejects interactive requests; Debate continues using its own controls.

## Contract and rendering

The versioned JSON envelope and flat element map follow the catalog/spec/registry separation explored in [the interaction design](../interactive-chat-design.md), with field management and registered actions informed by jform. The first implementation uses a small Cove renderer around existing Radix UI adapters. It does not add a hosted gateway or an external rendering runtime. json-render package integration and OpenUI Lang remain future adapter options, not dependencies needed to render saved cards.

Card, Text, Choice, Reveal, Feedback, and Button support choice stories, local quizzes, recall self-ratings, and creative ingredient selection. A shared JSON catalog declares component props and actions; repository checks reject drift in the service's embedded copy. Go and TypeScript run the same accepted/rejected fixture corpus for binding, tree, value, and action validation. Only the specified data-only subset is supported. No generated HTML, code, URLs, styles, arbitrary expressions, or general state actions execute.

Controls are enabled after completion and server-side validation. Partial, failed, or unsupported output has no active card. Surrounding prose and access to original JSON remain available when a card cannot load. Expansion shares the current controller, while separate windows reconcile through service-owned revisions. Interface copy stays English and generated user content supports Unicode.

## State and admission

Schema 29 adds an interactive Batch flag and per-Generation card runs with immutable definitions, current values/check records, revisions, and a consumed Batch reference. Records use Conversation/Generation cascade ownership. Selection changes enqueue a local save immediately; dirty cards and optional questions participate in the existing leave-draft guard. Saving uses a compare-and-swap revision, cannot modify a consumed run, and does not call a Provider. Quiz outcome text is resolved from the saved definition. Changing a selection invalidates its checked feedback.

Continue validates a card against the current tail's exact Selected Answer, including existing NearAI selectability requirements. Persistence rechecks source, Conversation ownership, revision, and consumption in the transaction that creates the new Batch. A consumed run cannot produce another turn through a different request identity. An identical request can replay its result after the source becomes stale; a changed request fingerprint is rejected. All existing target, local-only, Private TEE, Project, context-limit, and active-work checks still apply.

Chat derives the visible user summary and a bounded `interaction-v1` reference block from accepted choices and local feedback. The Batch saves the exact augmented `input_content`, including turns without file attachments. Ordinary execution, browser inference, later selected-history replay, and retries read that saved input. Labels and values remain reference data, not System Prompt instructions. Raw assistant output and verification evidence remain unchanged.

Existing plain-text edit-and-resend creates an independent branch without carrying a contradictory interaction attachment into its edited user turn. Inherited materialized card records are copied independently; submitted source identifiers remain historical provenance. Deleting the original Conversation cannot remove the copied values. Ordinary exports retain original card JSON and the immutable submitted input in the existing history formats; unsent run drafts are not exported.

## First implementation scope

The composer remains a normal chat input, with no interactive switch or scenario shortcuts. The model chooses whether a card is useful from the conversation; prose is the default. This supersedes the initial design proposal of a manual toggle and template menu. Ask about this opens a bounded question field inside the card; Continue submits that explicit question together with the selected state and preserves unrelated composer text/attachments. This is the initial alternative to the design's staged composer chip. Card state autosaves to SQLite; an unsent optional question remains window-local. The expanded card uses a shared dialog rather than a new workspace navigation surface.

Structured alternative-choice branch overrides, staged composer references, sliders, sorting, matching, and spatial canvases are follow-up work. A submitted card is read-only; the existing user-turn editor remains available for a plain-text branch. History with no captured interactive policy never becomes executable merely because a fence tag matches. Browser-verified inference uses the existing browser settlement path; UI projection creates no additional verification claim.

This extends ADR 0014, ADR 0021, and ADR 0035 while preserving their Generation, context, and branch ownership. It does not change the window-local Working Draft policy in ADR 0032 or the Quick Panel authorization model in ADR 0059. The full design remains the roadmap; this decision records the concrete initial subset.

ADR 0064 extends this initial subset with [local editing controls and the v2 contract](0064-extend-interactive-cards-with-local-editing.md), while retaining v1 definitions and their saved behavior.

Migration 29 follows main's project search snapshot migration 28. It also preserves data from unreleased interactive previews that had previously used 28, by completing the project snapshot column before retaining their existing interactive runs.
