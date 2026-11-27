# Distributing Mini Apps

A standard Cove installation includes Japanese Review Book and Reading Inbox. Open Mini Apps in the Launcher to install either release. A browser session can also preview a personal package from disk. Personal and catalog releases have distinct identities. The installer reserves the publisher `cove` for trusted distribution.

**Settings → Check for updates** compares the current instance with releases
in the configured directory. Cove downloads the signed index and checks
versions locally. Instance IDs, permissions and user records stay on the Mac.
The user reviews the latest compatible release and approves its permissions
before migration. Personal packages can be updated by importing a newer
version from their author.

## Build a CoveWeb directory

Run the catalog builder on the publishing machine with a private Ed25519 PEM key. Keep the private key outside source control and outside the static site.

```sh
node scripts/build-mini-app-catalog.mjs /tmp/coveweb-site /secure/catalog-private.pem services/local-service/internal/appcatalog/packages/*.coveapp
```

The output must be a new directory. The builder validates each artifact against the service runtime and writes public per-app pages in `apps/<publisher>/<app>/` plus a signed `catalog.json`. Serve this directory over HTTPS. Configure the Local Service environment (or the Launcher environment inherited by its service process) with `COVE_APP_CATALOG_URL` pointing to that exact index and `COVE_APP_CATALOG_PUBLIC_KEY` set to the base64 verification key printed by the builder. A default install uses bundled releases and requires no catalog connection. Publishing and distribution of production trust settings are separate release operations.

Each detail page has a version-specific Open in Cove link. The Launcher starts the local service, obtains a single-use browser launch token and opens the install preview. Confirmation checks the reviewed release digest. The signed payload includes the exact package bytes. The service rejects invalid signatures, redirected index requests and conflicting bytes for the same catalog version. An installed instance is loaded from the local database.

A bookmark for a local instance uses `cove://open/<instance-uuid>/<page-id>`. Its browser URL uses the current loopback port. Session credentials, grants, local record IDs and personal content do not belong in public catalog URLs.
