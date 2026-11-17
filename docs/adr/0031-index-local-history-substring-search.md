# Index local history substring search

This supersedes the scan-only search implementation choice in [ADR-0029](0029-keep-history-search-and-draft-navigation-local.md). Specific phrases should not require reading every saved message body before the three-second search deadline.

SQLite schema version 16 adds an FTS5 trigram index over message bodies. An external-content view supplies Unicode-lowercased text without storing another complete body copy. Inserts, updates, and deletes maintain the index in the same transaction, and migration backfills existing history once. Indexed terms remain local database content and have the same storage/privacy boundary as Conversation History. Builds supporting schema 15 cannot open an upgraded database.

Queries of at least three Unicode characters use a quoted literal FTS phrase to narrow message candidates before exact Unicode substring verification. Quotes and FTS operators are not interpreted as user query syntax. One/two-character queries and queries containing NUL use the bounded scan path because a trigram cannot represent them. Index input replaces NUL with a separator so later text remains indexed; final verification and excerpts use the original body. Active matches retain pin/update ordering, while archived matches follow archive-time ordering.

The SQLite FTS5 [trigram](https://www.sqlite.org/fts5.html#the_trigram_tokenizer) and [external-content](https://www.sqlite.org/fts5.html#external_content_tables) documentation defines these index constraints. Broad or short searches can still require refinement; the existing query length, result count, and execution deadline remain in force.
