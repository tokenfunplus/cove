# Privacy and trust model

## Where information goes

| Information | Location or destination |
| --- | --- |
| History, settings, snapshots, completed verification records | Local SQLite database under `~/Library/Application Support/cove/` |
| Structured reasoning, Generation Metrics, and edited-prompt branches | The same local SQLite database; completed assistant reasoning remains separate from the answer body |
| Submitted original files and extracted source text | The same local SQLite database; original bytes are excluded from conversation exports |
| Provider Keys | macOS Keychain by default |
| Prompt, System Prompt, selected context, generation parameters | Configured model provider |
| Attached source text | Selected Providers, as part of the prompt and later selected context; original file bytes stay local |
| Explicit webpage reading | The supplied website and its public redirects receive a credential-free HTTP request from your Mac |
| Prepared webpage text and metadata | Bounded Local Service memory until release or service exit; preview tokens become unavailable after fifteen minutes |
| Unsent Ask Cove selections | Launcher and Quick Panel memory |
| Submitted webpage bytes, source URLs, read time, and extracted text | Local SQLite source snapshots; extracted text and metadata also enter model input and exports |
| NearAI encrypted protocol traffic | Fixed NearAI production service (`https://cloud-api.near.ai`), through the Local Service |
| Intel TDX verification collateral | `https://pccs.phala.network` |
| NVIDIA attestation evidence | `https://nras.attestation.nvidia.com`, through a fixed local proxy |
| Selected verification metadata when opening verification details | `https://cloud-stg.near.ai/verify`, in an embedded viewer |
| Manual update check | Cove's GitHub release manifest |
| Markdown or JSON exports | Files downloaded to your device |
| Favorite/recent model IDs, named model combinations, and manual cost rates | Browser-local preferences for the Local Service address; no Provider Keys or conversation text |
| Debate summaries, budget controls, and debate-specific cost rates | Local SQLite database; public statement excerpts go to the selected summary model when a summary is due |
| Formula typesetting, fonts, and model brand icons | Bundled application assets; rendering makes no remote request |

Side Conversations send the selected passage, question and their own selected history, together with the workspace System Prompt, to the active Providers. Workbench revision requests send the current working draft, editing request, and optional selected passage. These separate conversations inherit their source conversation's current Project when created. If assigned to a Project, each new Batch also sends a snapshot of that Project's instructions, background and fixed sources to every selected Provider. This does not copy the source conversation's full history. Both requests and their completed answers are saved as separate local conversations. Merely opening a tool or editing a draft makes no Provider request.

Working Drafts and undo history stay in window memory; they are lost on reload unless downloaded or copied. General model pricing preferences stay browser-local. Rates explicitly saved with a debate are copied into its local record so the Local Service can enforce estimated budgets while the page is closed. Stage summaries use public answers only, with an additional call to a selected participant model. Generation Metrics contain timing observations and optional Provider-reported token counts; they are not billing receipts or independently verified performance evidence.

Structured Provider reasoning is retained locally and in exports, but is excluded from later selected-answer context. Older text containing explicit reasoning tags retains its original saved body and context behavior. Collapsing a Reasoning section changes presentation only.

Editing and resending a saved prompt creates an independent conversation with copied selected context and original source snapshots. Current model, System Prompt, and generation settings determine the new request. Deleting the source conversation does not delete the branch's retained copies; remove each conversation when clearing that content. Copied verification records describe the original responses and do not represent new verification of the branch.

Cove has no account, cloud conversation store, or synchronization service. Remote providers still receive information. Custom local providers use loopback HTTP; other custom endpoints require HTTPS.

## Local storage

Cove does not encrypt its SQLite database or exports. Filesystem permissions and operating-system protections such as FileVault govern access at rest. Deleting history does not delete provider records, backups, or exports, and is not a secure-erasure guarantee.

After a successful Keychain authorization, the Local Service reuses that Provider Key in process memory until it exits, rotates the key, deletes it, or observes that the Keychain item is absent. Concurrent requests share the initial read. A key changed outside that running service may require a restart before ordinary requests use the new value. This avoids repeated system authorization dialogs without changing Keychain access controls or copying keys to browser storage. See [authorized Keychain reads](adr/0026-reuse-authorized-keychain-reads-without-passive-retries.md).

Attachment and draft-context previews are parsed locally without contacting a Provider or persisting the draft. Accepted file turns save the original bytes and immutable extracted text; removing their conversation or clearing history removes these records. Markdown and JSON exports include extracted text and source metadata, so handle them like the conversation itself. Draft attachments are lost on navigation or reload. Source citations open saved text; they do not independently verify the document or the answer.

Ask Cove receives the plain-text selection that the source app supplies to macOS Services when the user invokes it. The Quick Panel displays the execution destination before Send. Only on this Mac applies the same restrictions to imported and typed drafts.

`COVE_INSECURE_FILE_SECRET_STORE=1` stores keys as plaintext in an owner-only test file. It is disabled by default and rejected when `COVE_RELEASE=1`. The service warns when this mode is used.

Cove's namespace is `io.github.tokenfunplus.cove`; earlier TBD data and Keychain entries are not automatically migrated.

## Local models and document retrieval

