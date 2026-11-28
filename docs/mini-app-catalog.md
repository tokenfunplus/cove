# Distributing Mini Apps

CoveWeb owns the public app catalog, package details, version browsing and official
downloads at `https://www.hicove.io/apps`. Local Cove owns **My apps**, file import,
installation review, permissions and the installed app workspace. Its **Browse
apps on CoveWeb** link opens the website. Local Cove does not provide a second
marketplace or send its instance inventory to the website.

Visitors can download a `.coveapp` or choose **Open in Cove** on a version-specific
public page. The Launcher hands that identity to the local installer, which opens
an exact installed copy, offers a copy chooser, or resolves the requested release
and shows installation review. Installed apps remain usable offline.

The host bundles reference releases of Japanese Review Book and Reading Inbox.
They provide offline package verification and developer examples. Importing exact
bundled or recognized signed bytes retains the verified origin; personal packages
keep their separate local identity. The installer reserves known catalog
publishers, including Cove and the bundled Reading Inbox publisher.

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

The separate CoveWeb Next.js project owns the production website presentation.
Import the builder's signed output there with:

```sh
pnpm apps:import --signed /tmp/coveweb-site/catalog.json --public-key BASE64_PUBLIC_KEY
pnpm apps:check
pnpm build
```

That import verifies the signature, validity period, sequence and immutable
versions before publishing exact package bytes. CoveWeb serves the signed index
at `/apps/catalog.json` and downloads at
`/apps/<publisher>/<app>/<version>.coveapp`. Its public pages expose **Open in
Cove**, without inferring local installation or update state. Packaging the same
official verification key and configuring the HTTPS index remain release
operator tasks. Curated bundled downloads can also be hosted without inventing a
signing authority. Mini Apps require a Cove build that includes this runtime;
the earlier Beta 14 download does not provide it.

The **Mini Apps → Release source** page shows read-only source information.
Version 1 uses the public URL and verification key packaged with Cove, or bundled
apps when no public source is configured. Custom directory editing is hidden.
Development checks can use `COVE_APP_CATALOG_URL` and
`COVE_APP_CATALOG_PUBLIC_KEY`; existing internal preferences remain intact.
The backend retains explicit authority confirmation, per-key histories and
rollback protection for future configuration support. Private signing keys stay
outside the app and source control.

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
for that directory's new releases. Existing internal overrides require confirmation through the development
settings API. Historical rollback checkpoints
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
preserves any still-valid verified index for local installation and update checks.
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
