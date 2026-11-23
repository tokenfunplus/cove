# Improve local capability feedback and recovery

Date: 2026-11-23

Status: Accepted

This extends ADR 0048, 0050, 0053, 0055, and 0057. It supersedes their restart-only download policy for interrupted transfers and the retention of multiple idle inference workers. No database migration is required.

## Effective generation settings

Chat resolves local output limits before saving each Generation attempt, including retries and Debate turns. Local attempts record their effective maximum of 1,024 tokens (or a smaller explicit request). Batch preferences and remote comparison targets retain the user's requested settings. The native adapter keeps the same defensive limit. Existing historical snapshots are not rewritten.

The existing 4,096-token local context limit remains in force. Context review discloses that limit separately from character budgets; it does not present character counts as model token counts or silently truncate sources or history.

## Speech drafts and previews

Speech previews accept optional volume and CPU-thread overrides alongside the existing model profile. Missing overrides preserve compatibility with older callers. Speech validates overrides using the ordinary settings rules without saving them. Zero volume is a real value. An explicitly empty preview remains empty and disables synthesis.

Switching between Installed, Discover, and Speech retains the Speech settings draft for the current settings session. Selecting another model's voice options does not discard other model profiles. Leaving the Speech view stops its preview. Closing Settings still ends that settings session; drafts are not written to browser storage.

## Retrieval result selection

Rank all chunks in the explicitly selected document scope, then skip chunks whose original sections are already represented. Continue scanning until five distinct passage results are found or candidates are exhausted. Selection keeps the winning chunk's original identity and exact source sections; no new citation text is synthesized.

The search API accepts an optional minimum cosine similarity in [0, 1], defaulting to zero. The UI exposes that user-selected filter and explains empty results. This is a ranking cutoff, not an empirically calibrated confidence threshold or answer-quality guarantee. No new automatic cutoff is claimed without representative positive and negative evaluation. Existing indexes do not need rebuilding.

## Interrupted downloads

Pinned inference weights and speech bundle artifacts retain private partial files after network failures or deadlines. Retry requests the remaining range. A response must match the exact requested range and pinned total byte count; a server returning the full file instead safely restarts that artifact. SHA-256 is checked over the complete file before publication. Corrupt or oversized partials are discarded. A completed speech artifact can be reused while retrying another file in the same bundle.

Explicit cancellation discards current partial downloads; model removal also clears retained resume data. Failed downloads expose a separate discard action. Partial data is not an installed model, and installing never changes the selected chat model. Arbitrary download destinations remain unavailable to browser callers. Redirect restrictions, private permissions, archive validation, and deadlines remain unchanged.

## Inference feedback and memory

Local chat reports transient waiting, model preparation, and generation activity through additive `activity` SSE events. These are independent of Web Research activity and do not change durable Generation states. Older clients may ignore them. Cancellation still covers lease admission and model loading.

Only one inference model remains resident: switching between chat models or document embeddings unloads the previous worker while holding the inference lease. The current model retains its existing two-minute idle lifetime. This bounds retained model memory at the cost of a cold load when switching back. Speech remains an independent processing capability.

## Validation

Synthetic regression checks cover preview overrides and empty input, retained settings drafts, per-target effective snapshots, retrieval deduplication and filtering, range continuation and safe restart, integrity rejection and cancellation cleanup, and local activity projection. These do not replace real native model quality, network-interruption, or signed-package acceptance.