Installing BGE or Qwen contacts Hugging Face and its download infrastructure for pinned weights. Document contents and queries are not part of these downloads. After installation, embedding inference, local search, and the managed `On this Mac` chat Provider run on your Mac without a Provider Key or remote inference request.

Library originals and versioned vector indexes are stored in the local SQLite database without additional encryption; weights are separate files under the local data directory. Search covers only the documents you explicitly select. Choosing results for chat creates snapshots of their original line/page sections. A remote chat Provider receives those selected sections through its normal transport. Local processing does not change the destination of a separately selected remote Provider.

Deleting a library document removes its original, vectors, and pending result tokens. Saved conversation snapshots remain until those conversations are removed. Removing the embedding model deletes indexes but keeps library originals. Clearing chat data removes the library and conversation snapshots while retaining installed model weights. Source citations navigate to saved original sections and do not certify the model's claims.

Project materials marked Search when needed are indexed within their Project and excluded from fixed Project input. Search results enter a turn only after explicit selection. Their originals stay in the Project blob store; accepted chat attachments retain independent copies. The execution line distinguishes where search runs from where each answer is generated.

Only on this Mac restricts new chat and answer-tool inference to managed local models and blocks Web Research and external webpage preparation. The service validates the submitted policy and saves it with the Batch for retries. Explicit installation downloads and separately running Debate sessions remain outside this chat-specific restriction.

## Verification claims


Supported NearAI models can use browser-side end-to-end encryption and hardware attestation. Availability depends on the model's advertised mode. A model TEE receipt, a gateway receipt, and an unverified ordinary response are distinct results.

Browser Fetch does not expose the remote TLS peer certificate. The browser path does not pin that certificate against an attested fingerprint. HTTPS alone does not prove confidential model execution.

Saved evidence is historical. Opening its details does not automatically rerun cryptographic verification. The Local Service accepts completion records from the authenticated browser and does not independently repeat all SDK cryptography. A modified browser or compromised local account can falsify local records; persisted labels are not third-party-verifiable audit certificates.

The embedded NearAI viewer displays Cove's supplied report rather than independently verifying it. It receives model/completion identifiers, signer metadata, measurement hashes, and supported hash-only response receipts. Provider Keys, chat content, raw evidence, and deployment configuration are excluded. Saved local details remain available if the remote viewer is unavailable. See [ADR-0023](adr/0023-embed-nearai-verification-reports.md).

## Provider integration and dependencies

The NearAI SDK is pinned to `0.2.1`. The preset uses the production endpoint `https://cloud-api.near.ai`; existing staging presets follow the compatibility rule in [ADR 0070](adr/0070-use-nearai-production-preset-endpoint.md). Treat provider integration as dependent on upstream availability and explicit verification results rather than a blanket confidentiality promise.

The SDK transitively includes `elliptic`, which has an unresolved low-severity advisory, [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84).

Review `pnpm audit` and the resolved dependency graph before releases. Do not replace cryptographic dependencies through untested overrides simply to silence an audit.

## Reporting problems

Follow [SECURITY.md](../SECURITY.md). Use synthetic content and remove credentials, launch URLs, tokens, and personal information from reports and screenshots.

## Automatic Web search

The globe toggle authorizes compatible models to choose search queries and public page URLs during an answer. Queries go to the configured Tavily, Linkup, or Exa service; page requests contact the source website. These requests occur outside NearAI encrypted inference. Excerpts then enter the selected model transport. Model verification does not establish the accuracy of external evidence.

Search keys stay in macOS Keychain and are absent from browser responses and exports. Testing a key sends one search request. Per-attempt limits count admitted requests, including failures, and do not cap provider billing credits. Successful duplicate queries reuse local evidence. Queries, source text, timestamps, tool transcripts, and intermediate NearAI proofs remain in local conversation storage; deleting history removes those records. Search settings and keys remain until explicitly changed or removed. The browser remembers per-conversation toggle choices using identifiers and booleans only.

## Shared project input

Project Instructions, Project Background and all current fixed Project Sources are included in each new project turn and sent to every selected model Provider through its existing transport. The composer and context inspector show this input before submission. It consumes context and can increase usage. NearAI verification covers its existing inference evidence, not the truth of project reference data. Explicitly reading a fixed webpage contacts that website outside encrypted inference.

Project data, extracted sections and original-byte blobs are stored unencrypted in local SQLite. Saved Batches retain independent text snapshots and references to shared original bytes. Removing a live source or editing a Project affects new turns; historical snapshots remain until their owning history is deleted. Clearing chat history retains live Projects and fixed sources. Dissolving a Project preserves its Conversations. Deleting current Project members can leave snapshots in Conversations previously moved or branched elsewhere; confirmations explain those retained copies. External exports, backups and Provider-held content are outside local deletion.

Local read aloud sends assistant text to local speech workers only. They inherit no Provider Keys and use installed local model/voice paths. Installing models contacts their public download source. Audio is temporary, browser-session owned, never stored in conversation history, and removed on Stop, relevant deletion, expiry, or restart. Explicit WAV downloads remain in the chosen destination. See [Local speech](local-speech.md) for limits and lifecycle details.
