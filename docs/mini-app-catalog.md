# Distributing Mini Apps

A standard Cove installation includes Japanese Review Book and Reading Inbox. Open Mini Apps in the Launcher to install either release. A browser session can also preview a personal package from disk. Personal and catalog releases have distinct identities. Importing the exact bytes of a bundled or recognized signed release preserves its verified origin. The installer reserves known catalog publishers, including Cove and the bundled Reading Inbox publisher. Existing personal instances keep their original local identity.

**Settings → Check for updates** compares the current instance with releases
in the configured directory. Cove downloads the signed index and checks
versions locally. Instance IDs, permissions and user records stay on the Mac.
The user reviews the latest compatible release and approves its permissions
before migration. Personal packages can be updated by importing a newer
version from their author.

## Build a CoveWeb directory

Run the catalog builder on the publishing machine with a private Ed25519 PEM key. Keep the private key outside source control and outside the static site.

```sh
node scripts/build-mini-app-catalog.mjs --sequence 42 /tmp/coveweb-site /secure/catalog-private.pem services/local-service/internal/appcatalog/packages/*.coveapp
```

The builder writes the catalog landing page, package detail pages under `apps/<publisher>/<app>/`, and `catalog.json` in a new output directory. Serve these files together over HTTPS. The signed format 2 envelope includes issuance time, an explicit positive integer sequence and expiration after 30 days. Use a persistent release counter such as a publishing workflow run number and increase `--sequence` for each index signed by the same key. Sequence ordering does not depend on the publishing machine clock. Rebuild and sign before expiration. Publish an updated index for deployments that still serve format 1. Each Mac remembers the latest accepted signed sequence. Unavailable, expired, conflicting and unverified indexes leave the bundled catalog usable and display a notice.

Version 1 hides custom directory settings in the user interface. Released builds
use the public catalog URL and verification key embedded at packaging time, or
bundled apps when no official catalog is configured. Development and acceptance
checks can set `COVE_APP_CATALOG_URL` and `COVE_APP_CATALOG_PUBLIC_KEY`; private
signing keys must stay outside the app and source control. Existing internal
preferences are preserved. The backend keeps authority confirmation, per-key
history and rollback checks for future directory configuration. The public
catalog never receives the instance inventory.

A release build can preconfigure the public directory. Pass `COVE_APP_CATALOG_DEFAULTS_FILE` to `scripts/package-macos.sh` with a JSON file containing only the public `url` and `public_key`. The build embeds these values in the signed app resources. Developers can supply defaults using `COVE_APP_CATALOG_URL` and `COVE_APP_CATALOG_PUBLIC_KEY`. Saved local settings take precedence. The repository supplies the static publisher and packaging integration. The production domain, hosting and signing authority belong to the release operator.

Each detail page has a version-specific Open in Cove link. The Launcher starts the local service, obtains a single-use browser launch token and opens the install preview. Confirmation checks the reviewed release digest. The signed payload includes the exact package bytes. The service rejects invalid signatures, redirected index requests and conflicting bytes for the same catalog version. An installed instance is loaded from the local database.

A bookmark for a local instance uses `cove://open/<instance-uuid>/<page-id>`. Its browser URL uses the current loopback port. Session credentials, grants, local record IDs and personal content do not belong in public catalog URLs.

## Signing authority changes

A directory selected by the user can publish its own application identities.
The publishers reserved by the bundled apps can only receive remote releases
signed by the public key embedded as the default distribution authority in
Cove. A custom key claiming a reserved publisher causes the remote index to
be rejected. The bundled apps remain available. Before a production release,
embed the official public key using the packaging option above.

Changing a directory URL under the same key retains its trust. Changing the
key requires an authenticated confirmation bound to the previously displayed
URL and key. A newly packaged default public key becomes the official authority
for that directory's new releases. Users with an explicit saved directory can
confirm the change through the development settings API. Historical rollback checkpoints
survive the change.

Each installed catalog release also pins the fingerprint of its actual signing
key. Changing the trusted directory does not transfer an installed app to another
authority: its upgrades require the same key. Transferring an already bound app to
a replacement key needs a future explicit identity-transfer contract; a normal
trust prompt cannot authorize that transfer. Catalog installations require an
explicit verified signer; publisher names alone cannot establish provenance.

The internal settings API distinguishes following Cove defaults, a pinned custom directory,
and bundled-only operation. **Use Cove defaults** removes the override after any
required signing-key confirmation. Saving a nonempty configuration identical to
the packaged defaults also keeps default tracking. Explicit bundled-only and
custom choices survive Cove updates.

Version and publisher histories are stored separately for each signing key.
Switching directories cannot make another signer's conflicting release block the
selected catalog. Returning to a signer retains its rollback checkpoint and its
own immutable-version history.

Successful verified indexes are cached in memory for up to thirty seconds,
bounded by their signed expiration. Importing a file absent from a successful
cache rechecks the signed index once, so a newly published release can be verified
immediately. Concurrent file checks share that refresh. A failed file refresh
preserves any still-valid verified index for Discover and known-release checks.
Missing-file checks retain bundled fallback entries and the warning separately
for five seconds, so an offline import does not repeat the remote timeout during
preview and installation. Ordinary directory failures use the same brief
fallback when no valid verified index remains. Cancelled requests do not populate
failure caches. Changing the URL or signing authority invalidates all caches.

Verification keys use canonical single-line base64. Pre-release aliases with
embedded line breaks are unsupported.

Installation is bound to the reviewed source. A catalog install supplies both the
entry's `digest` and `catalog_authority` (empty for bundled entries). A file
install first previews the exact bytes, then sends that response's release ID
and digest in `X-Cove-Release-ID` and `X-Cove-Package-Digest`. If the source,
signer, attestation, or bytes change between preview and installation, the host
returns 409 and requires a fresh review. Reusing identical bytes from another
signing authority does not transfer its update lineage.
