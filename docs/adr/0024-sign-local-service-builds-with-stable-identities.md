# Sign local service builds with stable identities

Every macOS `make build-service` invocation signs and verifies the compiled Local Service with the fixed identifier `io.github.tokenfunplus.cove.local-service`. This also covers `make start-local`, which already builds through that target. `COVE_SIGNING_IDENTITY` explicitly selects a certificate name or fingerprint. Otherwise, the build selects a single valid Developer ID Application identity, falling back to a single Apple Development identity only when no Developer ID candidate exists. Ambiguous selections fail with an instruction to choose an identity explicitly.

When neither identity type is available, the build preserves ad-hoc development support. An explicit `COVE_SIGNING_IDENTITY=-` selects that mode for fixtures. Once a certificate is selected, signing and verification failures stop the build rather than silently replacing its identity with an ad-hoc signature. Non-macOS builds do not invoke signing tools.

Local certificate-backed builds enable Hardened Runtime and omit secure timestamps so repeated builds work offline. The certificate and private key remain in the operating-system keychain. No signing identity, private key, or credential is embedded in tracked configuration. This extends the local build conventions in ADR-0018; distribution signing and notarization remain governed by ADR-0016 and the existing packaging workflow.

A stable certificate-backed designated requirement lets Keychain recognize successive builds as the same service. It does not rewrite existing Provider Key access controls. Migrating from the old ad-hoc identity can require one authorization update before later builds inherit trust.
