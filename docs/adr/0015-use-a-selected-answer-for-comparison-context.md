# Use a Selected Answer for Model Comparison context

Conversation History retains every completed result of a Model Comparison, but subsequent Provider requests include only its Selected Answer. A single-target Batch selects its completed result automatically; the user explicitly selects one completed result of a multi-target Batch. This prevents unrelated competing answers from being presented to a Provider as if they were one assistant turn while preserving them for local comparison.

Before the next Batch can start, the user either selects a completed answer or explicitly context-skips the earlier Batch. Either disposition may change until a later Batch captures it as an immutable Context Snapshot; later changes affect only future Batches. A Context-Skipped Batch remains local Conversation History but contributes neither its user message nor its results to later Provider context.

## Considered Options

- Send every comparison result in the next context: rejected because it increases disclosure and leaves the Provider with contradictory same-turn assistant responses.
- Discard unselected comparison results: rejected because local comparison is the purpose of the feature.
