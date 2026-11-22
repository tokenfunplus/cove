# Serialize local model and document lifecycle changes

Date: 2026-11-22

Status: Accepted

This refines the lifecycle guarantees in [managed local inference](0048-add-managed-local-inference-and-document-retrieval.md). No database or public API schema change is required.

Local chat-model removal shares Chat's Generation admission lock. It checks active work after acquiring that lock, preventing a new Generation from being admitted between the busy check and weight removal. Native inference leases and library operations reject contexts that are already canceled, including cancellation racing an available lease. Canceling a local chat request before response headers also terminates its native worker instead of leaving it resident until the idle timeout.

Library import admits parsing and indexing as one serialized operation. Clearing chat data waits for admitted imports before deleting their records. A library epoch rejects imports queued before a successful clear but admitted afterward. Frontend clearing also cancels library reads and clears cached library metadata so a late response cannot restore deleted document names in the UI. Installed weights remain separate from chat-data deletion.

Document dialogs cancel outstanding requests when closed or stopped, ignore late results, and release late source tokens. Preparing chat sources disables changes to the query and chosen hits until that operation finishes. A late response cannot add sources to a later chat draft. Multi-file library import processes every selected file, up to 32 per selection, instead of silently discarding files after the fourth; the search scope remains at most four documents. Stop prevents the remaining files in an import batch from starting.

The attachment draft also checks the originating conversation before accepting retrieved sources, covering navigation that retains an old callback. Retrying or removing a model cleans orphaned `.download-*` files from that model's owned directory after the manager has serialized its download lifecycle; unrelated files are preserved. Downloads still restart rather than resume after interruption.

Regression checks reproduce the prior failures using synthetic sources, controlled delayed responses, and private test workers. These checks complement the real-model retrieval and offline-chat smoke gates; they do not replace accuracy evaluation on user documents.
