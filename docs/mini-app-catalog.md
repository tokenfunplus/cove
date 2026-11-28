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

The host does not embed application packages or app-specific business rules.
CoveWeb maintains app sources, scenario tests and immutable downloads. The host
retains only the identities and SHA-256 digests of five historical reference
releases. Those exact downloaded files keep their previous verified identity;
modified bytes never gain that identity. Existing installed packages, records,
attachments and grants remain owned by local Persistence.

**Settings → Check for updates** compares the current instance with releases
in the configured directory. Cove downloads the signed index and checks
versions locally. Instance IDs, permissions and user records stay on the Mac.
The user reviews the latest compatible release and approves its permissions
before migration. Personal packages can be updated by importing a newer
version from their author.

## Build a CoveWeb directory

Run the catalog builder on the publishing machine with a private Ed25519 PEM key. Keep the private key outside source control and outside the static site.

```sh
node scripts/build-mini-app-catalog.mjs --sequence 42 /tmp/coveweb-site /secure/catalog-private.pem services/local-service/internal/appcatalog/testdata/legacy-releases/*.coveapp
```

The builder writes the catalog landing page, package detail pages under `apps/<publisher>/<app>/`, and `catalog.json` in a new output directory. Serve these files together over HTTPS. The signed format 2 envelope includes issuance time, an explicit positive integer sequence and expiration after 30 days. Use a persistent release counter such as a publishing workflow run number and increase `--sequence` for each index signed by the same key. Sequence ordering does not depend on the publishing machine clock. Rebuild and sign before expiration. Publish an updated index for deployments that still serve format 1. Each Mac remembers the latest accepted signed sequence. Unavailable, expired, conflicting and unverified indexes fail closed. Installed applications remain usable offline.

The separate CoveWeb Next.js project owns the production website presentation.
Build and test its canonical app sources using the installed author CLI, then
sign on the publishing machine with a key outside both repositories:

```sh
pnpm apps:build --cli /path/to/coveapp --key /secure/catalog-private.pem --sequence 42
```

An independently prepared signed index can also be imported there with:

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

In the standalone **Mini Apps → Release source** page, enter the exact HTTPS index URL and the base64 Ed25519 verification key supplied by the publisher. Finder launches reuse these settings. Changing the signing key or clearing the directory opens a confirmation showing the new signing authority. After confirmation, Finder launches reuse that choice. Changing authorities preserves each key's highest accepted sequence, so returning to an earlier key still rejects rollback. Clearing the settings disables remote release lookup. The public catalog never receives the instance inventory.

A release build can preconfigure the public directory. Pass `COVE_APP_CATALOG_DEFAULTS_FILE` to `scripts/package-macos.sh` with a JSON file containing only the public `url` and `public_key`. The build embeds these values in the signed app resources. Developers can supply defaults using `COVE_APP_CATALOG_URL` and `COVE_APP_CATALOG_PUBLIC_KEY`. Saved local settings take precedence. The repository supplies the static publisher and packaging integration. The production domain, hosting and signing authority belong to the release operator.

Each detail page has a version-specific Open in Cove link. The Launcher starts the local service, obtains a single-use browser launch token and opens the install preview. Confirmation checks the reviewed release digest. The signed payload includes the exact package bytes. The service rejects invalid signatures, redirected index requests and conflicting bytes for the same catalog version. An installed instance is loaded from the local database.

A bookmark for a local instance uses `cove://open/<instance-uuid>/<page-id>`. Its browser URL uses the current loopback port. Session credentials, grants, local record IDs and personal content do not belong in public catalog URLs.

## Signing authority changes

A directory selected by the user can publish its own application identities.
The publishers reserved by the bundled apps can only receive remote releases
signed by the public key embedded as the default distribution authority in
Cove. A custom key claiming a reserved publisher causes the remote index to
be rejected. Installed apps remain available. Before a production release,
embed the official public key using the packaging option above.

Changing a directory URL under the same key retains its trust. Changing the
key requires an authenticated confirmation bound to the previously displayed
URL and key. A newly packaged default public key becomes the official authority
for that directory's new releases. Users with an explicit saved directory can
review and confirm it through Release source. Historical rollback checkpoints
survive the change.

Each installed catalog release also pins the fingerprint of its actual signing
key. Changing the trusted directory does not transfer an installed app to another
authority: its upgrades require the same key. Transferring an already bound app to
a replacement key needs a future explicit identity-transfer contract; a normal
trust prompt cannot authorize that transfer. Legacy releases without a stored
signer remain usable but do not infer an author through an upgrade. Their exported
data may be restored as a separate disabled copy after the exact package is
independently verified from one unambiguous source.

Preferences from earlier versions reverify their cached release identities
under these publisher rules before downloaded files gain catalog provenance.
Installed app records and package bytes have their independent local ownership.

Release source distinguishes following Cove defaults, a pinned custom directory,
and local-only operation. **Use Cove defaults** removes the override after any
required signing-key confirmation. Saving a nonempty configuration identical to
the packaged defaults also keeps default tracking. Explicit local-only and
custom choices survive Cove updates. Legacy explicit settings remain pinned until
the user chooses to follow defaults.

Version and publisher histories are stored separately for each signing key.
Switching directories cannot make another signer's conflicting release block the
selected catalog. Returning to a signer retains its rollback checkpoint and its
own immutable-version history. Ambiguous legacy histories are reverified without
discarding existing rollback checkpoints or changing instance data.

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

New verification keys use canonical single-line base64. Earlier persisted aliases
of the same Ed25519 key are normalized when preferences are opened. Their highest
rollback checkpoint is retained, and conflicting same-sequence indexes or package
versions remain rejected; normalization never blesses an arbitrary alias's bytes.

Installation is bound to the reviewed source. A catalog install supplies both the
entry's `digest` and `catalog_authority` (empty for bundled entries). A file
install first previews the exact bytes, then sends that response's release ID
and digest in `X-Cove-Release-ID` and `X-Cove-Package-Digest`. If the source,
signer, attestation, or bytes change between preview and installation, the host
returns 409 and requires a fresh review. Reusing identical bytes from another
signing authority does not transfer its update lineage.
