---
status: partially superseded by ADR-0018
---

> Historical decision. Current Cove identity and defaults are defined in [ADR-0018](0018-establish-cove-project-conventions.md).

# Allow an insecure file Secret Store for test packages

Ad-hoc-signed macOS test packages change code identity between builds, so reading Provider Keys from Keychain can repeatedly show an authorization prompt. Non-release packages and local development use an owner-only file Secret Store by default; the Launcher records the choice in the packaged Info.plist and starts the Local Service with `--insecure-file-secret-store`. Tests can opt back into Keychain with `TBD_INSECURE_FILE_SECRET_STORE=0`.

This mode stores Provider Keys as plaintext under the user's TBD Application Support directory with file permissions `0600`. `TBD_RELEASE=1` defaults to Keychain and packaging rejects explicitly enabling the file store for release builds, preserving Keychain as the only Secret Store for distributable releases.

The tagged GitHub release workflow explicitly sets `TBD_INSECURE_FILE_SECRET_STORE=0` even when notarization is disabled, so its draft DMG uses Keychain. Local and pull-request test packages continue to default to the file Secret Store.
