# Mini App acceptance

The local Mini App platform was reviewed against the design proposal, demo and
fourth- and fifth-round review reports. The original walkthrough used runtime
commit `58986ad` with test commit `e1d392c`. The newer PR review follow-up below
records the subsequent runtime changes and their own rebuilt-service checks;
the earlier screenshots remain as historical evidence.

## Verified behavior

A browser-authored Idea Notebook was published through a local test publisher
using the repository's real catalog builder. The publisher retained immutable
releases and signed the catalog with Ed25519. The browser downloaded the exact
signed package bytes. The original integration walkthrough covered 1.0.0 to
1.1.0; the post-review run covered a signer-bound 1.0.0 copy updated manually to
1.2.0. Publishing and downloading alone did not update the installed copy.

All fourteen post-review checks passed: the instance and name were retained;
the version advanced; all three records, their IDs and original fields survived;
the migration added the archive field and advanced revisions once; attachments
and previous grants remained; new Chat access and cloud access stayed off; the
signer remained the same; and the earlier development copy was unchanged. The
attachment downloaded after the update matched its original bytes. The final
package was restarted against the same isolated data and both copies' exports
remained identical. The new Archive action was verified through its preview
and confirmation flow.

Japanese Review Book was also installed and used directly in the browser. A
three-card session revealed the answer to `What does ねこ mean?`, previewed a
learned outcome and saved it after confirmation. All three questions remained;
one became learned and two remained due. This run enabled only local record
reading and writing, with cloud access off.

## Checks

| Check | Result |
| --- | --- |
| `make check` | Passed: repository conventions, formatting, Go vet and TypeScript |
| Full Go `-race` suite | Passed |
| Web unit and interaction tests | 867 passed across 127 files; no unhandled errors |
| API contract tests | 138 passed |
| Script tests | 54 passed, 3 skipped |
| Apple Silicon package and Swift release build | Passed; local ad-hoc signing |
| Swift XCTest on macOS CI | Passed; local execution still requires full Xcode |
| Mini App browser acceptance | Passed: market, permissions, instances, upgrades, study, authoring and scrolling |
| App conversation and history acceptance | Passed: discovery, proposals, confirmed writes and Back/Stay/Leave/Forward |
| Existing Chat browser acceptance | Passed: comparison, context, retry/stop, PDF, history, export, Provider lifecycle, responsive layout and accessibility |
| Browser runtime exceptions in the reviewed suites | Zero |
| Native `--os-handoff` | Passed: cold URL event restored the saved instance; system handler unchanged |
| Native compatible endpoint fixture | Passed: generated and saved two synthetic questions |
| Native real Cove-managed Qwen model | Passed: generated two questions and saved both locally |
| Browser real Cove-managed Qwen model | Passed: two candidates reviewed, question wording corrected, previewed and saved |
| Actual local signed-market walkthrough | Passed: create, publish, download, use, publish another version and confirm update |
| Independent public-contract authoring | Passed again: fresh public-kit-only author, two packages and recorded CLI scenarios |

Browser and native integration checks used disposable local data. Compatible
Provider fixtures verify transport and ownership; they do not measure model
quality or make paid inference requests. The local market service adds its
explicit test CA in an ignored test-only build overlay. The packaged production
service does not contain that overlay.

## Review fixes

- Releases persist their catalog signing authority. A different signer cannot
  update an existing copy. Custom directories and publisher IDs are labeled
  explicitly. Legacy key aliases preserve rollback checkpoints.
- Failed remote directory requests briefly reuse the bundled fallback. A slower
  failed request cannot overwrite a newer verified cache. Unchanged settings
  preserve default-directory tracking.
- Unsaved model results can be retried or explicitly discarded. Discard stores
  cancellation before releasing other App tasks and preserves saved data. Failed
  recovery remains visible, and Activity identifies the blocking app.
- Browser delivery shares one bounded retry policy. Debate attempts terminal
  cleanup independently of an aborted inference; an accepted verified answer
  cannot be replaced by that cleanup. Mini Apps retain their paid-result
  recovery behavior.
- Proposed non-default options are visible. Refreshed stale targets retire their
  write form with an explanation. Version selection replaces history, and an
  unavailable requested release is reported explicitly.
