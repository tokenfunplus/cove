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

In the standalone **Mini Apps → Catalog settings** page, enter the exact HTTPS index URL and the base64 Ed25519 verification key supplied by the publisher. Finder launches reuse these settings. Changing the signing key or clearing the directory opens a confirmation showing the new signing authority. After confirmation, Finder launches reuse that choice. Changing authorities preserves each key's highest accepted sequence, so returning to an earlier key still rejects rollback. Clearing the settings switches to bundled releases only. The public catalog never receives the instance inventory.

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
URL and key. This supports an operator's explicit key rotation or a switch to
a different directory. A newly packaged default public key becomes the official
release authority. Users with an explicit saved directory can review and confirm
that key through Catalog settings. Historical rollback checkpoints survive the
change.

Preferences from earlier versions reverify their cached release identities
under these publisher rules before downloaded files gain catalog provenance.
Installed app records and package bytes have their independent local ownership.

Successful verified indexes are cached in memory for up to thirty seconds,
bounded by their signed expiration. Changing the URL or signing authority
invalidates that cache. Failed and cancelled requests never populate it.
