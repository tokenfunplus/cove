# Releasing Cove

## Local packages

On an Apple Silicon Mac:

```sh
pnpm install --frozen-lockfile
make check test
make dmg
make test-package-macos
```

Packaging builds web assets before Go, builds the Swift Launcher, assembles `Cove.app`, validates architecture and metadata, signs it, and creates a compressed DMG and SHA-256 checksum in `.artifacts/`. Keychain is the default in every build.

Without a signing identity, packages are ad-hoc signed. Gatekeeper may require explicit Finder approval. Acceptance fixtures use temporary data and explicitly opt into the test file Secret Store.

## Signed and notarized builds

For a local distributable build, set `COVE_RELEASE=1`, `COVE_SIGNING_IDENTITY`, `COVE_NOTARIZE=1`, and `COVE_NOTARY_PROFILE`. The identity and profile must already exist in the local keychain. Release mode rejects plaintext secrets and requires signing, notarization, stapling, and Gatekeeper validation.

The GitHub workflow uses repository variable `COVE_REQUIRE_NOTARIZATION` (default `0`). Set it to `1` for Developer ID signing and notarization and configure:

- `MACOS_DEVELOPER_ID_CERTIFICATE`: base64-encoded `.p12`
- `MACOS_DEVELOPER_ID_CERTIFICATE_PASSWORD`
- `MACOS_DEVELOPER_ID_IDENTITY`
- `APPLE_NOTARY_KEY`: base64-encoded `.p8`
- `APPLE_NOTARY_KEY_ID`
- `APPLE_NOTARY_ISSUER_ID`

Without notarization, the workflow still uses Keychain and produces ad-hoc signed artifacts. Imported certificate and notary files are removed during runner cleanup.

## Versioning and releases

1. Update root and workspace `package.json` versions and `apps/macos/Resources/Info.plist`. `CoveReleaseVersion` is the full version; `CFBundleShortVersionString` is its numeric base. Increment `CFBundleVersion` for an actual shipped build.
2. Move the relevant `CHANGELOG.md` entries into a dated release section.
3. Run checks, tests, and package acceptance. Review dependency advisories and bundled notices.
4. Push a matching `v<version>` tag when authorized to publish artifacts.
5. Review the draft GitHub Release, signing mode, checksum, notes, and `update.json` before publication.

Tags must match `CoveReleaseVersion`. Manual builds do not create a release. Prerelease tags produce prerelease drafts and are excluded from GitHub's latest stable release.

Releases attach a DMG, checksum, and `update.json` containing `version` and `download_url`. The manual **Check for Updates** action reads the latest stable manifest and opens a download page; it does not install updates. Forks should update `CoveUpdateManifestURL`, their bundle identifier, and repository links.
