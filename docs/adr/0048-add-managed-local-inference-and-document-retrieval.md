# Add managed local inference and explicit document retrieval

Date: 2026-11-21

Status: Accepted

[ADR 0057](0057-close-local-capability-review-boundaries.md) replaces the original loopback worker handoff with private Unix sockets and extends admission and lifecycle checks.

This decision extends [local model discovery](0047-add-curated-local-model-discovery.md) and [source document snapshots](0025-snapshot-local-source-documents-for-file-chat.md). Two catalog entries now support installation: BGE Small Chinese v1.5 Q8_0 (26,472,640 bytes) for retrieval, followed by Qwen2.5 0.5B Instruct Q4_K_M (491,400,032 bytes) for offline chat. Other entries remain discovery metadata.

The Local Service owns an allowlisted model registry with immutable Hugging Face revisions, exact byte lengths, and SHA-256 digests. Persistence writes private temporary files, verifies complete downloads, and atomically installs weights under the local data directory. Downloads have progress and cancellation; partial files are removed rather than resumed. Arbitrary URLs, executables, and filesystem paths are not browser inputs.

The macOS package includes the official MIT-licensed llama.cpp b12606 ARM64 runtime, pinned by archive SHA-256. The optional inference feature requires macOS 13.3 or later; the rest of Cove retains its existing baseline. Packaging signs the bundled executable and libraries. The Local Service starts workers with a minimal environment, private loopback authentication, and no inherited Provider Keys. A single cancelable lease serializes inference, idle workers unload after two minutes, and stopping local generation terminates its worker. Workers do not own history or browser sessions.

Chat owns document and Generation orchestration. HTTP handlers only adapt authenticated commands, `retrieval` implements indexing and selection, and persistence owns originals, vector records, and model files. The library accepts at most 32 bounded text, code, or text-based PDF documents using the existing parser. Users select one to four documents per query; conversation history and other library documents are never implicitly searched. BGE indexes 320-rune chunks as normalized 512-dimensional vectors. Exact cosine search returns at most five hits, with model hash and index version attached. Similarity scores are ranking values, not confidence estimates.

Users explicitly choose results to attach to chat. The browser submits document/chunk identifiers; Chat resolves the corresponding original line/page sections and creates session-owned draft tokens expiring after 15 minutes. The saved Batch retains original bytes, selected sections, source identity, and retrieval provenance. Every model target, retry, and branch uses the saved snapshot. Citations navigate to these original sections; they do not prove answer correctness.

Deleting a library document removes its original, vectors, and pending source tokens. Already saved chat copies remain until their conversations are deleted. Removing BGE also removes its indexes but preserves library originals for reindexing. Clearing chat data clears the library as well, while retaining installed weights. These are distinct, disclosed deletion scopes.

Installed Qwen appears as the managed, read-only `On this Mac` Provider. It uses the normal Active Model Set, Chat streaming, stop controls, history, retries, and immutable Provider Snapshots, including model revision, hash, and runtime version. It requires no Provider Key and has no Web Research tools. Context is limited to 4,096 tokens and output to 1,024 tokens; excessive input fails rather than silently shifting context.

SQLite schema 25 adds the library and vector records. Older Cove versions reject this newer schema. Original documents and vectors are stored locally without additional encryption. Installing weights contacts Hugging Face and its download infrastructure; inference and retrieval operate offline afterward. Attaching selected sections to a remote Provider sends those sections through that Provider's configured transport.

The two real-model acceptance gates and their limits are recorded in [local inference acceptance](../local-inference.md). Small synthetic fixtures establish the implemented chain, not a general accuracy or performance guarantee.
