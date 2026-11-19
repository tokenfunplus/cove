# Filter history and show Debate activity

The sidebar adds a History toolbar, activity/type filters, active-filter chips, and explicit reset/empty states. All time and All types preserve existing list behavior. Today, Last 7 days, and Last 30 days use inclusive local calendar-day cutoffs. Types are Chat and Debate; an ordinary Chat may contain both single-model answers and Model Comparisons, so comparison is not a mutually exclusive conversation type.

## Ownership and search

Workspace UI owns the current filter choices. Browser-local storage retains only two validated enums under a versioned key, with a fallback when storage is unavailable. Search text and conversation data are excluded. A midnight timer updates the active date cutoff. Filtering does not navigate, discard drafts, or execute inference. Pin/date grouping and existing ordering continue within the filtered results.

The complete local conversation list is filtered in presentation. Search receives optional `kind` and RFC3339 `updated_after` parameters through the HTTP adapter and Chat facade. Persistence applies both filters before phrase matching and the fifty-result cap, including archived search. This extends [ADR-0031](0031-index-local-history-substring-search.md); its FTS/literal matching, bounded excerpts, references, and three-second deadline remain intact. Debate title matches now preserve their Debate identity and metadata. Debate turn-body indexing remains outside this change.

Activity uses the existing Conversation update timestamp, including model completions and Debate lifecycle updates. This change does not introduce a separate user-interaction timestamp or a new sorting mode.

## Debate metadata

Conversation list, detail, and search read models add optional `debate_status` and `debate_round` alongside `debate_id`. Persistence reads them from existing schema 20 records. Ordinary conversations omit these fields. No database migration or Provider/secret access is needed.

Debate view reconciliation updates matching cached history metadata without replacing search excerpts. Explicit controls invalidate history. Visible history with active debates reconciles every three seconds; history containing only inactive debates reconciles every fifteen seconds and on browser focus. These are local read queries, do not retry failed Provider work, and do not run in hidden browser tabs. List rows show the actual running/pausing/paused/stopped state; older responses without state use a neutral Debate label.

## Consequences

- Filters apply to pinned conversations, local search, and archived history. A selected conversation may remain open while its row is filtered out.
- The toolbar exposes active choices and a reset action, including when no result matches.
- HTTP validates type and timestamp inputs, including the range supported by stored nanosecond timestamps. SQL uses bound filter values.
- All contracts are additive. Browsers and older clients that omit filter parameters retain their existing history behavior.
