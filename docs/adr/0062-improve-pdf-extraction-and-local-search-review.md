# Improve PDF extraction and local search review

This extends [source document snapshots](0025-snapshot-local-source-documents-for-file-chat.md), [managed document retrieval](0048-add-managed-local-inference-and-document-retrieval.md), and [searchable Project materials](0053-integrate-local-capabilities-into-chat-and-projects.md).

PDF pages can draw a horizontal line as many independent text objects. The plain text decoder inserts a line break for each object. PDF extraction uses glyph geometry to reconstruct clearly horizontal fragments when the plain text is excessively broken. Ambiguous layouts retain the decoder's text. Extracted sections use the original page numbers and the existing file, page, text, and worker limits. New PDF snapshots record the extraction version `cove-pdf-v2`.

The search dialog keeps the query and selection actions visible independently of the scrolling results. Result cards show compact excerpts. The original-section preview, copy action, and attachment preparation read the selected source snapshot. Display formatting belongs to the result card.

Updating an older library PDF index reparses the saved original locally and writes its refreshed snapshot and vectors together. Older library indexes remain searchable until explicitly updated. Selecting searchable Project material refreshes its older PDF index as part of search. The Project index stores refreshed page text separately and uses the existing Project original. Project materials and saved Conversation snapshots retain their individual stored versions.

SQLite schema 28 adds a nullable source snapshot to the Project search index. Existing indexes use their stored Project source snapshot until they are refreshed. Older Cove builds reject databases upgraded to schema 28.

Attachment preparation uses the document and chunk selection, plus the PDF extraction version reported by search. Require the version for new PDF snapshots and reject stale versions so a result from before an index update cannot resolve to a different passage. An already prepared draft attachment retains the snapshot it captured.
