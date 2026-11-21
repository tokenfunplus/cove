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
| Submitted webpage bytes, source URLs, read time, and extracted text | Local SQLite source snapshots; extracted text and metadata also enter model input and exports |
| NearAI encrypted protocol traffic | Fixed NearAI staging service, through the Local Service |
| Intel TDX verification collateral | `https://pccs.phala.network` |
| NVIDIA attestation evidence | `https://nras.attestation.nvidia.com`, through a fixed local proxy |
| Selected verification metadata when opening verification details | `https://cloud-stg.near.ai/verify`, in an embedded viewer |
| Manual update check | Cove's GitHub release manifest |
| Markdown or JSON exports | Files downloaded to your device |
| Favorite/recent model IDs, named model combinations, and manual cost rates | Browser-local preferences for the Local Service address; no Provider Keys or conversation text |
| Debate summaries, budget controls, and debate-specific cost rates | Local SQLite database; public statement excerpts go to the selected summary model when a summary is due |
| Formula typesetting, fonts, and model brand icons | Bundled application assets; rendering makes no remote request |

Side Conversations send only the selected passage and their own selected history, together with the workspace System Prompt, to the active Providers. Workbench revision requests send the current working draft, editing request, and optional selected passage. Both requests and their completed answers are saved as separate local conversations. Merely opening a tool or editing a draft makes no Provider request.

Working Drafts and undo history stay in window memory; they are lost on reload unless downloaded or copied. General model pricing preferences stay browser-local. Rates explicitly saved with a debate are copied into its local record so the Local Service can enforce estimated budgets while the page is closed. Stage summaries use public answers only, with an additional call to a selected participant model. Generation Metrics contain timing observations and optional Provider-reported token counts; they are not billing receipts or independently verified performance evidence.

Structured Provider reasoning is retained locally and in exports, but is excluded from later selected-answer context. Older text containing explicit reasoning tags retains its original saved body and context behavior. Collapsing a Reasoning section changes presentation only.

Editing and resending a saved prompt creates an independent conversation with copied selected context and original source snapshots. Current model, System Prompt, and generation settings determine the new request. Deleting the source conversation does not delete the branch's retained copies; remove each conversation when clearing that content. Copied verification records describe the original responses and do not represent new verification of the branch.

Cove has no account, cloud conversation store, or synchronization service. Remote providers still receive information. Custom local providers use loopback HTTP; other custom endpoints require HTTPS.

## Local storage

Cove does not encrypt its SQLite database or exports. Filesystem permissions and operating-system protections such as FileVault govern access at rest. Deleting history does not delete provider records, backups, or exports, and is not a secure-erasure guarantee.

After a successful Keychain authorization, the Local Service reuses that Provider Key in process memory until it exits, rotates the key, deletes it, or observes that the Keychain item is absent. Concurrent requests share the initial read. A key changed outside that running service may require a restart before ordinary requests use the new value. This avoids repeated system authorization dialogs without changing Keychain access controls or copying keys to browser storage. See [authorized Keychain reads](adr/0026-reuse-authorized-keychain-reads-without-passive-retries.md).

Attachment and draft-context previews are parsed locally without contacting a Provider or persisting the draft. Accepted file turns save the original bytes and immutable extracted text; removing their conversation or clearing history removes these records. Markdown and JSON exports include extracted text and source metadata, so handle them like the conversation itself. Draft attachments are lost on navigation or reload. Source citations open saved text; they do not independently verify the document or the answer.

`COVE_INSECURE_FILE_SECRET_STORE=1` stores keys as plaintext in an owner-only test file. It is disabled by default and rejected when `COVE_RELEASE=1`. The service warns when this mode is used.

Cove's namespace is `io.github.tokenfunplus.cove`; earlier TBD data and Keychain entries are not automatically migrated.

## Verification claims

Supported NearAI models can use browser-side end-to-end encryption and hardware attestation. Availability depends on the model's advertised mode. A model TEE receipt, a gateway receipt, and an unverified ordinary response are distinct results.

Browser Fetch does not expose the remote TLS peer certificate. The browser path does not pin that certificate against an attested fingerprint. HTTPS alone does not prove confidential model execution.

Saved evidence is historical. Opening its details does not automatically rerun cryptographic verification. The Local Service accepts completion records from the authenticated browser and does not independently repeat all SDK cryptography. A modified browser or compromised local account can falsify local records; persisted labels are not third-party-verifiable audit certificates.

The embedded NearAI viewer displays Cove's supplied report rather than independently verifying it. It receives model/completion identifiers, signer metadata, measurement hashes, and supported hash-only response receipts. Provider Keys, chat content, raw evidence, and deployment configuration are excluded. Saved local details remain available if the remote viewer is unavailable. See [ADR-0023](adr/0023-embed-nearai-verification-reports.md).

## Provider integration and dependencies

The NearAI SDK is pinned to `0.2.1`. The preset still uses a staging endpoint. Treat provider integration as dependent on upstream availability and explicit verification results rather than a blanket confidentiality promise.

The SDK transitively includes `elliptic`, which has an unresolved low-severity advisory, [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84).

Review `pnpm audit` and the resolved dependency graph before releases. Do not replace cryptographic dependencies through untested overrides simply to silence an audit.

## Reporting problems

Follow [SECURITY.md](../SECURITY.md). Use synthetic content and remove credentials, launch URLs, tokens, and personal information from reports and screenshots.

## Automatic Web search

The globe toggle authorizes compatible models to choose search queries and public page URLs during an answer. Queries go to the configured Tavily, Linkup, or Exa service; page requests contact the source website. These requests occur outside NearAI encrypted inference. Excerpts then enter the selected model transport. Model verification does not establish the accuracy of external evidence.

Search keys stay in macOS Keychain and are absent from browser responses and exports. Testing a key sends one search request. Per-attempt limits count admitted requests, including failures, and do not cap provider billing credits. Successful duplicate queries reuse local evidence. Queries, source text, timestamps, tool transcripts, and intermediate NearAI proofs remain in local conversation storage; deleting history removes those records. Search settings and keys remain until explicitly changed or removed. The browser remembers per-conversation toggle choices using identifiers and booleans only.
