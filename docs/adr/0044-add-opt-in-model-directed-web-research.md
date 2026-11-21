# Opt-in model-directed web research

Date: 2026-11-21

Status: Accepted

## Decision

Ordinary chat and Model Comparison can opt into native model tool calls using a globe toggle. New conversations start with the toggle off. The browser remembers only conversation identifiers and their toggle choices. An unconfigured toggle opens Settings without submitting or clearing the draft; saving a configured default enables the initiating conversation. A running attempt uses its saved policy regardless of later settings changes. Continuous Debate and side-conversation tools do not inherit the main conversation toggle.

Settings holds a default search connection and global limits. Tavily, Linkup, and Exa use fixed HTTPS destinations, separate Keychain entries, standard/deep depth mappings, and optional domain filters. Several provider keys can be configured, with one default. New or replacement keys are tested with a single standard search before saving. Failed validation preserves the old key. Passive settings reads check credential presence without retrieving keys or contacting search services. Search requests do not automatically retry or switch providers.

Chat owns the tool loop. HTTP handlers only adapt authenticated, CSRF-protected commands. `web_search` returns bounded, saved search excerpts. `read_webpage` reuses the credential-free, public-address-only reader from [webpage source snapshots](0042-add-public-webpage-source-snapshots.md). Search results are reference data, never instructions, and remain explicitly distinct from full page retrieval. Search API keys stay inside the Local Service.

Each Generation attempt defaults to three search requests, five page reads, five results per search, eight total tool calls, and a ninety-second web phase. These are backend-enforced limits. Parallel comparison targets have independent budgets: four targets can perform twelve searches with defaults. Failed requests consume admission counts; successful duplicate queries/URLs reuse the attempt's saved result without another network request. Repeating a tool call identifier is idempotent. Retry starts a new attempt and budget under the Batch's original policy. Limits count requests rather than billing credits. Provider usage is retained only when returned.

After tool exhaustion the model receives the available evidence and must finish with information gaps. The existing Generation deadline still bounds the overall run. Stop and browser expiry cancel admitted web requests. Models without compatible native tool calling report a failure; the user can switch models or turn the toggle off.

Service-driven models use the native chat-completion tool transcript. NearAI inference continues through the existing browser SDK and gateway protocols. Every intermediate tool response is verified before it can execute a web tool. Intermediate request/response proofs and transcripts remain in the local tool run. Final answer settlement uses the final response's receipt; intermediate prose is cleared before rendering the answer. Reasoning is replayed only inside the current tool loop and stays outside later Selected Answer context.

At most 120,000 extracted source characters and 16 MiB of original evidence bytes are retained per attempt. SQLite schema 22 stores settings, immutable per-attempt policy, bounded tool traces, original evidence bytes, and source snapshots. Assistant Messages retain their source snapshots, including older selected retries. Selected Answer context includes cited source text; branches copy their original bytes and traces independently of source deletion. API read models and exports exclude raw tool transcripts and intermediate verification evidence. Citation navigation and the References footer resolve only known snapshot sections, deduplicate sources in citation order, and expose capture type, original URL, and saved time. A valid citation identifies saved evidence; it does not prove that a claim follows from it.

## Compatibility and privacy

This extends the manual reading workflow in ADR 0042 and the file snapshot model in [ADR 0025](0025-snapshot-local-source-documents-for-file-chat.md). It supersedes the schema-21 storage assumption for automatic research; older services reject schema 22. Generated browser assets remain untracked.

Search queries go to the selected search service; page reads contact source websites. Their excerpts then enter the selected model transport. These external requests occur outside NearAI encrypted inference, and model receipt verification does not verify search evidence. Source content, queries, and tool proofs remain local conversation data and are removed with their owning history. Search connection settings and keys survive clearing conversation history until explicitly changed or removed.

Provider request contracts: [Tavily](https://docs.tavily.com/documentation/api-reference/endpoint/search), [Linkup](https://docs.linkup.so/pages/documentation/endpoints/search/reference), [Exa](https://exa.ai/docs/reference/search).
