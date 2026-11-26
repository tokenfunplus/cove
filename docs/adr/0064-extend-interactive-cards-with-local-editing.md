# Extend interactive cards with local editing

## Decision

Extend ADR 0063 with an immutable `cove-card-v2` envelope and `cove-interactive-v2` catalog. Keep v1 parsing and rendering for saved cards; never reinterpret a v1 definition as v2. The model guide advertises v2 for new optional cards in ordinary single-target Chat. Both supported fence versions must match their envelope. Unknown versions remain inactive.

V2 adds Ranking, Slider, AllocationSummary, TextInput, and TextPreview. Ranking stores a complete duplicate-free permutation of its declared option values. Pointer drag/drop and labelled Move up/down buttons produce the same order. A Slider binds an integer field with explicit minimum, maximum, and step, bounded to one million in magnitude. Integer steps avoid floating-point normalization differences between Go and TypeScript. TextInput binds a Unicode string with an explicit maximum of 2,000 code points. TextPreview renders that text as escaped, wrapping plain text; generated HTML, templates, and formulas do not execute.

AllocationSummary reads declared Slider fields. The registered `allocation-sum-v1` calculation computes their sum and the difference from a declared nonnegative total. It shows an over-budget amount when negative, rather than silently modifying another slider or blocking a user's deliberate tradeoff. The exact inputs, total, sum, remainder, unit, and calculation version are saved in the immutable continuation reference. The service recomputes these outputs. Model-authored expressions are not supported.

All local edits use the existing versioned run saves, conflict recovery, leave-draft protection, expansion controller, and one-time continuation admission. Text undo/redo is bounded and window-local; acknowledged text restores from the Local Service. Reset restores the definition's initial values. Submitted controls lock while their readable previews remain available. These controls do not call a Provider; only explicit Continue asks for another response. Visible summaries preserve ranking order, numeric units, and edited text so later model context has their meaning as well as raw values.

## Validation

The same accepted and rejected fixture corpus is executed in Go and TypeScript. Test malformed bounds, off-step values, incomplete rankings, oversized text, invalid summary references, and v1/v2 mismatches. Component tests cover local gestures, undo/redo, required text, expansion, and locked controls. Persistence and browser checks cover save, reload, immutable input, and exactly one continuation using temporary data. Richer cards remain an optional response format with prose as the default.
