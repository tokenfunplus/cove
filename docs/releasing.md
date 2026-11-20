# Releasing Cove

## Local packages

On an Apple Silicon Mac with Python 3.11 or later, install the pinned DMG build tools once:

```sh
python3 -m venv .artifacts/dmg-tools
.artifacts/dmg-tools/bin/python -m pip install -r scripts/dmg-requirements.txt
```

Then build and verify the package:

```sh
pnpm install --frozen-lockfile
make check test
make dmg
make test-package-macos
```

Packaging builds web assets before Go, builds the Swift Launcher, assembles `Cove.app`, validates architecture and metadata, signs it, and creates a compressed DMG and SHA-256 checksum in `.artifacts/`. Keychain is the default in every build.

The DMG opens in a compact icon view with Cove, an Applications shortcut, and a Retina installation background. Drag Cove to Applications, then open the installed app and look for its menu-bar icon. Both packaging paths use the same layout, generated without Finder automation. The pinned builder uses `hdiutil` for compatibility with macOS 15 CI runners. The app's signature is preserved when copying it into the image; final DMG signing and notarization happen after layout creation.

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

The current test release is `0.1.0-beta.6`, build `6`, with marketing version `0.1.0`. Use `make version VERSION=0.1.0-beta.7` to prepare the next beta. The command synchronizes the root and workspace package versions, `CoveReleaseVersion`, `CFBundleShortVersionString`, and `CFBundleVersion`. Omitting `BUILD` increments the existing build number; `BUILD=n` overrides it. Keep build numbers increasing for subsequent published packages.

Use `alpha.N`, `beta.N`, and `rc.N` suffixes for test releases, then the plain version for stable releases. Git tags add a `v` prefix, for example `v0.1.0-beta.6`. A prerelease is published with GitHub's prerelease flag and does not enter the stable `releases/latest` update feed. Updated Launchers offer explicit beta discovery from published GitHub releases, without changing the stable manifest or automatically installing updates. Beta and release-candidate versions are eligible for that action; alpha and draft releases are excluded. Older builds can use the Releases page.

1. Run the version command. `CoveReleaseVersion` is the full version; `CFBundleShortVersionString` is its numeric base.
2. Move the relevant `CHANGELOG.md` entries into a dated release section.
   Update the README's release link and package filename, and add matching notes under `docs/releases/`.
3. Run checks, tests, and package acceptance. Review dependency advisories and bundled notices.
4. Push a matching `v<version>` tag when authorized to publish artifacts.
5. Review the draft GitHub Release, signing mode, checksum, notes, and `update.json` before publication.

Tags must match `CoveReleaseVersion`. Manual builds do not create a release. Prerelease tags produce prerelease drafts and are excluded from GitHub's latest stable release.

Published tags and release artifacts are immutable. Correct a published package through a new version and build number rather than replacing an existing download.

### Detached release signatures

The [Release signatures workflow](../.github/workflows/release-signatures.yml) adds a `.sigstore.json` bundle for the published DMG, checksum file, and `update.json`. It runs when a release is published. To sign an existing published release, dispatch the workflow on `main` with its exact tag. Reruns verify existing bundles and never overwrite them. GitHub Actions uses OIDC for keyless signing; no signing key or additional repository secret is required.

The signer verifies each asset against GitHub's recorded digest, validates the DMG checksum and update destination, and rechecks the release before and after uploading new bundles. Do not edit release assets during signing: GitHub does not provide an atomic asset check and upload operation. A detected change fails the run and requires maintainer investigation; the signer does not repair a signature by replacing published files. It signs the final public bytes, including locally notarized packages. These are publisher signatures created after publication, not SLSA build provenance or a replacement for Apple signing and notarization. Existing releases receive only new detached bundles; their downloads and update manifests stay unchanged. See [ADR-0028](adr/0028-require-pr-checks-and-sign-published-downloads.md).

Download the asset and its matching bundle, then verify with Cosign 3:

```sh
cosign verify-blob \
  --bundle Cove-0.1.0-beta.6-arm64.dmg.sigstore.json \
  --certificate-identity-regexp '^https://github\.com/tokenfunplus/cove/\.github/workflows/release-signatures\.yml@refs/(heads/main|tags/v0\.1\.0-beta\.6)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  Cove-0.1.0-beta.6-arm64.dmg
```

For another release, update both filenames and the exact tag in the expected identity. Verification checks the artifact digest, signing identity, certificate, and transparency proof.

### Product website

The product page at https://tokenfunplus.github.io/cove/ is maintained separately in [tokenfunplus/tokenfunplus.github.io](https://github.com/tokenfunplus/tokenfunplus.github.io), under `docs/cove/`. GitHub Pages publishes that repository's `main` branch from `/docs`; Cove's own repository is not its Pages source.

After a release is published, align the website's release badge, download/checksum URLs, version, and feature descriptions with that release. Run the website's `make check`, review desktop and mobile layouts, and verify the live download links after its Pages deployment. Keep screenshots synthetic and record the source revision in the website README. Preserve the other product pages.

### Publishing a locally signed test package

A local release keeps signing private keys on the developer's Mac. Create a local Notary profile with `xcrun notarytool store-credentials cove-release-notary`, then build with `COVE_RELEASE=1`, `COVE_SIGNING_IDENTITY`, `COVE_NOTARIZE=1`, and `COVE_NOTARY_PROFILE=cove-release-notary`. Enter credentials in the tool's secure prompt. Never place credentials in release notes, shell history, or repository files.

When the local Swift toolchain cannot build the Launcher, manually dispatch the macOS Release workflow for the intended commit. Download its artifact, verify its checksum, mount the DMG read-only, and copy `Cove.app` to a local staging directory. The release workflow uses Keychain mode, whereas ordinary CI package fixtures enable plaintext test storage and must not be published. Finish a downloaded release app locally with:

```sh
export COVE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export COVE_NOTARY_PROFILE=cove-release-notary
scripts/notarize-macos-package.sh path/to/Cove.app .artifacts/notarized
```

This command checks the source app's identity, version, build number, architecture, binary deployment targets, license notices, and Secret Store mode. It signs the nested service and app, notarizes and staples the app, then creates, signs, notarizes, and staples the final DMG. Both artifacts must pass Gatekeeper assessment before the final checksum and update manifest are written. The command requires Command Line Tools, not a full Xcode installation, and leaves the source bundle unchanged.

After committing and pushing the matching version tag, wait for the release workflow to finish its checks and create a draft release. When CI signing is not configured, its draft artifacts are ad-hoc signed. Replace those draft artifacts with the locally signed, notarized DMG, its matching checksum, and `update.json` before publishing. Verify the uploaded bytes match the local checksum, preserve the prerelease flag, and publish only after the local package passes notarization, stapling, Gatekeeper, and installation acceptance. Do not upload private keys merely to publish a local package.

Releases attach a DMG, checksum, and `update.json` containing `version` and `download_url`. The manual **Check for Updates** action reads the latest stable manifest and opens a download page; it does not install updates. Forks should update `CoveUpdateManifestURL`, their bundle identifier, and repository links.
