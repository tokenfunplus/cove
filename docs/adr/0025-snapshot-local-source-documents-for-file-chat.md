# Snapshot local source documents for file chat

[ADR-0042](0042-add-public-webpage-source-snapshots.md) extends source snapshots with explicitly retrieved public webpages, session-bound network previews, and additive webpage provenance.

Cove accepts up to four UTF-8 text, Markdown, code, or text-based PDF attachments with a user message. Each file is at most 4 MiB, with at most 60,000 extracted Unicode characters per file and 120,000 across its attachments. Text files have at most 4,000 lines; PDFs have at most 50 pages. Unsupported, empty, binary, password-protected, scanned-only, and oversized inputs fail explicitly rather than being silently truncated. PDFs with some textless pages retain their original page numbering and include only pages with extractable text.

Chat owns parsing and Provider input construction through `internal/documents`. HTTP handlers only adapt bounded requests. The authenticated, CSRF-protected attachment preview and draft-context preview endpoints do not contact a Provider or persist drafts. The runnable Local Service delegates PDF decoding to a fresh instance of its own executable with a ten-second deadline, bounded output, a two-worker limit, and no inherited environment. That child does not initialize storage, Keychain, or HTTP. Go memory/stack limits reduce decoder pressure; this process boundary is not an OS sandbox or a hard memory limit.

On accepted submission, persistence atomically saves the original bytes, SHA-256 identity, filename, parser version, extracted line/page sections, and exact augmented user input alongside the Generation Batch. They are immutable and shared by all Targets and retries. SQLite schema 14 adds these fields with empty defaults, preserving earlier history and text-only API clients. Repeated delivery of a `client_request_id` returns the original Batch without parsing or replacing its files again.

This extends ADR-0014, ADR-0015, and ADR-0021: Context Snapshots include the saved augmented user input for selected earlier Batches. The browser uses the Batch's authoritative `input_content` for the current turn, while the context endpoint continues to exclude the current turn and System Prompt. Ordinary and browser inference receive the same extracted source text. The browser must not reconstruct attachment inputs from visible history or reread the original filesystem file.

Source text is sent as JSON reference data, with instructions to cite `cove:<sha256>:<section>` links. The Chat Surface resolves only known document identities and existing line/page sections. A citation is navigation to saved source text, not a claim that the model's statement is supported or that the document is cryptographically verified. Existing Provider Snapshot and NearAI verification meanings remain unchanged.

The context inspector shows the exact current draft before submission, or a saved Batch's prior context and latest Target attempt configuration afterward. Cove rejects submissions and retries above 240,000 input Unicode characters, including System Prompt and selected history. This is an application bound, not an exact token count or a promise that a particular model's context window can accept it. Provider-specific token limits still apply.

Original files remain local; Providers receive extracted text through their existing transport. Snapshots and original bytes are unencrypted in the existing local SQLite database. Authenticated original downloads use attachment disposition, no-store caching, and an opaque binary media type. Conversation deletion stops its affected Generations before removing their records, extending the direct API enforcement of ADR-0006; clearing history also removes attachment records. Existing exports include saved text and source metadata, but exclude original file bytes. Local drafts are discarded on conversation navigation or reload and never saved in browser local storage.

## Considered options

- Send original files to Provider-specific file APIs: deferred because it would require separate capabilities, remote retention semantics, and private-inference support.
- Resolve files again on retry: rejected because changed local content would invalidate comparison and Context Snapshot semantics.
- Persist preview uploads before submission: rejected to avoid orphan files and a separate draft cleanup lifecycle.
- Add OCR, images, retrieval indexes, and tool execution in this change: deferred to separate capabilities and acceptance criteria.
