# Keep loopback requests active without internet

Date: 2026-11-21

Status: Accepted

This extends [frontend state ownership](0019-separate-frontend-presentation-and-api-hooks.md) and [managed local inference](0048-add-managed-local-inference-and-document-retrieval.md). The shared application QueryClient uses `networkMode: always` for queries and mutations because those operations address the authenticated loopback Local Service. Browser internet reachability does not establish loopback reachability.

TanStack Query's default online mode pauses reads and commands when the browser reports an offline state. That incorrectly blocked local session initialization, history and model discovery, new conversations, Generation submission, and Stop commands even though the Local Service and installed native model were available. The production entry and workspace regression tests now share the same client factory.

Local requests run immediately while offline and report actual service failures through the existing error path. Command retries remain disabled by their API hooks, catalog authorization and refresh policy are unchanged, and SSE stays outside the query cache. Remote Provider and download operations still require their destinations to be reachable; this policy does not claim remote inference works offline or synthesize browser connectivity state.

Regression checks cover a workspace opened offline, internet loss during streaming, local text deltas, and immediate Stop submission. The browser connectivity state remains offline throughout these checks.