- First-party workspace Back/Forward protects drafts and active generation
  without replacing the target entry. Unknown legacy history uses the
  conservative fallback documented in ADR-0073.
- Native app-open failures are reported, and UTF-8 file selection includes JSON,
  YAML and HTML. Shared Chat selection and attachment behavior was regression
  tested.

## PR 69 and fifth-round review follow-up

The fourteen inline review findings were fixed with regressions for package
provenance, grants, task release binding, native target identity, deterministic
migrations and dates, proposal parsing, practice selection, draft protection,
history traversal, and accepted Debate receipts. Confirmations now render above
App and study dialogs and restore focus to their opener. App receipt delivery
retains eight sends with 7.1 seconds of backoff and an independent two-second
deadline for each settlement; Debate keeps its existing policy.
Study writes keep their dialog open while pending. Explicit new-copy intent and
catalog Installed/Open actions retain the selected version and authority.

The final follow-up runtime and browser tests are commit `9d5951b`. Its immutable
production Local Service SHA-256 is
`553ac80e48d63945b48de4d2ca7e7b072909eb722e9940ce3e2c7d9780391fdb`.
The follow-up adds no database migration beyond schema 32.

A fresh independent Codex sub-agent received only the packaged public authoring
kit and CLI. It authored Travel Phrasebook 1.0 and 1.1 without host source or
history access. Eleven public CLI checks passed on the first attempt, including
23- and 32-step fresh scenarios and an eight-before/sixteen-after upgrade
scenario. The exact delivered packages, scenarios, material hashes and process
are retained in [the independent author record](mini-app-independent-authoring.md).
The Node script suite now runs those public conformance checks as a regression.

A new visible-browser walkthrough used disposable local data and the real
signed-catalog builder. The browser created and downloaded the authored package,
published 1.0, downloaded it from the generated market, and verified its catalog
source before installation. It saved a Japanese travel phrase, published 1.1,
downloaded it, and explicitly updated the existing copy. All three IDs and old
fields survived, revisions advanced exactly once, new defaults were added, and
name, instance ID, grants and signer stayed unchanged. Cloud access stayed off.
With an additional older copy present, **Create another copy** still reviewed a
new copy with every grant off. Restart preserved all three instance exports
byte for byte. A further immediate-publication check warmed catalog sequence 3,
published version 1.3 as sequence 4, downloaded it and reached signed installation
review in 3.33 seconds. Import refreshed the successful catalog cache for the
new digest without a waiting workaround. The confirmed 1.1 to 1.3 update retained
all record bytes and revisions, name, instance, permissions and signer. The
separate older copy remained unchanged. The cache fix has API regressions for
the immediate install, failed refresh backoff and personal-package provenance.
Canceled refresh owners also release live waiters to re-evaluate the current
cache, including a newer verified index fetched by another request.

A final browser-authored 1.4 release was published as sequence 5 after warming
the prior catalog. Its downloaded bytes matched the authored package exactly;
signed update review was reached in 3.677 seconds. The 1.3 to 1.4 confirmation
retained all record bytes, IDs and revisions. The app's own **Stumbled** outcome
then previewed and saved one error and a next-day due date for exactly one phrase.
The updated copy, that authored rule result, the older copy and all seven Japanese
questions survived the final service restart. The earlier 1.0 to 1.1 check remains
the additive-schema migration evidence.

Japanese Review Book retained all three original questions after marking one
learned. A clearly labeled compatible loopback fixture then returned two
Japanese greeting questions. The user reviewed both candidates and confirmed
the write; the library held five questions with every original ID preserved.
The five questions remained after restart. A subsequent real Qwen2.5 0.5B test
used the pinned `qwen-small-chat` asset, SHA-256
`74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`.
Both the native `--managed` harness and browser generation passed. Browser
generation used **Only on this Mac** with cloud access off. The model returned
two answer words matching the supplied Japanese vocabulary, but phrased the
questions as requests for Japanese names while providing English answers. Both
question fields were corrected in the candidate editor before preview and
confirmation. This is an observed quality limit of the small model, not evidence
that generated study material is automatically correct. The library held seven
questions afterwards, with every original ID retained. Restarting the final
service preserved all three instance exports byte for byte, including these
seven questions and the updated phrasebook.

