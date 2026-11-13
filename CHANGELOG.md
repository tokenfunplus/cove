# Changelog

## Unreleased

### Added

- Embed the NearAI Cloud verification center with local saved-details fallback, bounded report projection, theme support, and connection recovery.
- Add code-block language labels and clipboard success/failure feedback.
- Open verification details directly from message status labels, show gateway evidence from gateway shortcuts, and support keyboard navigation in local evidence tabs.

- Contributor guidance, an MIT license, security reporting instructions, and issue and pull request templates.
- Architecture, privacy, development, and release documentation.
- Repository checks, dependency maintenance configuration, and isolated local-service test data directories.
- Update manifests attached to GitHub release artifacts.

### Changed

- Disconnect slow event subscribers without blocking generation or cancellation.
- Expire abandoned browser Generations on the Local Service, including retries, while allowing grace for normal browser settlement.
- Run production browser acceptance in CI and retain its synthetic screenshots and accessibility evidence.
- Renamed the supplied Secure Chat / TBD application to Cove, including package names, bundle identifier, and local application namespace.
- Standardized project text and the interface on English while preserving Unicode conversation support.
- Made Keychain the default credential store; plaintext test storage is an explicit opt-in.
- Upgraded the NearAI inference SDK to 0.2.1 and refreshed affected build and test dependencies.
- Load the private inference SDK on demand and release its response cache after verification.
- Prevent stale busy errors while a completed generation finishes worker cleanup.
- Removed internal planning files, machine-specific documentation, unused translations, and checked-in production web bundles.

The first Cove release is planned as `0.1.0`. Cove uses a separate data directory and Keychain namespace from earlier TBD installations; no automatic data migration is performed.
