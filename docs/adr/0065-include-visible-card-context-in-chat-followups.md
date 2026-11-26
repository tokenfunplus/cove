# Include visible card context in Chat follow-ups

## Decision

Extend ADR 0063 and ADR 0064 so an ordinary typed follow-up can include the current card's values. When the latest Selected Answer has an eligible interactive card and Chat has one selected model, the composer shows a checked, removable **Include card** reference naming the card. This is a visible context attachment, not an interactive mode. Removing it sends an ordinary message. The reference disappears when its source is stale or submitted. A new source starts with a fresh reference; comparisons, unrelated branches, and side conversations never inherit one silently.

Before sending or reviewing context, flush the mounted controller's edits and capture acknowledged values and revision. A local save failure blocks submission and preserves the message and card draft. The existing per-window controller owns values; a temporary registry holds mounted preparation callbacks only, not a second value store. Context preview and actual submission use the same captured source and intent. The service still owns validation and admission.

Add optional `intent: "discuss"` to the existing card submission. It requires a nonempty user question, permits incomplete required fields for discussion, and produces a model reference snapshot without presenting unfinished work as a completed selection. Default card Continue retains required-field validation. Both intents recheck the source, revision, Conversation, and one-time admission in the same transaction, freeze the submitted values, and invalidate subsequent continuation from the old card. Discussion preserves the typed message as its visible user body. File and webpage attachments remain available for discussion; their reference data and the card snapshot both enter the same immutable input. Button Continue keeps its existing attachment behavior.

This supersedes the earlier rule that ordinary typing always excludes unsent card state: inclusion is now explicitly visible and removable in the composer. It does not add continuous Provider requests, hidden screen observation, or arbitrary generated code. Reveal/expansion state remains presentation-only. The model receives declared values and applicable feedback on a deliberate Send.

## Reliability and generation guidance

Read responses may not replace a newer acknowledged card revision. In-flight reads are cancelled before a save and lower-revision query results are ignored. Reload/discard also respects revision ordering. Tests must settle asynchronous query notifications before checking that state remains current.

Go and TypeScript share framing and canonical validation fixture corpora covering CRLF, fence whitespace, ordinary nested code examples, duplicate cards and supported version aliases. Model input passes through Extract/Normalize before strict Parse: unknown properties may be discarded, bindings generated and option IDs remapped. Shared normalization fixtures record those accepted conversions separately from rejected unsupported semantics, duplicate keys and invalid graphs. [ADR 0067](0067-preserve-chat-prose-and-bound-model-json-repair.md) also permits bounded delimiter repair; saved canonical cards remain strict. Unsupported or incomplete cards may display their bounded escaped fallback while actions stay disabled.

The model guide includes complete valid examples and explicit rules for ordinary prose, useful gestures, discussion of incomplete values, and response continuity. Automated fixtures validate the examples and transport behavior. Real-model generation quality remains a separate acceptance check and must not be inferred from scripted Provider tests.

Workspace-authored System Prompt settings remain limited to 8,192 Unicode characters. Captured generation configuration permits 32,768 characters so Cove-owned component guidance can be appended without rejecting otherwise valid workspace settings. The combined message context remains subject to the existing 240,000-character limit and model-specific token limits. This supersedes the previous 8,192-character cap on captured configuration only; the shared response schema records the new cap.