New real-browser checks cover nested discard confirmations, guarded Activity
navigation with a draft, pointer hit testing, focus containment/restoration,
rapid fragment pushes, superseded history restoration, and per-entry Mini Apps
scroll restoration with user-scroll cancellation. With the Navigation API
disabled, the browser also passed coalesced and interleaved event ordering,
forward-tail truncation, intermediate fragment traversal, and page reload with a
new unsent draft. These checks preserve exact Apps entries and history length.
The same production
build also passed the original Chat browser suite with no runtime exceptions.
The isolated test publisher trusts its own CA through an ignored overlay; the
normal application build does not include that overlay or signing keys.

## Compatibility and remaining acceptance

This branch uses database schema 32. Main-branch services with an older schema
reject that database. Earlier unreleased schema-32 development snapshots do not
implement signer binding and are not supported downgrade targets.

Old catalog instances without a recorded signer remain readable, but upgrades
fail closed. Their data is not deleted or automatically assigned a signer.
Exact-package `.covedata` restoration can recover data into a disabled copy that
requires new permissions. Ambiguous signing authorities are rejected. A
self-contained package-and-data transfer bundle is not implemented.

Production CoveWeb hosting and official signing configuration were outside this
local-market acceptance. Real HTTPS `--cloud` acceptance still requires dedicated
test credentials. Physical Services and `NSOpenPanel` interaction were not run
in this pass. Full XCTest passed on macOS CI, including the Launcher test and
package acceptance steps in [run 46125040972](https://github.com/tokenfunplus/cove/actions/runs/46125040972).
Local XCTest still requires Xcode rather than this machine's Command Line Tools;
the local Swift release build and native acceptance harness passed. Commands and prerequisites are in
[development.md](development.md#mini-app-native-acceptance-on-a-mac).

The report's additional product proposals, including personal author signatures,
publisher accounts, richer rule/field types, notifications, import, sync and
successful-upgrade rollback, remain roadmap decisions rather than completed v1
features. See [mini-apps.md](mini-apps.md), [mini-app-catalog.md](mini-app-catalog.md)
and [ADR-0073](adr/0073-host-declarative-mini-apps-on-the-mac.md) for the current
contract and boundaries.

## Browser screenshots

These are unaltered captures with synthetic local data. Catalog, practice and
restarted-copy images show the final runtime. Authoring, publishing and the update
review were captured during the integration walkthrough; their exact provenance
is retained in the local acceptance report.

### Catalog

![Mini App catalog](images/mini-apps/catalog.png)

### Japanese practice

![Japanese review session](images/mini-apps/japanese-practice.png)

### Manual update and preserved data

![Review a manual update](images/mini-apps/update-review.png)

![Updated notebook after restart](images/mini-apps/updated-data.png)

### Authoring and publishing

![Browser package editor](images/mini-apps/package-editor.png)

![Published signed release](images/mini-apps/published-release.png)

## Refreshed review screenshots

### App market

![Final grouped App catalog](images/mini-apps/round5-catalog.png)

### Authoring and publishing

![Independent App in Developer tools](images/mini-apps/round5-authoring.png)

![Publishing the signed update](images/mini-apps/round5-publish.png)

### Download and update

![Downloaded App installation review](images/mini-apps/round5-install.png)

![Manual in-place update](images/mini-apps/round5-update.png)

![Personal data after update](images/mini-apps/round5-data.png)

![Explicit new-copy review](images/mini-apps/round5-new-copy.png)

![Immediate signed update beyond the cached catalog](images/mini-apps/round5-immediate-update.png)

![Independent author rule preview](images/mini-apps/round5-authored-rule.png)

### Japanese study and recovery controls

![Japanese card practice](images/mini-apps/round5-japanese-practice.png)

![Actual small-model candidates before manual correction](images/mini-apps/round5-managed-candidates.png)

![Correcting model wording before confirmation](images/mini-apps/round5-managed-edit.png)

![Seven-question library after final restart](images/mini-apps/round5-japanese.png)

![Confirmation above the App picker](images/mini-apps/round5-confirmation.png)
