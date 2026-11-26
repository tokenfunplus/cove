# Preserve Chat prose and bound model JSON repair

## Decision

Provider history projection preserves all original prose outside a recognized card span and all user input before the interaction-reference marker, including extracted attachments. Only the derived card summary or reference suffix has a 2,000-character budget. Stored messages and immutable input remain unchanged. This corrects the whole-message truncation in the initial implementation of [ADR 0066](0066-normalize-model-ui-and-bound-chat-overhead.md).

The model-input adapter permits two delimiter repairs: insert a missing object closer immediately before an array closer, or discard surplus closing delimiters immediately after a completed root object. It skips quoted strings and escapes, allows at most eight edits, bounds scanning to 32 KiB and nesting to 32, and requires the existing duplicate-key-aware decoder and strict canonical parser to accept the result. It never supplies missing end-of-output delimiters, strings, values, commas or colons. Unsupported types/actions, ambiguous semantics, invalid Unicode, duplicate keys and incomplete output still fall back to ordinary chat. Saved definitions never use the permissive adapter. Original Provider output remains available unchanged.

Go and TypeScript use the same bounded root-framing rules, supported version labels and whitespace-separated `cove-ui` label suffixes. A marked bare root may follow prose on its own line outside code fences and quotes. Multiple marked roots and unclosed ordinary fences prevent unfenced-JSON recognition. Exact source spans are used to preserve surrounding prose during projection; frontend framing cannot authorize partial controls.

The guide contains a real fenced JSON example with explicit replaceable placeholders and plain-language optional-property descriptions. A literal copy retaining the reserved `REPLACE_WITH_TOPIC` title is rejected. Initial model-authored Slider values snap to the nearest legal step, clamped to their valid range; ties round upward. Saved state and later edits remain strictly validated. Missing control labels use human-readable defaults rather than generated field IDs. The normalizer reads the bundled component rules once.

An optional interactive hint cannot change ordinary model-selection diagnostics or prevent comparison chat. Expected targets are checked first; only an explicit card submission requires a single target. An ineligible hint is disabled while ordinary admission proceeds.

Normalization preserves explicitly declared continuation paths, keeps explicit component IDs separate from generated state bindings, reserves source element IDs before generating quiz controls and avoids collisions with every explicit option ID. Go and TypeScript enforce the same JSON whitespace, exact property names, integer syntax and HTML-escaped state-byte budget. Unsupported fields and actions are still rejected by the canonical parser.

Reload cannot discard edits made after its read begins. Opening Projects or a project home uses the interactive draft guard before unmounting cards. A failed card continuation preserves unrelated staged attachments, and successful continuation neither submits nor releases them.

## Validation

Regression tests cover long assistant prose, long user questions with attachments, preserved source spans, shared framing cases, bounded repair and rejection cases, copied placeholders, Slider snapping and model-selection races. Shared normalization fixtures prove repaired input becomes a strictly valid canonical definition in both runtimes. Browser acceptance covers a repaired card with saved selection, reload and preserved prose, alongside malformed-output fallback and ordinary follow-up chat. Real-model results distinguish offline reprocessing of saved responses from new generation runs; neither establishes universal model compatibility.
