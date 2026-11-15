# Reuse authorized Keychain reads without passive retries

The Local Service reuses a successfully authorized Provider Key in process memory for the lifetime of its KeychainStore. Concurrent reads for the same Provider share one in-flight result, including an authorization failure. A failed read is not cached as a usable credential, so a later explicit request can recover after the user grants access. Waiting callers may cancel independently of the native authorization operation.

Native reads, replacement, and deletion are serialized so a read cannot repopulate stale cache data after a mutation. Rotation bypasses the cache for its version comparison and post-write verification, preserving detection of changes made by another Local Service. Only a verified replacement is cached. Deletion evicts the cached credential even if native deletion fails; a metadata-only existence check that reports a missing item also evicts it. No keys are added to browser caches, API read models, exports, or local plaintext storage by this policy.

The cache is scoped to one running service. Changes made to an existing Keychain item outside that service can require a Local Service restart to be picked up by ordinary reads. Local rotation and deletion invalidate the cache immediately. This extends the Keychain storage behavior described in the privacy model without changing the operating system's item access controls or persistence format.

Provider catalog queries disable automatic retries, window-focus refresh, and reconnect refresh. Successful catalogs remain fresh for five minutes. Closing an authorization dialog must not initiate another Keychain read merely because browser focus changed. A successful explicit connection test using an existing saved key invalidates that Provider's catalog so a previously denied read can recover. Testing an unsaved replacement key does not treat it as persisted configuration.

This complements ADR-0024: real Keychain-backed development sessions should keep a stable certificate-backed service identity. Ad-hoc identities change across binary rebuilds and cannot preserve Keychain trust across versions. Reusing an authorized in-process key reduces repeated reads within a run; it does not replace stable signing or grant access to an unapproved Keychain item. Existing items may still require an authorization update when moving between signing identities.

## Considered options

- Retry Keychain-backed catalog requests on focus or reconnect: rejected because dismissal or denial can turn into repeated system prompts.
- Verify key rotation from the cached value: rejected because it can miss external changes and falsely report a successful write.
- Change Keychain ACLs to trust arbitrary executables or switch to a plaintext store: rejected because repeated prompts are an authorization/lifecycle issue, not a reason to weaken storage protections.
