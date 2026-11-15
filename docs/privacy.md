# Privacy and trust model

## Where information goes

| Information | Location or destination |
| --- | --- |
| History, settings, snapshots, completed verification records | Local SQLite database under `~/Library/Application Support/cove/` |
| Submitted original files and extracted source text | The same local SQLite database; original bytes are excluded from conversation exports |
| Provider Keys | macOS Keychain by default |
| Prompt, System Prompt, selected context, generation parameters | Configured model provider |
| Attached source text | Selected Providers, as part of the prompt and later selected context; original file bytes stay local |
| NearAI encrypted protocol traffic | Fixed NearAI staging service, through the Local Service |
| Intel TDX verification collateral | `https://pccs.phala.network` |
| NVIDIA attestation evidence | `https://nras.attestation.nvidia.com`, through a fixed local proxy |
| Selected verification metadata when opening verification details | `https://cloud-stg.near.ai/verify`, in an embedded viewer |
| Manual update check | Cove's GitHub release manifest |
| Markdown or JSON exports | Files downloaded to your device |

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
